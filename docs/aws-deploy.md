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
3. Check **Trust relationships**. It must say `StringEquals` (not `StringLike` with a
   `*`), or workflows on other branches could get the role:

   ```json
   "StringEquals": {
     "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
     "token.actions.githubusercontent.com:sub": "repo:tinyautimothyyu/precentor:ref:refs/heads/main"
   }
   ```
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

`PROD_DOMAIN` is baked into the frontend bundle, so it must equal `DOMAIN` in the
server's `.env.prod`. Without these variables the workflow stops at its first step
with an error naming the missing one.

## 4. Launch the EC2 instance

In the **same region** as ECR:

- **AMI:** Ubuntu 24.04 LTS. **Type:** t3.small (2 GB, x86, which matches the CI builds).
  **Storage:** 20 GB gp3.
- **Key pair:** create an ED25519 key, then on your Mac:
  `mv ~/Downloads/precentor.pem ~/.ssh/ && chmod 400 ~/.ssh/precentor.pem`.
- **Network:** a **public subnet**, no NAT Gateway.
- **Security group:** in the wizard set **Allow SSH traffic from → My IP**, and tick
  **Allow HTTPS** and **Allow HTTP traffic from the internet**. After launch, add
  **Custom UDP 443 from 0.0.0.0/0** (HTTP/3). Open nothing else: Postgres, Django and
  Next.js are only reachable inside Docker. Leave outbound as "all traffic".

  | Type | Port | Source |
  |---|---|---|
  | HTTP | 80/tcp | `0.0.0.0/0` (and `::/0` with IPv6) |
  | HTTPS | 443/tcp | `0.0.0.0/0` (and `::/0`) |
  | Custom UDP | 443/udp | `0.0.0.0/0` (and `::/0`) |
  | SSH | 22/tcp | My IP only |

  When your home IP changes, SSH stops answering: edit the rule and pick **My IP**
  again.
- **IAM instance profile** (Advanced details): a role for EC2 with the managed policy
  `AmazonEC2ContainerRegistryReadOnly`. Add `AmazonSSMManagedInstanceCore` too if you'd
  like to use Session Manager instead of SSH.
- **Advanced details → metadata:** Metadata accessible **Enabled**, version
  **V2 only (token required)**, response hop limit **1**. The ECR credential helper runs
  on the host, so containers don't need to reach the metadata service, and with a hop
  limit of 1 they can't.

After launch: **Elastic IPs → Allocate → Associate** with the instance, so its address
never changes.

## 5. A hostname

Caddy needs a hostname to get a certificate; the production settings require HTTPS,
and Let's Encrypt won't issue certificates for `ec2-…amazonaws.com` names.

**No domain yet:** sign in at duckdns.org, add a subdomain, and set its IP to the
Elastic IP. **Own a domain:** add an A record pointing at the Elastic IP.

```bash
dig +short precentor-tim.duckdns.org      # must print the Elastic IP
```

## 6. Prepare the server

```bash
ssh -i ~/.ssh/precentor.pem ubuntu@<elastic-ip>
```

Follow [staging.md](staging.md) steps 3–5 (deploy user, Docker, deploy key and clone,
`.env.prod`), with these differences:

- **You log in as `ubuntu`, not `root`.** EC2 disables root login, so create the deploy
  user from the `ubuntu` account with `sudo`, then log in as `deploy` from then on:

  ```bash
  sudo adduser deploy
  sudo usermod -aG sudo deploy
  sudo rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # same key works for deploy
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker deploy
  ```
- **Skip `ufw`.** On EC2 the security group is the firewall, and ports Docker publishes
  bypass `ufw` anyway.
- In `.env.prod`, set `DOMAIN` to the hostname from step 5 (the same value as
  `PROD_DOMAIN`), and add your registry:

  ```bash
  REGISTRY=<account-id>.dkr.ecr.<region>.amazonaws.com
  ```

Then, as `deploy`, let Docker sign in to ECR with the instance role:

```bash
sudo apt install -y amazon-ecr-credential-helper
mkdir -p ~/.docker && echo '{"credsStore":"ecr-login"}' > ~/.docker/config.json
```

## 7. First release

Run the workflow once: **Actions → Build and publish images → Run workflow** (or merge
anything to `main`). When it's green, both repositories in ECR have a `main` tag.

## 8. Install the auto-deployer

On the server, from `~/precentor`:

```bash
sudo install -m 755 deploy/autodeploy.sh /usr/local/bin/precentor-autodeploy
sudo cp deploy/systemd/precentor-autodeploy.{service,timer} /etc/systemd/system/

precentor-autodeploy --force            # first deploy, by hand: watch for errors

sudo systemctl daemon-reload
sudo systemctl enable --now precentor-autodeploy.timer
```

The script is copied out of the repo on purpose: it checks out other commits, and
must not rewrite itself while running. If `deploy/autodeploy.sh` changes in a later
commit, run the `install` line again.

Check the site:

```bash
curl https://<domain>/healthz       # {"status": "ok", "database": true}
```

Then do the one-time admin setup in [staging.md](staging.md) step 7 and set up the
backups in step 9.

## Day to day

From now on, merging a PR is the deploy. It's live about 2 minutes after the workflow
finishes. Each deploy restarts `web` and `frontend`, so expect a few seconds of errors,
and migrations run on start.

`dc` below is the alias from [staging.md](staging.md) step 6 with the ECR override
added:

```bash
alias dc='docker compose -f ~/precentor/docker-compose.prod.yml -f ~/precentor/docker-compose.ecr.yml --env-file ~/precentor/.env.prod'
```

| Task | Command |
|---|---|
| Watch deploys | `journalctl -u precentor-autodeploy -f` |
| When is the next check? | `systemctl list-timers precentor-autodeploy` |
| Deploy now | `sudo systemctl start precentor-autodeploy` |
| Pause auto-deploys | `sudo systemctl stop precentor-autodeploy.timer` (`start` to resume) |
| App logs | `dc logs -f web` |

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
frontend has the domain baked in), then change `DOMAIN` in `.env.prod`. Users have to
log in again.
