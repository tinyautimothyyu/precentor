# Staging on a VPS

A staging server runs the **same stack as production** (`docker-compose.prod.yml`:
Postgres, Django/gunicorn, built Next.js, Caddy with automatic HTTPS) on its own
subdomain, so testers get a stable URL and you test the real deployment path.

Plan for about an hour the first time. After that, a deploy is two commands.

## 1. What you need

- **A VPS.** Any provider works (Hetzner, DigitalOcean, Linode, Vultr, Lightsail…).
  - Ubuntu 24.04 LTS.
  - **2 GB RAM recommended.** The Next.js build is the peak; on 1 GB add swap (step 3).
  - 20 GB disk is plenty for staging.
- **A domain you control**, e.g. `staging.example.org`.
- Your SSH key added to the VPS at creation time.

## 2. Point DNS at the server

At your DNS provider, create an **A record** `staging` → the VPS's IPv4 address
(and an **AAAA** record if it has IPv6). Check it before going further:

```bash
dig +short staging.example.org     # must print the VPS IP
```

Caddy requests the TLS certificate on first start; if DNS isn't pointing at the
server yet, that fails (it retries, but it's easier to wait).

## 3. Prepare the server

SSH in as root once, create a normal user, and lock down the firewall:

```bash
ssh root@<vps-ip>

adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # reuse your SSH key

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp      # HTTP/3
ufw enable
```

Install Docker (includes the `docker compose` plugin) and let `deploy` use it:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

**1 GB RAM only:** add 2 GB of swap so the frontend build doesn't get killed:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Log out and back in as `deploy` from now on: `ssh deploy@<vps-ip>`.

## 4. Get the code

The repo is on GitHub. For a private repo, give the server read-only access with a
**deploy key**:

```bash
ssh-keygen -t ed25519 -C "precentor-staging" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that key under GitHub → repo → **Settings → Deploy keys** (leave "Allow write
access" off), then:

```bash
git clone git@github.com:tinyautimothyyu/precentor.git
cd precentor
git checkout main          # or the branch you want testers to see
```

## 5. Configure

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Set at least:

| Variable | Staging value |
|---|---|
| `DOMAIN` | `staging.example.org` |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 32` |
| `SECRET_KEY` | output of `openssl rand -hex 50` |
| `SECURE_HSTS_SECONDS` | `3600` (add this line; the default is a week, which is sticky if you ever tear staging down) |
| `TIME_ZONE` | your local zone, e.g. `America/Toronto` (optional) |

Leave `USE_S3=false` unless you want sheet files in a bucket; with `false` they live
in a Docker volume on the server. Add `YOUTUBE_API_KEY` if you want in-app YouTube
search. `.env.prod` is gitignored, so it never gets committed.

## 6. Start it

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

The first build takes a few minutes. On start, Django runs migrations and
`collectstatic` automatically. Check it's up:

```bash
docker compose -f docker-compose.prod.yml ps
curl https://staging.example.org/healthz      # {"status": "ok", "database": true}
```

Tip: save typing with an alias in `~/.bashrc`:

```bash
alias dc='docker compose -f ~/precentor/docker-compose.prod.yml --env-file ~/precentor/.env.prod'
```

The rest of this guide uses `dc`.

## 7. Set up accounts and test data

Create your admin account:

```bash
dc exec web python manage.py createsuperuser
```

Then, in **https://staging.example.org/admin/**:

1. Create a **Congregation** and at least one **Team** in it.
2. Open **Memberships**, find your superuser, and set its **team**. A superuser is
   automatically an approved leader, but **can't create services without a team**.

Optionally load demo songs instead of entering them by hand:

```bash
dc exec web python manage.py seed_demo
```

Testers sign up at `/signup`. Their accounts start **pending**; approve them (and set
role and team) under **Memberships** in the admin.

## 8. Deploying updates

```bash
cd ~/precentor
git pull                       # or: git fetch && git checkout <branch>
dc up -d --build
```

Migrations run on every start. If you change `DOMAIN`, the `--build` is required: the
API URL is baked into the frontend bundle at build time.

To test a pull request before merging, check out its branch here, deploy, and switch
back to `main` afterwards.

## 9. Backups

Staging data is usually disposable, but testers' work is annoying to lose. A nightly
database dump:

```bash
mkdir -p ~/backups
crontab -e
```

```cron
0 3 * * * docker compose -f /home/deploy/precentor/docker-compose.prod.yml --env-file /home/deploy/precentor/.env.prod exec -T db pg_dump --clean --if-exists -U precentor precentor | gzip > /home/deploy/backups/db-$(date +\%F).sql.gz && find /home/deploy/backups -name 'db-*.sql.gz' -mtime +14 -delete
```

Sheet files (when `USE_S3=false`) live in the `precentor-prod_media` volume:

```bash
docker run --rm -v precentor-prod_media:/media -v ~/backups:/out alpine \
  tar czf /out/media-$(date +%F).tgz -C /media .
```

Restore a database dump (the `--clean` in the backup makes it replace existing tables):

```bash
gunzip -c ~/backups/db-2026-10-27.sql.gz | dc exec -T db psql -U precentor precentor
```

## 10. Keeping staging private

Staging is on the public internet. What protects it today:

- **The app's own gating.** New signups are pending until you approve them; services
  and sheet downloads need an approved account. Song metadata (titles, tags) **is**
  public, as it is in production.
- **HTTPS everywhere**, with the database not exposed outside Docker.

Two things to know:

- **Don't put HTTP basic auth in front of it.** The frontend sends its login token in
  the `Authorization` header, which is the same header basic auth uses, so API calls
  would fail.
- **To keep search engines out, or to restrict access by IP,** make the Caddy change
  in a staging-only copy so the tracked `deploy/Caddyfile` stays the same as
  production's:

  ```bash
  cp deploy/Caddyfile deploy/Caddyfile.staging
  ```

  In `deploy/Caddyfile.staging`, add inside the site block:

  ```caddy
  header X-Robots-Tag "noindex, nofollow"

  # Optional: only allow these addresses (your office, testers' home IPs).
  # @blocked not remote_ip 203.0.113.10 198.51.100.0/24
  # respond @blocked 403
  ```

  Create `docker-compose.staging.yml` next to the prod file:

  ```yaml
  services:
    caddy:
      volumes:
        - ./deploy/Caddyfile.staging:/etc/caddy/Caddyfile:ro
  ```

  Then include it in the alias, after the prod file:

  ```bash
  alias dc='docker compose -f ~/precentor/docker-compose.prod.yml -f ~/precentor/docker-compose.staging.yml --env-file ~/precentor/.env.prod'
  ```

  Keep both files out of git on the server (`echo 'deploy/Caddyfile.staging' >> .git/info/exclude`,
  same for `docker-compose.staging.yml`) so `git pull` never conflicts.

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Browser can't connect / certificate error | DNS not pointing at the VPS, or ports 80/443 closed | `dig +short <domain>`, `sudo ufw status`, then `dc logs caddy` |
| `400 Bad Request` from Django | `DOMAIN` doesn't match the hostname you're visiting | Fix `DOMAIN` in `.env.prod`, then `dc up -d --build` |
| Pages load but every API call fails | Frontend was built for a different `DOMAIN` | `dc up -d --build` (rebuilds the bundle) |
| `/healthz` returns 503 | Django can't reach Postgres | `dc logs db`; check `POSTGRES_PASSWORD` wasn't changed after the first start (the DB keeps the original password) |
| Build gets `Killed` | Out of memory during the Next.js build | Add swap (step 3) |
| "You must belong to a team to create a service." | The account has no team | Set its team under **Memberships** in the admin |

Logs for any service: `dc logs -f web` (or `frontend`, `caddy`, `db`).

## 12. Tearing it down

```bash
dc down          # stop, keep data
dc down -v       # stop and DELETE the database, sheet files and certificates
```

Then delete the DNS record and the VPS.

Note that the compose project is always named `precentor-prod`, so run staging and
production on **separate servers**. They'd also both need ports 80 and 443.
