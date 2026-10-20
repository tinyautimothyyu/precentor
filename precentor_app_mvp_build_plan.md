# Worship Ministry Application — Build Plan

**Status:** v2 (consolidates the original MVP plan with the song-entry & song-profile plan)
**Last updated:** 2026-10-20
**Companion doc:** `precentor_app_requirements.md`

---

## 0. How this plan is structured

The build is organized into self-contained chunks. Each chunk produces a coherent set of changes that can be committed, run locally, and iterated on before moving to the next. Chunks are sized so that each one ends at a point where the app still runs and something is demonstrably better than before. Each chunk ships as its own branch + PR, with backend tests and a real-browser check.

---

## 1. Status at a glance

| Chunk | Scope | Status |
|---|---|---|
| 0 | Decisions to settle before coding | ✅ Mostly settled (see §2) |
| 1 | Scaffold and infrastructure | ✅ Done |
| 2 | Data model and admin | ✅ Done |
| 3 | Populate 20–30 real songs | ⬜ Not started (manual) |
| 4 | DRF API | ✅ Done |
| 5 | Next.js frontend | ✅ Done — grew beyond read-only (see §3) |
| — | JWT auth & roles | ✅ Done |
| — | Services & playlist | ✅ Done |
| — | Production Docker Compose + Caddy | ✅ Done (PR #2) |
| — | Per-service track/key/format overrides | ✅ Done (PR #3) |
| — | Fix: sheet downloads saved with wrong file type | ✅ Done (PR #4) |
| 6 | Instrumentation | ⬜ Not started |
| 7 | Song profile quick wins | ✅ Done (PR #5) |
| 8 | Custom tags | ✅ Done (PR #6) |
| 9 | Link-first "Add song" with autofill | ✅ Done (PR #7) |
| 10 | Sheet reuse | ✅ Done (PR #8) |
| 11 | Structured lyrics & team flows | ✅ Done (PR #9) |
| — | English title for non-English songs; SongSelect link by CCLI # | ✅ Done (PR #10) |
| — | Dev: view the app on a phone via a tunnel | ✅ Done (in PR #5; see README) |

Chunks 7–11 were stacked PRs #5–#10, rolled into `main` by PR #11 (2026-10-20).

---

## 2. Decisions

### 2.1 Settled

| Decision | Outcome |
|---|---|
| **Tag taxonomy** | Started as a controlled vocabulary (`Tag` with `category`). **Revised (2026-10-19):** hybrid — suggest existing tags first, allow creating new ones, admin tidies up (Chunk 8). |
| **Auth scope** | Real JWT auth with roles: anonymous (browse metadata), approved volunteer (download sheets), approved leader (create/edit, scoped to their team), Django staff = super-admin. Self-signup + admin approval. |
| **Hosting shape** | Docker Compose: dev stack in `docker-compose.yml`; prod stack (gunicorn, built Next.js, Caddy auto-HTTPS, single domain) in `docker-compose.prod.yml`. |
| **Uploader visibility** | Uploader names on sheets are shown to logged-in members only; anonymous visitors see the team name. |
| **Flows on others' songs** | Any team may create its own lyric flows on any song, including songs it doesn't own. Only the owning team edits the song's lyric sections. |
| **Sheet reuse approach** | Options 1–3 in Chunk 10 (usage signals, pre-upload duplicate check with reason, exact-duplicate blocking). Versioning deferred. |
| **Spotify Web API** | Deferred. Spotify links autofill title only (via oEmbed) until a Spotify developer app is registered. |

### 2.2 Still open

| Decision | Why it matters |
|---|---|
| **S3 provider** | Backblaze B2 is meaningfully cheaper than AWS at this traffic level and is S3-compatible. Until chosen, prod stores sheets in a Docker volume (`USE_S3=false`) — needs backups. |
| **Hosting target** | Single VPS (prod compose works as-is) vs. a managed platform (deploy each Dockerfile separately). |
| **Allowed sheet file types** | Uploads currently accept any file (a PNG screenshot has been uploaded). Decide: PDF only, or PDF + images (PNG/JPEG/HEIC photos of sheets). Enforce by content, not just extension. |

---

## 3. Scope changes since the original MVP plan

- **1.1 No Celery + Redis in v1 — still holds.** Chunk 9's link lookup is a synchronous request (a few hundred ms); introduce a worker only when the first long-running AI feature lands.
- **1.2 "Django admin is the data-entry UI; Next.js is read-only" — superseded.** Leaders now create/edit songs, upload sheets, add lyrics and build services in the Next.js app; Django admin remains the staff/super-admin tool (approvals, tag clean-up, merges).

---

## 4. Completed chunks (reference)

### Chunk 1 — Scaffold and infrastructure ✅
Django project with split settings (base/dev/prod), `docker-compose.yml` (Postgres + Django), `.env` handling, `django-storages` wired to S3-compatible storage (`USE_S3`), health check (`/healthz`).

### Chunk 2 — Data model and admin ✅
Congregation, Team, Song, SongLyrics, LyricAlignment, SheetFile, Tag; customized admin with filters, inline sheet uploads, required licensing fields.

### Chunk 4 — DRF API ✅
Serializers and endpoints for songs, sheets, lyrics, alignments, tags, congregations; filtered search; song detail with all sheet variants; auth-gated sheet download (`/api/sheets/<id>/download/`, never public `/media/`).

### Chunk 5 — Next.js frontend ✅
Library browse/filter, song detail, login/signup, leader song create/edit, sheet upload, lyrics entry. TypeScript (strict) with a typed API client.

### Auth & roles ✅ · Services & playlist ✅
Team-owned services with ordered songs, in-app YouTube/Spotify embeds, "Play all on YouTube", optional server-side YouTube search (`YOUTUBE_API_KEY`).

### Merged since the original plan ✅
- **PR #2 `feature/prod-docker-compose`** — production stack (see §2.1).
- **PR #3 `feature/service-track-overrides`** — per-service reference track override, inline set-list editor (track/key/format), sheet links in "Now playing", robust YouTube link parsing (shorts/live/embed), and a **security fix**: set-list items can no longer be moved into another team's service. First backend tests (`docker compose exec web python manage.py test catalog`).
- **PR #4 `fix/sheet-download-filetype`** — downloads were always saved as `.pdf`, so non-PDF uploads (e.g. PNG) wouldn't open. The extension now comes from the real file; the API exposes `Content-Disposition` to the frontend.
- **PRs #5–#10 → #11** — Chunks 7–11 (details and "As built" notes in §5), plus:
  - **English title** (`Song.english_title`): SongSelect only lists songs by English title, so Chinese songs record theirs. Autofilled from bilingual video titles (`【能不能 Let Me Stay】…`), used for the SongSelect search, matched by library search and duplicate checks, and shown beside the title in lists and set lists.
  - **SongSelect link** opens the song directly when the CCLI number is known (`songselect.ccli.com/songs/<n>`).
  - **Phone preview (dev):** optional same-origin API proxy (`API_PROXY_TARGET`) so one tunnel URL serves the whole app.

### Known data issue
The two seeded demo sheets (Amazing Grace, How Great Thou Art) are 69-byte placeholder PDFs with no pages; viewers can't open them. Replace them with real files during Chunk 3.

---

## 5. Remaining work (Chunks 3, 6) and specs for Chunks 7–11 (done)

### Chunk 3 — Populate (manual)
Enter 20–30 real songs, including at least two bilingual ones. Surfaces data-model problems while still cheap to fix — worth doing alongside Chunks 7–9, since the new add-song flow makes entry faster.

---

### Chunk 6 — Instrumentation
Event logging for the working metrics in the requirements doc: search vs. browse ratio, tag coverage %, time from song-added to sheets-complete.

---

### Chunk 7 — Song profile quick wins (1–2 days) ✅

**7a. Song ownership.** API adds `owner_team_name`; profile shows "Owned by **{team}** ({congregation})", or "Shared library (admin)" when unowned.

**7b. Sheet upload details.**
- New `SheetFile.original_filename` (storage may rename on collision); backfill from the stored path.
- API adds `original_filename`, `uploaded_by_name`, `owner_team_name`, `uploaded_at`.
- Sheet table: Format · Key · File · Uploaded by (Team) · Date · Download.
- Uploader name only for logged-in members; anonymous visitors see the team only.
- Team shown is the uploader's team at upload time (`owner_team`), so it stays correct if they later move teams.

**7c. Field guidance** on add and edit pages — a short explanation plus a "Where do I find this?" toggle:

| Field | What it is | Where to find it |
|---|---|---|
| CCLI number | The song's ID in CCLI's licensing catalog; churches report usage under their CCLI licence with it. | SongSelect (songselect.ccli.com) → "CCLI Song #"; also the footer of most purchased sheets and lyric slides. "Public Domain" for old hymns. |
| Copyright holder | The publisher/rights owner — not the performing artist. | The © line on the sheet or SongSelect, e.g. "© 2011 Hillsong Music Publishing". |
| Licensing notes | Anything unusual: approved translation, permission letter, not covered by CCLI. | Church office / worship coordinator. |

Plus a **"Search SongSelect"** link beside the CCLI field, pre-filled with the title. The edit page also gains the missing **Licensing notes** field (previously only settable at creation).

**Done when:** a member can tell at a glance who owns a song and who uploaded each sheet, and a new leader can fill in licensing fields without asking anyone.

---

### Chunk 8 — Custom tags (1–2 days) ✅

- Tag text box with type-ahead over existing tags (existing tags always offered first); "Create tag '…'" when nothing matches.
- New tags: category `custom`, `created_by_team`; case-insensitive uniqueness, trimmed whitespace.
- Admin actions: merge duplicate tags; move a custom tag into a proper category.
- Also fixes: the tag list was paginated at 25 (pickers would silently miss tags), and tags couldn't be edited after a song was created — the edit page now has the same tag input.

**Done when:** a leader can add a tag that doesn't exist yet without creating near-duplicates of existing ones.

---

### Chunk 9 — Link-first "Add song" with autofill (4–6 days) ✅

**Flow:**
1. Step 1 — "Paste a YouTube or Spotify link" (with the existing YouTube search alongside), plus "Skip — enter details manually".
2. Step 2 — the full form, pre-filled. Auto-filled fields carry a "from YouTube/Spotify — please check" badge; everything stays editable.
3. "Possible duplicates" — existing songs with a similar title, shown before saving.

**What autofill can realistically provide:**

| Field | YouTube | Spotify (oEmbed only, for now) |
|---|---|---|
| Title | Video title, cleaned of "(Official Video)", "Live", "Lyric Video", etc. — **good** | Track title — **good** |
| Artist (informational) | Channel name | — (needs Web API) |
| CCLI number | Only when the description mentions it — **low** | — |
| Copyright holder | Description © line when present — **partial** | — (needs Web API) |
| Songwriters | Description credits when present — **partial** | — |

**There is no public CCLI API** (SongSelect's API is partner-only), so the CCLI number will usually be manual — the "Search SongSelect" link from Chunk 7 makes it a quick copy-paste.

**Backend:** `POST /api/songs/lookup/ {url}` → suggested fields, each tagged with its source. YouTube via the existing `YOUTUBE_API_KEY` (`videos.list`: title, channel, description → regex for CCLI # and © line); falls back to keyless oEmbed (title + channel). Spotify via keyless oEmbed (title). Failures degrade to manual entry, never block. Tests use recorded sample responses for title cleaning and extraction.

**Deferred follow-ups:**
- Spotify Web API (client-credentials) for artists, album, copyright lines and ISRC — once a Spotify developer app is registered.
- MusicBrainz lookup by ISRC for songwriters/ISWC (free; 1 req/s; needs the Spotify ISRC).
- Claude-based extraction of credits from video descriptions, if regex proves too brittle (adds a paid external call per lookup).

**Done when:** pasting a typical official worship video link fills title (and usually artist) correctly, and a song can still be created entirely by hand.

**As built:** without `YOUTUBE_API_KEY`, YouTube falls back to keyless oEmbed (title + channel only, so no CCLI/© extraction) — set the key in production to get description-based licensing suggestions. Duplicate detection also flags existing songs that already use the same video.

---

### Chunk 10 — Sheet reuse (2–4 days) ✅

Goal: keep the number of sheet versions per song low by making reuse the easy path.

1. **Usage signals.** Show "★ Preferred by N teams" (existing `preferred_by_teams`) and download counts; sort most-used first; one-click "Use as ours" (any leader, on any team's sheet; one preferred sheet per team per song and format).
   *As built:* "Used in N services" was replaced by download counts — sheets aren't linked to services (a service only records a preferred format), so service usage can't be counted reliably.
2. **Check before upload.** On choosing format + key: "A Chord chart in G already exists (Team B, used in 8 services) — use it instead?" Uploading anyway requires a short reason (e.g. "different arrangement", "simplified chords"), shown in the sheet table.
3. **Block exact duplicates.** Store a SHA-256 of each file; reject identical re-uploads (catches the same file, not a re-scan).

Deferred: 4. Versioning ("new version of…" collapsing older uploads) — only if the table still gets crowded.

**Done when:** uploading a sheet that already exists in the same format/key prompts reuse, and identical files are rejected.

---

### Chunk 11 — Structured lyrics & team flows (8–12 days) ✅

**Concept:** each section is written once; a *flow* is a list of references that the app expands into the full lyrics — no repeated copy-paste.

```
Sections (written once):  V1, V2, C, ET       Flow (per team):  V1 C V2 C MB C ET
                                              ↓ expanded by the app
Rendered:  Verse 1 · Chorus · Verse 2 · Chorus · [Music break] · Chorus · End tag
```

**Data model**
- `SongLyrics.segments` gains stable ids: `{id: "C", type: "chorus", label: "Chorus", lines: [...]}`. Types: verse, pre-chorus, chorus, bridge, end tag, intro, outro. Translations reuse the same ids, so one flow drives every language (fits `LyricAlignment`).
- New `SongFlow(song, team, name, steps, is_default)` — per team; several per team allowed ("Standard", "Christmas medley"). Steps:
  - `{section: "C"}` — a section of this song
  - `{marker: "MB", label: "Music break"}` — break/instrumental, no lyrics
  - `{song: 12, section: "C"}` — **remix**: a section borrowed from another song
- `ServiceSong.flow` (optional) — pick a flow per service; falls back to the team's default flow, then to sections in order.
- Migration: existing segments get ids (`verse1` → `V1`, `chorus` → `C`, …).

**Permissions:** only the song's owning team edits its sections; **any team** can create and edit its own flows on any song (§2.1).

**UX**
- **Paste-to-split:** paste whole lyrics with headings ("Verse 1", "Chorus", "[Bridge]", "副歌") → split into sections automatically; a repeated unlabeled block is suggested as the chorus.
- **Shorthand flow input:** type `V C V C ET`. Bare letters auto-number (first `V` → V1, next → V2); explicit `V1`/`V3` also work; `MB`/`INST`/`BRK` become markers; unknown codes are flagged ("No section B yet — create it?").
- **Building blocks:** the same flow can be built by clicking section chips, with drag-to-reorder; typed and clicked forms stay in sync.
- **Live preview** of the expanded lyrics while editing.
- **Remix:** "+ Section from another song" → song search → pick its sections; borrowed sections show their source song.
- Read-only flow view on the song page (team/flow picker) and in the service's "Now playing". In v3, slide generation consumes the same expanded flow.

**Licensing:** a remixed section shows the borrowed song's CCLI number and copyright alongside, so usage reporting covers both songs.

**Done when:** a team can enter a song's sections once, type `V C MB V C ET`, and see the full lyrics in that order — including a section borrowed from another song — and pick that flow for a service.

**As built:** shorthand also accepts `@<songId>:<section>` for remix steps (inserted by the "Section from another song" picker). Pasting lyrics whose order repeats sections offers to save that order as the team's default flow in the same step. Expansion lives server-side (`POST /api/songs/<id>/arrange/`) so v3 slide generation can reuse it.

---

## 6. Suggested order

| Order | Chunk | Estimate | Depends on |
|---|---|---|---|
| 1 | ~~Merge the three open branches~~ (done: PRs #2–#4) | — | — |
| 2 | 7 — Song profile quick wins | 1–2 days | — |
| 3 | 8 — Custom tags | 1–2 days | — |
| 4 | 9 — Link-first add song | 4–6 days | 7 (guidance, SongSelect link) |
| 5 | 10 — Sheet reuse | 2–4 days | 7 (sheet details) |
| 6 | 11 — Structured lyrics & flows | 8–12 days | — (largest; after the quick wins) |
| ongoing | 3 — Populate · 6 — Instrumentation | — | 3 benefits from 9 |

---

## 7. Parallel task — start now, independent of code

**Baseline time-tracking.** Have whoever builds slides and whoever picks songs log start/end times for the next 2–3 services in a shared sheet.

Once the app ships, the "before" number is unrecoverable — and it is the input to the strongest leadership-facing metric available (volunteer hours saved per month).
