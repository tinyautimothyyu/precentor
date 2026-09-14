# Precentor — Worship Ministry App

Digital song library for a worship ministry: a searchable, taggable catalog of
songs with per-role sheet formats, multi-language lyrics, and licensing
tracking. See [`precentor_app_requirements.md`](precentor_app_requirements.md)
for the full requirements & design doc and
[`precentor_app_mvp_build_plan.md`](precentor_app_mvp_build_plan.md) for the
build plan.

## Architecture (MVP)

| Layer | Tech | Notes |
|---|---|---|
| Backend | Django 5 + DRF + SimpleJWT | Django admin for super-admins; JWT API for leaders/volunteers |
| Database | PostgreSQL 16 | Relational core + JSONB for lyric segments / alignment |
| File storage | Local FS (dev) / S3-compatible (prod) | Env-switched via `USE_S3` |
| Frontend | Next.js 15 (App Router, **TypeScript**) | Browse/detail + JWT login, leader upload/edit, gated downloads, services/playlist |

### Roles & access

| Action | Anonymous | Volunteer (approved) | Leader (approved) | Admin (Django staff) |
|---|---|---|---|---|
| Browse/search, view metadata + lyrics | ✅ | ✅ | ✅ | ✅ |
| Download sheet files | ❌ | ✅ (all songs) | ✅ (all songs) | ✅ |
| Create song / lyrics / sheet | ❌ | ❌ | ✅ (owned by their team) | ✅ |
| Edit / delete content | ❌ | ❌ | ✅ **only their team's** | ✅ (any) |
| Approve users, assign role/team | ❌ | ❌ | ❌ | ✅ |

Accounts are **self-signup + admin approval**: users register in the SPA, then an
admin approves them and sets role + congregation/team in Django admin (Accounts →
Memberships → "Approve selected"). Content carries an `owner_team`; a leader from
another team can still contribute a new translation/sheet (owned by *their* team)
without editing the original — matching the multi-team/bilingual design.

### MVP decisions (Chunk 0)
- **Tags** are a controlled vocabulary — a `Tag` model with a `category`
  (theme / scripture / season / language / mood), not a free-text array.
- **Licensing** (`ccli_number`, `copyright_holder`) is required on every song
  from day one.
- **Storage** defaults to the local filesystem so the app runs with zero cloud
  config; set `USE_S3=true` to switch to Backblaze B2 / AWS S3 / MinIO.
- **Auth**: JWT (SimpleJWT). Access token in `localStorage`, auto-refresh on 401.
  Sheet downloads are served through an auth-gated endpoint (never a public
  `/media/` URL). Django admin remains the super-admin tool.

## Running locally

### Backend + database (Docker)
```bash
docker compose up -d        # Postgres + Django, migrations run automatically
```
- API: http://localhost:8000/api/
- Admin: http://localhost:8000/admin/
- Health: http://localhost:8000/healthz

Create an admin user and seed demo data:
```bash
docker compose exec -e DJANGO_SUPERUSER_PASSWORD=precentor web \
  python manage.py createsuperuser --noinput --username admin --email you@example.com
docker compose exec web python manage.py seed_demo
```

### Frontend (Next.js)
```bash
cd frontend
cp .env.local.example .env.local   # points at http://localhost:8000
npm install
npm run dev                        # http://localhost:3000
```

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register/` | public | Self-signup (creates a pending account) |
| `POST /api/auth/token/` · `/token/refresh/` | public | JWT login / refresh |
| `GET /api/auth/me/` | JWT | Current user: role, team, `is_approved` |
| `GET /api/songs/` | public | List / search / filter (`?search=&language=&tag=&key=&sheet_type=&congregation=`) |
| `GET /api/songs/{id}/` | public | Full detail: lyrics, sheets, alignments |
| `POST/PATCH/DELETE /api/songs/`,`/lyrics/`,`/sheets/`,`/alignments/` | leader | Team-scoped writes |
| `GET /api/sheets/{id}/download/` | approved | Auth-gated file download (all songs) |
| `GET /api/services/` · `/{id}/` | approved | Worship services ("albums") + ordered playlist |
| `POST/PATCH/DELETE /api/services/` · `/service-songs/` | leader | Team-scoped service management |
| `POST /api/services/{id}/reorder/` | leader | Reorder the set list (`{item_ids:[…]}`) |
| `GET /api/youtube/search/?q=` | approved | Optional YouTube search (needs `YOUTUBE_API_KEY`) |
| `GET /api/config/` | public | Feature flags (e.g. `youtube_search`) |
| `GET /api/tags/` · `/api/congregations/` | public | Tag vocabulary / congregations + teams |

## Build status vs. plan

| Chunk | Status |
|---|---|
| 1 — Scaffold & infra | ✅ Django split settings, docker-compose, storage, health check |
| 2 — Data model & admin | ✅ Full model + customized admin with inline sheet/lyric entry |
| 3 — Populate | ⏳ `seed_demo` proves the model; real 20–30 song entry is manual |
| 4 — DRF API | ✅ Read + team-scoped write endpoints, filtered search |
| 5 — Next.js frontend | ✅ Browse, filter, detail + JWT login/signup, leader upload/edit, gated download |
| — Auth & roles | ✅ JWT, admin/leader/volunteer, team-scoped ownership, self-signup + approval |
| — Services & playlist | ✅ Service/ServiceSong, in-order YouTube/Spotify playlist, "Play all on YouTube", optional YouTube search |
| — Frontend TypeScript | ✅ Whole SPA converted to TS (strict) with typed API client |
| 6 — Instrumentation | ⬜ Not yet started |

### Optional: YouTube search
Set `YOUTUBE_API_KEY` (YouTube Data API v3) in `backend/.env` to enable in-app
YouTube search when adding a reference track. Without it, `/api/config/` reports
`youtube_search:false`, the search box hides, and pasting a link still works.
