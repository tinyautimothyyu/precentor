# Worship Ministry Application — Requirements & Design Doc

**Status:** Draft v1
**Last updated:** 2026-08-31

---

## 1. Problem Statement

The worship ministry currently faces three core pain points:

1. **Song sheet availability & discovery** — Officially licensed music sheets are not widely available online and are traditionally bought physically and stored in a church office. There is no digital, searchable, taggable system for choosing songs by theme, scripture, or occasion.
2. **Format fragmentation** — Different roles (vocalists, instrumentalists, accompanists) need different sheet formats (chord chart, lead sheet, piano score, hymnal) and different keys, and there's no centralized way to manage or generate these variants.
3. **Slide creation overhead** — Building lyric slides for each service is a manual, repetitive, error-prone (typos, misordered flow) task that consumes volunteer time.

Additionally, the ministry serves **multiple congregations with different languages**, and **rotating teams** with their own stylistic preferences, which the system needs to account for from the data model up.

---

## 2. Goals & Success Metrics

### 2.1 Working metrics (internal, instrumented directly in-app)

| Metric | Purpose |
|---|---|
| Time: song added → all sheet formats uploaded | Surfaces library-completion bottlenecks |
| Search vs. browse ratio | Validates whether tagging taxonomy is actually useful |
| Slide generation time per service | Tests value of AI-assisted slide feature |
| Typo/correction count, pre- vs. post-AI check | Validates AI check is catching real issues |
| Tag coverage % (songs with complete metadata) | Surfaces data quality gaps early |
| Translation coverage % per congregation | Flags underserved non-primary-language congregations |

### 2.2 Leadership-facing metrics (headline, reported monthly/quarterly)

1. **Volunteer hours saved/month** — (baseline prep time − current prep time) × number of services
2. **Licensing compliance rate** — % of songs used in services with verified CCLI/license coverage
3. **Song catalog utilization** — unique songs used per quarter, vs. historical baseline
4. **Volunteer onboarding time** — time for a new slide/music volunteer to become productive

**Baseline note:** before MVP ships, capture 2–3 services' worth of informal time-tracking (song search time, slide-build time) to have real "before" numbers rather than estimates.

---

## 3. Scope & Phasing

| Phase | Scope |
|---|---|
| **MVP (v1)** | Song library, tagging, multi-format sheet upload/storage, basic team/congregation profile fields |
| **v2** | Key transposition, structured lyrics, bilingual slide support, AI-assisted tagging, OCR digitization of physical sheets |
| **v3** | AI slide generation & typo/flow checking, semantic (RAG) song search, translation memory, sermon-to-song matching |
| **v3+** | MCP server exposure for conversational/agentic use (e.g., "plan next Sunday around Psalm 23") |

---

## 4. Data Model

### 4.1 Core entities

```
Congregation
├── name
├── primary_language, secondary_languages[]
├── bilingual_display_default: none | stacked | side_by_side
├── default_sheet_format
├── default_slide_template_id
└── song_restrictions[]

Team
├── name
├── congregation_id → Congregation
└── rotation_schedule (optional)

Song
├── title, alternate_titles[]
├── ccli_number
├── copyright_holder / licensing_notes
├── default_key
├── tempo
└── tags: theme[], scripture_ref[], season[], language[], mood[]

SongLyrics
├── song_id
├── language
├── segments[]: [{segment_type: verse1|chorus|bridge, lines: [...]}]  (JSONB)
├── translation_source: official | team_translated | ai_assisted
└── status: original | translated_unverified | translated_verified |
           needs_translation | needs_alignment

LyricAlignment
├── song_id
├── primary_language, secondary_language
└── line_pairing (confirms segment/line correspondence across languages)

SheetFile
├── song_id
├── type: chord_chart | lead_sheet | piano_score | hymnal | vocal_only
├── key
├── file (S3 reference) or structured_content
├── source: purchased | transcribed | arranged
├── preferred_by_teams[]
└── uploaded_by, uploaded_at

SlideTemplate
├── team_id (or shared/global)
├── design_asset
├── language_display_mode: single | bilingual_stacked | bilingual_side_by_side
└── branding_notes

Service
├── date, congregation_id, team_id
├── song_list[] → ServiceSong
└── slide_deck (generated output)

ServiceSong
├── song_id
├── key_override (optional)
├── format_override (optional)
└── order_in_flow
```

### 4.2 Key design decisions

- **Relational core (Postgres)**, with **JSONB** for flexible/nested data (lyric segments), rather than a separate NoSQL store — see Section 6.
- **Congregation holds the stable defaults** (language, sheet format, slide template); **Team** mostly inherits, with per-service overrides via `ServiceSong` rather than permanent team-level overrides (matches "one congregation, multiple rotating teams" structure).
- **Bilingual slides require explicit line-level alignment** (`LyricAlignment`), not just two parallel text blocks — translations often don't have matching line counts, so alignment must be enforced at data-entry time, not assumed at render time.
- **Licensing fields are mandatory from MVP**, not a later add-on — retrofitting compliance tracking after songs are already in use is far more painful than including it from day one.
- **Translation status workflow** (`needs_translation → translated_unverified → translated_verified`) ensures AI-drafted or imported translations are never auto-promoted to service-ready without human (ideally bilingual team member) review.

---

## 5. Feature Requirements by Module

### 5.1 Song Library & Tagging (MVP)
- Add/edit song with metadata, tags, licensing info
- Upload sheet files per song, tagged by type and key
- Search/filter by tag, theme, key, scripture, language
- Song detail view showing all available sheet variants and their status

### 5.2 Multi-format Sheets & Transposition (v2)
- Store lyrics/chords as structured data (ChordPro-style) to support on-the-fly transposition for chord charts/lead sheets
- Piano scores/hymnal notation remain scanned files (transposing engraved notation reliably is a separate, harder problem — out of scope for now)
- Team-specific format/key preference suggested automatically at song-selection time

### 5.3 Team & Congregation Customization (MVP fields, v2 behavior)
- Congregation-level defaults for language, sheet format, slide template
- Per-service overrides (key, format) via `ServiceSong`
- Bilingual slide rendering (stacked or side-by-side) driven by `SlideTemplate.language_display_mode`
- Song selection UI flags songs missing translation/alignment for a congregation's language before slide generation, not after

### 5.4 Slide Generation (v3)
- Auto-populate slide template with lyrics in correct language/order per the service flow
- AI-assisted typo-checking: diff slide text against canonical `SongLyrics` record (grounded check, not free-recall)
- Flow validation: flag skipped/misordered verses or choruses against expected song structure
- Alignment-drift check for bilingual slides (mismatched segment/line counts across languages)

### 5.5 AI Feature Roadmap (v2–v3+)
| Feature | Technique | Priority |
|---|---|---|
| AI-assisted tag suggestions on song add | Classification | v2 (early) |
| OCR digitization of physical sheet music | Vision model → structured extraction | v2 |
| Semantic song search ("songs about reconciliation") | RAG (pgvector) | v2–v3 |
| Sermon-to-song matching | RAG | v3 |
| Translation memory (consistent phrasing across songs) | RAG grounded in verified translations | v3 |
| Slide typo/flow checking | Grounded validation against canonical data | v3 |
| Licensing compliance check per service | Grounded validation against CCLI status | v3 |
| Conversational/agentic service planning | MCP server exposing app as tools | v3+ |

**Standing rule:** any AI output touching translation, theology, or scripture-theme matching is a **draft for human review**, never auto-published to a live slide or service plan.

---

## 6. Technical Stack

| Layer | Choice | Rationale |
|---|---|---|
| Backend framework | **Django** | Built-in admin panel covers most internal CRUD needs (song/tag/team management) out of the box; strong ORM matches the relational model; team is Python-proficient |
| API layer | **Django REST Framework (DRF)** | Needed since frontend is a separate SPA |
| Frontend | **React / Next.js** | Richer interactivity for song-picker, service/flow builder, slide preview than server-rendered templates allow |
| Database | **PostgreSQL** | Relational integrity for the Song/Team/Congregation/Service model; `JSONB` covers flexible lyric-segment data without needing a second database |
| Vector search (v2+) | **pgvector** (Postgres extension) | Semantic search / RAG without introducing a separate vector DB |
| File storage | **S3-compatible object storage** | Sheet PDFs/images; uploaded directly from browser via presigned URLs, not proxied through Django |
| Background jobs | **Celery + Redis** | Async processing for AI tasks (translation drafts, typo-checking, slide generation) — non-blocking, with job-status polling from frontend |
| Auth | **JWT** (`djangorestframework-simplejwt`) | Needed for cross-origin auth between separate frontend/backend |
| Full-text/fuzzy search (v2+, optional) | Postgres FTS → Elasticsearch/Typesense if needed | Only add a dedicated search index if lyric-fragment search becomes a real pain point |

**Explicitly not using a general-purpose NoSQL database** (document/wide-column store) for core data — the app's relationships (Song↔Tags, Song↔SheetFile, Service↔ServiceSong↔Song, LyricAlignment↔SongLyrics) require referential integrity that's cheap in Postgres and error-prone to enforce manually in a document store. NoSQL-style tools (Redis for caching/job queue, pgvector for embeddings, optional search index) are used in supporting roles, not as the system of record.

---

## 7. Non-Functional Requirements

- **Licensing compliance**: every song must track CCLI status; services should be checkable against license coverage before use.
- **Data integrity for bilingual content**: line-alignment must be enforced at entry time, not assumed at render time.
- **Human-in-the-loop for AI outputs**: no AI-generated translation, tag, or typo-correction is auto-applied without review, given the public/service-facing nature of errors.
- **File handling**: large sheet files (PDFs/scans) never proxied through the application server; direct-to-S3 upload via presigned URLs.
- **Auditability**: track who uploaded/edited songs, sheets, and translations, and when.

---

## 8. Open Questions / Not Yet Decided

- Hosting/deployment specifics (VPS + Docker Compose vs. managed platforms) — not yet discussed in detail
- Auth/permission role structure in full (admin, team lead, volunteer, per-congregation scoping) — flagged but not fully designed
- Slide generation mechanics — target output format (PowerPoint/Google Slides via API vs. custom in-browser renderer) not yet decided
- Whether/when to build the MCP server layer (v3+, contingent on core app maturity)
- Baseline time-tracking data collection — needs to happen before MVP ships to make impact metrics meaningful
