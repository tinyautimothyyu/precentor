# Worship Ministry Application — MVP Build Plan

**Status:** Draft v1
**Last updated:** 2026-09-14
**Companion doc:** `worship-app-requirements-design.md`

---

## 0. How this plan is structured

The build is organized into self-contained chunks. Each chunk produces a coherent set of files that can be dropped into the repo and committed, run locally, and iterated on before moving to the next. Chunks are sized so that each one ends at a point where the app still runs and something is demonstrably better than before.

---

## 1. Scope cuts for MVP

Two deliberate reductions from the full design, both reversible later:

### 1.1 No Celery + Redis in v1

Nothing in MVP scope is asynchronous — no AI features, no slide generation. Adding a message broker and worker process now means two more services to run, configure, and deploy for no benefit. Introduce them when the first AI feature lands in v2.

### 1.2 Django admin is the data-entry UI; Next.js is read-only

The MVP's real job is getting songs, sheets, and tags *into* the system — staff-side data entry, which Django admin handles well with little custom code. Hand-building React forms for song creation, multi-file sheet upload, and tag management is roughly 60% of the frontend work and duplicates what admin already provides.

For v1, the Next.js app only needs: browse, search/filter, and song detail — the views volunteers actually use on a music stand.

---

## 2. Chunk 0 — Decisions to settle before coding

No code, but blocking. Each of these is expensive to change later.

| Decision | Why it blocks |
|---|---|
| **Tag taxonomy**: controlled vocabulary vs. free-text vs. hybrid | Determines whether tags are FK models or a simple array field; painful to change once 200 songs are entered |
| **S3 provider** | Backblaze B2 is meaningfully cheaper than AWS at this traffic level and is S3-compatible |
| **Hosting target** | Affects settings structure and Docker setup |
| **Auth scope for v1** | Whether MVP needs real auth, or whether Django admin login + an unauthenticated read-only frontend on the church network is acceptable |

---

## 3. Build sequence

### Chunk 1 — Scaffold and infrastructure

- Django project with split settings (base/dev/prod)
- `docker-compose.yml` — Postgres + Django only
- `.env` handling
- `django-storages` wired to S3-compatible storage
- Health check endpoint

**Done when:** `docker compose up` gives a running, empty app.

---

### Chunk 2 — Data model and admin

- Models: Congregation, Team, Song, SongLyrics, SheetFile, plus tags
- Migrations
- Customized admin:
  - List filters by tag, language, translation status
  - Inline sheet file uploads on the song page
  - Required licensing fields (CCLI number, copyright holder, licensing notes)

**Done when:** a real song can be entered end to end, with multiple sheet formats attached.

This is the milestone that matters most — once it works, data entry can begin in parallel with all remaining chunks.

---

### Chunk 3 — Populate

Not a code chunk. Enter 20–30 real songs, including at least two bilingual ones.

**Purpose:** surfaces data model problems while they are still cheap to fix. This is why it comes before the API rather than after.

---

### Chunk 4 — DRF API

- Serializers for songs, sheets, lyrics, congregation/team
- Read endpoints
- Filtered search: `?tags=&language=&key=&congregation=`
- Song detail with all sheet variants
- Presigned upload endpoint (only if browser uploads are wanted in addition to admin uploads)

---

### Chunk 5 — Next.js frontend (read-only)

- Song library browse
- Filter panel
- Song detail with format/key variants
- Sheet file viewing

---

### Chunk 6 — Instrumentation

Event logging for the working metrics defined in the requirements doc:

- Search vs. browse ratio
- Tag coverage %
- Time from song-added to sheets-complete

---

## 4. Parallel task — start now, independent of code

**Baseline time-tracking.** Have whoever builds slides and whoever picks songs log start/end times for the next 2–3 services in a shared sheet.

Once the app ships, the "before" number is unrecoverable — and it is the input to the strongest leadership-facing metric available (volunteer hours saved per month).

---

## 5. Suggested starting point

**Chunk 1** is the natural entry point.

Alternative: if reviewing the concrete data model first is preferable, **Chunk 2** can be done ahead of the scaffold and still reviewed on its own.
