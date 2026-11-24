# Home server on a Windows PC (free)

Run the **production stack** (`docker-compose.prod.yml`) on a Windows desktop and
publish it with **Tailscale Funnel**: free, no domain, no router changes, no open
ports. Testers get a stable HTTPS address such as
`https://precentor-pc.tail1234.ts.net` that works as long as the PC is on.

`docker-compose.home.yml` adapts the production stack for this:

- Tailscale handles HTTPS, so Caddy serves plain HTTP using `deploy/Caddyfile.home`
  and doesn't try to get its own certificate.
- Caddy listens on `127.0.0.1:8080` only, so nothing is reachable from your home
  network or router. Funnel is the only way in.
- Caddy tells Django every request arrived over HTTPS (which is true: Funnel only
  accepts HTTPS), so the production security settings stay on unchanged.

Moving to a paid VPS later is covered in [staging.md](staging.md); you can carry the
data across (step 9).

## 1. Requirements

- Windows 10 (22H2) or 11, 64-bit, with virtualization enabled in the BIOS (it
  usually is; Task Manager → Performance → CPU shows "Virtualization: Enabled").
- 8 GB RAM or more. The stack uses about 1–2 GB; the first build briefly more.
- About 10 GB of free disk.

## 2. Install Docker Desktop

1. Download **Docker Desktop for Windows** from docker.com and install it. Keep
   **"Use WSL 2 instead of Hyper-V"** checked. Restart when asked.
2. Open Docker Desktop → **Settings → General**: turn on **"Start Docker Desktop
   when you sign in"**.
3. The installer sets up WSL 2. If you don't have a Linux distribution yet, open
   PowerShell and run:

   ```powershell
   wsl --install -d Ubuntu
   ```

   Create a Linux username and password when prompted.
4. Docker Desktop → **Settings → Resources → WSL integration**: turn on **Ubuntu**.

Check from the Ubuntu terminal (Start menu → **Ubuntu**):

```bash
docker compose version
```

## 3. Get the code

Work **inside Ubuntu**, not under `C:\`. Builds are much faster there.

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/tinyautimothyyu/precentor.git
cd precentor
```

For a private repo, either sign in with the GitHub CLI (`sudo apt install gh`,
`gh auth login`) or add a read-only deploy key as in
[staging.md step 4](staging.md#4-get-the-code).

## 4. Install Tailscale and pick your address

1. Install **Tailscale for Windows** from tailscale.com and sign in. The free
   Personal plan includes Funnel.
2. In the admin console (login.tailscale.com):
   - **DNS** → turn on **MagicDNS** and **HTTPS Certificates**.
   - **Machines** → find this PC → **⋯ → Edit machine name**, e.g. `precentor-pc`.
     The name is part of your public address, so choose it before building.
3. Note the full address shown on the machine, e.g.
   `precentor-pc.tail1234.ts.net`. That's your `DOMAIN`.

## 5. Configure

In the Ubuntu terminal, in `~/precentor`:

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

| Variable | Value |
|---|---|
| `DOMAIN` | your Tailscale address, e.g. `precentor-pc.tail1234.ts.net` |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 32` |
| `SECRET_KEY` | output of `openssl rand -hex 50` |
| `SECURE_HSTS_SECONDS` | `3600` (add this line) |
| `TIME_ZONE` | your zone, e.g. `America/Toronto` (optional) |

Leave `USE_S3=false`; sheet files are stored in a Docker volume on this PC.

Add an alias so you don't have to type the compose files every time:

```bash
echo "alias dc='docker compose -f ~/precentor/docker-compose.prod.yml -f ~/precentor/docker-compose.home.yml --env-file ~/precentor/.env.prod'" >> ~/.bashrc
source ~/.bashrc
```

## 6. Start it

```bash
dc up -d --build
```

The first build takes several minutes. Then check it locally:

```bash
dc ps
curl http://localhost:8080/healthz      # {"status": "ok", "database": true}
```

## 7. Publish it with Funnel

In **PowerShell** (Windows, not Ubuntu):

```powershell
tailscale funnel --bg 8080
tailscale funnel status
```

Open `https://<your DOMAIN>/` from your phone on mobile data to confirm it's reachable
from outside. The first visit can take up to a minute while the certificate is issued.

`--bg` keeps Funnel on across restarts. To take the app offline:
`tailscale funnel --https=443 off`.

## 8. Accounts and test data

```bash
dc exec web python manage.py createsuperuser
dc exec web python manage.py seed_demo        # optional demo songs
```

Then in `https://<your DOMAIN>/admin/`, follow the
[admin guide's first-time setup](admin-guide.md#first-time-setup-once-right-after-the-first-deploy):
create a **Congregation** and its **Teams**, then give your superuser a **team** (it
can't create services without one). Testers sign up at `/signup`; the admin guide
covers approving them and day-to-day admin work.

## 9. Day-to-day

**Deploy updates:**

```bash
cd ~/precentor && git pull && dc up -d --build
```

Migrations run automatically on start. If you change `DOMAIN` (e.g. you renamed the
machine), the `--build` is required: the address is baked into the frontend.

**Logs:** `dc logs -f web` (or `frontend`, `caddy`, `db`).

**Back up the database** (run in Ubuntu; keep copies off this PC too):

```bash
mkdir -p ~/backups
dc exec -T db pg_dump --clean --if-exists -U precentor precentor | gzip > ~/backups/db-$(date +%F).sql.gz
```

Sheet files:

```bash
docker run --rm -v precentor-prod_media:/media -v ~/backups:/out alpine \
  tar czf /out/media-$(date +%F).tgz -C /media .
```

The backups are visible from Windows Explorer at `\\wsl$\Ubuntu\home\<you>\backups`.
To run them nightly, use Windows **Task Scheduler** with the action
`wsl -d Ubuntu -- bash -lc "<the command above>"`.

**Restore** (here, or on a VPS when you move):

```bash
gunzip -c ~/backups/db-2026-10-27.sql.gz | dc exec -T db psql -U precentor precentor
```

## 10. Keeping it running

The site is only up while the PC is on, awake and signed in.

- **Sleep:** Settings → System → Power → set **Sleep** to **Never** when plugged in.
- **Restarts:** after a Windows Update restart, Docker Desktop (and so the app) only
  starts once you **sign in**. Either sign in after updates, or turn on automatic
  sign-in (`netplwiz` → uncheck "Users must enter a user name and password"; weigh
  this against who has physical access to the PC). Set **active hours** in Windows
  Update so restarts happen overnight.
- **Containers come back on their own** after a restart (`restart: unless-stopped`).
  Funnel does too (`--bg`).
- **Speed** is limited by your home upload bandwidth. Fine for a few testers; large
  sheet downloads may be slow.

## 11. Security

- Your router and home network expose nothing new. The only way in is the Funnel
  address, which serves this app and nothing else on the PC.
- The app's own gating applies: signups start pending; services and sheet downloads
  need an approved account. Song metadata is public, as in production.
- Funnel addresses are public and appear in certificate-transparency logs, so assume
  people other than your testers can find the URL.
- **Private alternative:** skip step 7. Invite each tester to your tailnet instead
  (they install Tailscale), and they reach the app at the same address only while
  signed in to Tailscale. Run `tailscale serve --bg 8080` instead of `funnel`.

## 12. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker: command not found` in Ubuntu | WSL integration off | Docker Desktop → Settings → Resources → WSL integration → Ubuntu |
| `port is already allocated` for 8080 | Another program uses 8080 | Change `8080` in `docker-compose.home.yml` and in the `tailscale funnel` command |
| `curl localhost:8080` works, the public URL doesn't | Funnel off, or HTTPS certificates not enabled | `tailscale funnel status`; check step 4.2 |
| `400 Bad Request` | `DOMAIN` doesn't match the Tailscale address | Fix `.env.prod`, then `dc up -d --build` |
| Pages load but API calls fail | Frontend built for an old `DOMAIN` | `dc up -d --build` |
| `/healthz` returns 503 | Django can't reach Postgres | `dc logs db`; `POSTGRES_PASSWORD` can't change after the first start |
| "You must belong to a team to create a service." | Account has no team | Set its team under **Memberships** in the admin |

## 13. Removing it

```bash
dc down          # stop, keep data
dc down -v       # stop and DELETE the database, sheet files
```

and `tailscale funnel --https=443 off` in PowerShell.
