# Automatic deploys to AWS (ECR + EC2)

Every merge to `main` deploys itself:

```
merge PR → push to main → GitHub Actions builds web + frontend → pushes to ECR (:<sha>, then :main)
                                                                         ↑ polls every 2 min
                         EC2: systemd timer → pull → git checkout same commit → docker compose up
```

- GitHub never connects to the server, and the server only reads from ECR. No SSH
  keys or AWS access keys are stored in GitHub; it signs in to AWS with OIDC.
- The server runs `docker-compose.prod.yml` (Postgres, Django, Next.js, Caddy)
  plus `docker-compose.ecr.yml`, which swaps the local builds for the ECR images.
- Before restarting, the server checks out the commit the images were built from, so
  `docker-compose.prod.yml` and `deploy/Caddyfile` always match the code.

Plan for about an hour and a half the first time.

## Cost

The always-on instance is almost the whole bill, and it doesn't change with how often
you deploy.

| Item | Grows with deploys? | Rough cost |
|---|---|---|
| EC2 t3.small + 20 GB gp3 + public IPv4 | No | ~$20/month |
| GitHub Actions | Yes | Free for public repos; private repos get 2,000 min/month (a deploy is ~6–10) |
| ECR storage (last 15 images kept) | Barely | Cents per month |
| ECR → EC2 pulls (same region) | Yes | Free |

Avoid: a **NAT Gateway** (~$32/month plus a charge per GB pulled; use a public
subnet), ECR and EC2 in **different regions**, and ECR without the cleanup rule.

## 1. ECR repositories

With the AWS CLI signed in (`aws sts get-caller-identity` prints your account ID),
pick the region the server will run in. ECR and EC2 must be in the **same region**.

```bash
export AWS_REGION=ca-central-1     # change to yours

for n in web frontend; do
  aws ecr create-repository --repository-name precentor-$n \
    --image-tag-mutability MUTABLE \
    --image-scanning-configuration scanOnPush=true

  aws ecr put-lifecycle-policy --repository-name precentor-$n --lifecycle-policy-text '{
    "rules": [{
      "rulePriority": 1,
      "description": "keep last 15 images",
      "selection": { "tagStatus": "any", "countType": "imageCountMoreThan", "countNumber": 15 },
      "action": { "type": "expire" }
    }]
  }'
done
```

Tags must stay **mutable**: every release moves `:main`. Keeping 15 images gives you 15
merges to roll back through.

Your **registry** is `<account-id>.dkr.ecr.<region>.amazonaws.com`. You'll need it in
step 6.

## 2. Let GitHub Actions push to ECR

1. **IAM → Identity providers → Add provider → OpenID Connect**: URL
   `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. **IAM → Roles → Create role → Web identity**: choose that provider, audience
   `sts.amazonaws.com`, organization `tinyautimothyyu`, repository `precentor`,
   branch `main`. Skip the permissions page (it only offers existing policies).
   - Name: `precentor-github-ecr-push`
   - Description: `Assumed by GitHub Actions (tinyautimothyyu/precentor, main branch only) via OIDC. Pushes images to the precentor-web and precentor-frontend ECR repositories. No other access.`
3. **Fix the trust policy by hand.** The console wizard writes the subject as
   `repo:tinyautimothyyu/precentor:ref:refs/heads/main`, but this repository uses
   GitHub's *immutable subject* format, which adds the owner and repository IDs. With
   the wizard's version every run fails with "Not authorized to perform
   sts:AssumeRoleWithWebIdentity" (see [Troubleshooting](#troubleshooting)).

   Check the format GitHub sends:

   ```bash
   gh api repos/tinyautimothyyu/precentor/actions/oidc/customization/sub
   # {"use_default":true,"use_immutable_subject":true,
   #  "sub_claim_prefix":"repo:tinyautimothyyu@39392084/precentor@1370317770"}
   ```

   The subject is `<sub_claim_prefix>:ref:refs/heads/main`. Under **Trust
   relationships → Edit trust policy**, replace the policy with this one (use your
   account ID). It must say `StringEquals`, not `StringLike` with a `*`, or workflows on
   other branches could get the role:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:tinyautimothyyu@39392084/precentor@1370317770:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```

   The IDs never change, even if the repository or account is renamed.
4. **Permissions → Add permissions → Create inline policy → JSON**, named
   `precentor-ecr-push`. It's limited to the two repositories, unlike the AWS-managed
   `AmazonEC2ContainerRegistryPowerUser`, which can overwrite any image in the account:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "EcrLogin",
         "Effect": "Allow",
         "Action": "ecr:GetAuthorizationToken",
         "Resource": "*"
       },
       {
         "Sid": "PushPullPrecentorImages",
         "Effect": "Allow",
         "Action": [
           "ecr:BatchCheckLayerAvailability",
           "ecr:InitiateLayerUpload",
           "ecr:UploadLayerPart",
           "ecr:CompleteLayerUpload",
           "ecr:PutImage",
           "ecr:BatchGetImage",
           "ecr:GetDownloadUrlForLayer"
         ],
         "Resource": [
           "arn:aws:ecr:<region>:<account-id>:repository/precentor-web",
           "arn:aws:ecr:<region>:<account-id>:repository/precentor-frontend"
         ]
       }
     ]
   }
   ```

   `GetAuthorizationToken` can't be limited to particular repositories and grants
   nothing on its own. The read actions let the release job retag `:<sha>` as `:main`.

## 3. GitHub repository variables

**Settings → Secrets and variables → Actions → Variables** (none are secret):

| Variable | Example |
|---|---|
| `AWS_REGION` | `ca-central-1` |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<account-id>:role/precentor-github-ecr-push` |
| `PROD_DOMAIN` | `precentor-tim.duckdns.org` |

`PROD_DOMAIN` is just the hostname: no `https://`, no trailing `/`, and dots, not
`@` (`precentor-tim.duckdns.org`, not `precentor-tim@duckdns.org`). It's baked into the
frontend bundle, so it must equal `DOMAIN` in the server's `.env.prod` exactly. Check
it with `gh variable get PROD_DOMAIN`. Without these variables the workflow stops at
its first step with an error naming the missing one.

## 4. Launch the EC2 instance

In the **same region** as ECR:

- **AMI:** Ubuntu 24.04 LTS. **Type:** t3.small (2 GB, x86, which matches the CI builds).
- **Storage: change the default 8 GiB to 20 GiB gp3.** Ubuntu, Docker and the four images
  don't fit in 8 GiB; the first deploy fails with "no space left on device".
- **Key pair:** create an ED25519 key, then on your Mac:
  `mv ~/Downloads/precentor.pem ~/.ssh/ && chmod 400 ~/.ssh/precentor.pem`.
- **Network:** a **public subnet**, no NAT Gateway.
- **Security group:** tick **Allow HTTPS** and **Allow HTTP traffic from the internet**.
  For SSH, don't trust **My IP**: if your browser uses IPv6 it records an IPv6 address,
  which never matches because the instance only has IPv4. Choose **Custom** and enter your
  IPv4 address with `/32`:

  ```bash
  curl https://checkip.amazonaws.com      # on your Mac, e.g. 154.20.77.49 → 154.20.77.49/32
  ```

  After launch, add **Custom UDP 443 from 0.0.0.0/0** (HTTP/3). Open nothing else:
  Postgres, Django and Next.js are only reachable inside Docker. Leave outbound as
  "all traffic".

  | Type | Port | Source |
  |---|---|---|
  | HTTP | 80/tcp | `0.0.0.0/0` (and `::/0` with IPv6) |
  | HTTPS | 443/tcp | `0.0.0.0/0` (and `::/0`) |
  | Custom UDP | 443/udp | `0.0.0.0/0` (and `::/0`) |
  | SSH | 22/tcp | your IPv4 address `/32` |

  When your home IP changes (or you turn a VPN on or off), SSH times out: add or edit
  the SSH rule with the new address.
- **IAM instance profile** (Advanced details): **don't skip this.** Create a role for
  EC2 named `precentor-ec2` with the managed policy `AmazonEC2ContainerRegistryReadOnly`.
  Add `AmazonSSMManagedInstanceCore` too if you'd like to use Session Manager instead of
  SSH. Without a role, every pull fails with "no basic auth credentials". You can attach
  it later under **Instance → Actions → Security → Modify IAM role**, with no reboot.
- **Advanced details → metadata:** Metadata accessible **Enabled**, version
  **V2 only (token required)**, response hop limit **1**. The ECR credential helper runs
  on the host, so containers don't need to reach the metadata service, and with a hop
  limit of 1 they can't.

After launch: **Elastic IPs → Allocate → Associate** with the instance, so its address
never changes.

## 5. A hostname

Caddy needs a hostname to get a certificate; the production settings require HTTPS,
and Let's Encrypt won't issue certificates for `ec2-…amazonaws.com` names.

**No domain yet:** sign in at duckdns.org and add a subdomain. DuckDNS fills in **your
browser's** IP, not the server's, and with Safari's iCloud Private Relay that's an Apple
address (`172.225.x.x`). **Type the Elastic IP into "current ip" by hand** and click
**update ip**. **Own a domain:** add an A record pointing at the Elastic IP.

Check with a public resolver before going on. Caddy asks Let's Encrypt for a
certificate as soon as it starts, and repeated failures lock you out for an hour.

```bash
dig +short @1.1.1.1 precentor-tim.duckdns.org      # must print the Elastic IP
```

## 6. Prepare the server

**Log in as `ubuntu`.** EC2 disables root login, so `docs/staging.md`'s `ssh root@…`
doesn't apply here:

```bash
ssh -i ~/.ssh/precentor.pem ubuntu@<elastic-ip>
```

Create the `deploy` user and install Docker. Run these as `ubuntu`, **not** after
`sudo -i` or `sudo su`: as root, `~/.ssh` means `/root/.ssh`, whose key file makes every
login print "Please login as the user ubuntu rather than the user root" and disconnect.

```bash
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # same key works for deploy
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
exit
```

**Skip `ufw`** (staging.md step 3). On EC2 the security group is the firewall, and
ports Docker publishes bypass `ufw` anyway.

From now on, log in as `deploy`:

```bash
ssh -i ~/.ssh/precentor.pem deploy@<elastic-ip>
docker ps          # an empty table; "permission denied" means log out and back in
```

Get the code. The repository is public, so no deploy key is needed:

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/tinyautimothyyu/precentor.git ~/precentor
cd ~/precentor
```

Create `.env.prod`:

```bash
cp .env.prod.example .env.prod
openssl rand -hex 32     # → POSTGRES_PASSWORD
openssl rand -hex 50     # → SECRET_KEY
nano .env.prod
```

```bash
DOMAIN=precentor-tim.duckdns.org                   # exactly PROD_DOMAIN: dots, no @, no https://
POSTGRES_PASSWORD=<first value>
SECRET_KEY=<second value>
REGISTRY=<account-id>.dkr.ecr.<region>.amazonaws.com
TIME_ZONE=America/Toronto
```

```bash
grep ^DOMAIN= .env.prod   # read it once more; a typo here stops Caddy from starting
```

Save `POSTGRES_PASSWORD` and `SECRET_KEY` in a password manager. Postgres keeps the
password from its first start (changing it later breaks the connection), and changing
`SECRET_KEY` logs everyone out.

Let Docker sign in to ECR with the instance role. Do this as `deploy`, not with
`sudo`, so the config lands in deploy's home:

```bash
sudo apt install -y amazon-ecr-credential-helper
mkdir -p ~/.docker && echo '{"credsStore":"ecr-login"}' > ~/.docker/config.json
```

## 7. First release

Run the workflow once: **Actions → Build and publish images → Run workflow** (or merge
anything to `main`, or `gh workflow run deploy.yml --ref main`). When it's green, both
repositories in ECR have a `main` tag.

## 8. Install the auto-deployer

On the server, as `deploy`, from `~/precentor`. First check that the server can pull:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.ecr.yml --env-file .env.prod pull web frontend
```

If that fails, see [Troubleshooting](#troubleshooting). Then:

```bash
sudo install -m 755 deploy/autodeploy.sh /usr/local/bin/precentor-autodeploy
sudo cp deploy/systemd/precentor-autodeploy.{service,timer} /etc/systemd/system/

precentor-autodeploy --force            # first deploy, by hand: watch for errors

sudo systemctl daemon-reload
sudo systemctl enable --now precentor-autodeploy.timer
```

The first deploy should end with `Deployed <sha>; https://<domain>/healthz is OK`. A
few `TLS connect error` lines before that are normal: Caddy is still getting its
certificate, and the script retries.

The script is copied out of the repo on purpose: it checks out other commits, and
must not rewrite itself while running. If `deploy/autodeploy.sh` changes in a later
commit, run the `install` line again.

**Add the `dc` shortcut.** The rest of this guide uses `dc` as short for Docker Compose
with the right files. Plain `docker` doesn't know which files make up the stack.

```bash
echo "alias dc='docker compose -f ~/precentor/docker-compose.prod.yml -f ~/precentor/docker-compose.ecr.yml --env-file ~/precentor/.env.prod'" >> ~/.bashrc
source ~/.bashrc
dc ps          # four services: db, web, frontend, caddy
```

**Set up the app:**

```bash
dc exec web python manage.py createsuperuser
```

Then follow the
[admin guide's first-time setup](admin-guide.md#first-time-setup-once-right-after-the-first-deploy):
create a **Congregation** and its **Teams** before inviting anyone, and give your
superuser a **team** (without one, you can't create services). Don't run `seed_demo`
here; it's for test servers. Finally, set up the nightly backups in
[staging.md](staging.md) step 9.

For approving signups, roles, tags and other routine admin work, see
[admin-guide.md](admin-guide.md).

## Day to day

From now on, merging a PR is the deploy. It's live about 2 minutes after the workflow
finishes. Each deploy restarts `web` and `frontend`, so expect a few seconds of errors,
and migrations run on start.

| Task | Command |
|---|---|
| Watch deploys | `journalctl -u precentor-autodeploy -f` |
| When is the next check? | `systemctl list-timers precentor-autodeploy` |
| Deploy now | `sudo systemctl start precentor-autodeploy` |
| Pause auto-deploys | `sudo systemctl stop precentor-autodeploy.timer` (`start` to resume) |
| Container status | `dc ps` |
| App logs | `dc logs -f web` (Caddy and certificates: `dc logs caddy \| tail -30`) |
| Disk space | `df -h /` (keep it under ~70%; every deploy downloads before it cleans up) |

**Rebuild without a code change** (for example, after fixing `PROD_DOMAIN`):
`gh workflow run deploy.yml --ref main`. The server picks up the new images by itself.

**Roll back** by pointing `:main` at an earlier commit. The server picks it up on the
next check. On your Mac:

```bash
REG=<account-id>.dkr.ecr.<region>.amazonaws.com
aws ecr get-login-password | docker login --username AWS --password-stdin $REG
for n in web frontend; do
  docker buildx imagetools create -t $REG/precentor-$n:main $REG/precentor-$n:<old-sha>
done
```

The database does not roll back. If the bad release ran a migration, the older code
must still work with the new schema, or you restore a backup.

**Changing `DOMAIN`** (for example, moving from DuckDNS to your own domain): point the
new name at the Elastic IP, change `PROD_DOMAIN` in GitHub and re-run the workflow (the
frontend has the domain baked in), then change `DOMAIN` in `.env.prod` and run
`precentor-autodeploy --force`. Users have to log in again.

## Troubleshooting

Every problem below came up during the first deployment (2026-11-24), in the order
they appeared. Each entry has the exact error, the cause and the fix.

### GitHub Actions: "Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity"

**Cause:** the role's trust policy doesn't match the token GitHub sent. Here it was the
subject format: the console wizard wrote `repo:tinyautimothyyu/precentor:…`, but this
repository sends the immutable form `repo:tinyautimothyyu@39392084/precentor@1370317770:…`.

**Fix:** replace the trust policy as in [step 2](#2-let-github-actions-push-to-ecr),
then re-run with `gh run rerun <run-id>`. If it still fails, check that the identity
provider's URL is exactly `token.actions.githubusercontent.com`, with audience
`sts.amazonaws.com`, and that the policy's `Federated` ARN matches that provider.

### The frontend was built for the wrong domain

**Symptom:** `gh variable get PROD_DOMAIN` printed `precentor-tim@duckdns.org`. Pages
load but every API call fails: a browser reads `https://precentor-tim@duckdns.org` as
user "precentor-tim" at host `duckdns.org`.

**Fix:** `gh variable set PROD_DOMAIN --body precentor-tim.duckdns.org`, then
`gh workflow run deploy.yml --ref main`. Only the frontend rebuilds (the backend comes
from cache), and the server picks it up within 2 minutes.

### SSH: "connect to host … port 22: Operation timed out"

**Cause:** the security group drops SSH from your address. A timeout (not "connection
refused") means packets are dropped before reaching the server. To tell this apart from
a dead instance, try a port that's open to everyone:

```bash
nc -vz -G 5 <elastic-ip> 80    # "Connection refused" = instance reachable; port 80 allowed
nc -vz -G 5 <elastic-ip> 22    # "Operation timed out" = SSH rule doesn't match your IP
curl https://checkip.amazonaws.com
```

Here the wizard's **My IP** had recorded an IPv6 address.

### Security group: "You may not specify an IPv4 CIDR for an existing IPv6 CIDR rule"

**Cause:** while fixing the problem above, an IPv6 rule can't be edited into an IPv4 one.

**Fix:** **Delete** the SSH rule, **Add rule** → SSH, Source **Custom**,
`<your-ipv4>/32`, then **Save rules**.

### SSH as deploy: "Please login as the user "ubuntu" rather than the user "root"."

**Cause:** `deploy` got a copy of root's `authorized_keys`, which starts with a command
that prints this message and disconnects. That happens when the key-copy step runs as
root (after `sudo -i` or `sudo su`).

**Fix:** log in as `ubuntu` and copy ubuntu's keys instead:

```bash
sudo install -m 600 -o deploy -g deploy /home/ubuntu/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
sudo cut -c1-60 /home/deploy/.ssh/authorized_keys    # must start with ssh-, not no-port-forwarding
```

### docker compose pull: "no basic auth credentials"

**Cause:** Docker sent no ECR login. Either the credential helper isn't set up for
`deploy`, or it is but the instance has no IAM role.

**Fix:** check all three:

```bash
cat ~/.docker/config.json                 # {"credsStore":"ecr-login"}
which docker-credential-ecr-login         # /usr/bin/docker-credential-ecr-login
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/; echo
# a role name; nothing or a 404 page = no role
```

Re-create the config as `deploy` if needed, or attach the role
(**Instance → Actions → Security → Modify IAM role**, see [step 4](#4-launch-the-ec2-instance)).

### Deploy: "no space left on device"

**Cause:** the instance kept the AMI's default 8 GiB disk. `df -h /` shows about 7 GB.

**Fix:** grow the volume while the server runs. In **Instance → Storage**, click the
volume, then **Actions → Modify volume → 20 GiB**. Once it shows *optimizing*, run on the
server:

```bash
lsblk                                  # find the disk and partition names
sudo growpart /dev/nvme0n1 1
sudo resize2fs /dev/nvme0n1p1
df -h /                                # ~19G
docker system prune -f                 # clear the half-downloaded layers
precentor-autodeploy --force
```

Never add `--volumes` to the prune: that deletes the database volume.

### Health check: "curl: (6) Could not resolve host", Caddy "Restarting"

**Cause:** a typo in `DOMAIN` in `.env.prod` (`precentor-tim@duckdns.org`). Caddy uses
it as the site address and exits; `dc ps` shows `caddy: Restarting`, and port 80
refuses connections.

**Fix:** correct it with `nano ~/precentor/.env.prod`, check with
`grep ^DOMAIN= ~/precentor/.env.prod`, then `precentor-autodeploy --force`. Compose sees
the changed value and recreates `web` and `caddy`.

### DuckDNS points at the wrong IP

**Symptom:** `dig +short @1.1.1.1 <domain>` printed `172.225.42.155` instead of the
Elastic IP. DuckDNS had saved the browser's iCloud Private Relay address when the
subdomain was created.

**Fix:** type the Elastic IP into DuckDNS's **current ip** box, click **update ip**,
and wait until `dig` shows it **before** redeploying, so Caddy's first certificate
request succeeds.
