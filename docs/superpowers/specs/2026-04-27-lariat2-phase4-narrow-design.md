# Lariat2 Port — Phase 4-narrow design

**Date:** 2026-04-27
**Author:** Sean Burdges (with Claude)
**Scope tag:** `phase4-narrow`
**Status:** approved (brainstorming complete; ready for writing-plans)

## 1. Background

The `design/Lariat2/` folder is a JSX/HTML prototype that maps out Lariat's intended product surface across BOH, FOH, Bar, Entertainment, and Office bureaus. A prior audit (transcript: `~/.claude/projects/-Users-seanburdges/9100e3f2-cf0c-4d70-aeb1-88206196e24f.jsonl`) compared the prototype against the live `app/` and concluded:

- ~40% ported. Kitchen ops are solid; the Entertainment cockpit and most Office/Management surfaces are unbuilt.
- `pages-event.jsx` (1,456 LOC) is the largest unported file.
- All Sound/Stage/Box-Office/Tonight-Live/Talent-A&R surfaces in `pages-event.jsx` are aspirational — no backing data exists.
- The xlsx at `drive-event-ops-dl/Lariat_Shows_MKT_Plan(Lauren's_Ingestion_Dice).xlsx` is the *only* real entertainment-ops dataset (66 future shows × 19 cols, 225 past rows, 9 TikTok ideas) and its columns map almost 1:1 to the prototype's Booking + Playbook checklist.

This spec covers **Phase 4-narrow only**: the slice of `pages-event.jsx` that the xlsx actually backs. Phase 1A (Owner Brief, Scenario Modeler, Atlas home, Vendors expansion) is deferred to a separate spec.

## 2. Decisions logged during brainstorming

| # | Decision | Rationale |
|---|---|---|
| Q1 | Spec covers Phase 4-narrow only | Seven surfaces in one spec is too coarse; clean cut |
| Q2 | Ingest cadence: manual `npm run ingest:shows` | Matches existing `ingest:*` pattern; local-first per `CLAUDE.md` |
| Q3 | All three routes PIN-gated; archive at `/shows/archive` | Manager surfaces; sets up `/shows` namespace for future |
| Q4 | Approach 1 — thin pass-through: status cells stored as raw strings, color/label rendered via `lib/showStatus.ts` | Lauren is SoT; novel cell values shouldn't crash the app |

## 3. Goal & non-goals

**Goal.** Port the entertainment-ops surface from `design/Lariat2/pages-event.jsx` (Booking, Playbook + past-shows archive) into the live Next.js app, backed by Lauren's xlsx as source of truth.

**In scope.** Xlsx ingest, schema, three routes (`/booking`, `/playbook`, `/shows/archive`), one rule module (`lib/showStatus.ts`), `tiktok_ideas` table only (no UI surface yet).

**Out of scope.** Sound, Stage, Box-Office settlement, Tonight Live, Talent A&R, write-back to xlsx, all Phase 1A surfaces.

## 4. Architecture

```
xlsx (Lauren edits)
  └─ scripts/ingest_shows_xlsx.py        # Python pure parser, prints JSON to stdout
       └─ scripts/ingest-shows.mjs       # Node: execSync + db.transaction(...) writes
              └─ data/lariat.db          # tables: shows, shows_archive, tiktok_ideas
                    ├─ lib/showsRepo.ts          # read-only TS query layer
                    ├─ lib/showStatus.ts         # pure rule module — cell → color/label
                    └─ app/api/shows/route.js    # GET endpoints; PIN-gated via middleware
                           ├─ app/booking/         (PIN-gated)
                           ├─ app/playbook/        (PIN-gated)
                           └─ app/shows/archive/   (PIN-gated)
```

**Invariants.**

- Xlsx is SoT; `npm run ingest:shows` is the only mutation path. UI never writes to these tables.
- Re-ingest is idempotent: `DELETE FROM <table> WHERE location_id=?` then INSERT, mirroring `vendor_prices` rebuild (`docs/PATTERNS.md §2`).
- `location_id TEXT NOT NULL DEFAULT 'default'` on every row (`docs/PATTERNS.md §4`).
- Audit footprint: `ingest_runs` row + one `data/audit/management-actions.jsonl` line per run. No `audit_events` rows — this isn't regulated data (`docs/PATTERNS.md §3`).
- Three nav entries register in `app/_components/navRegistry.js` under a new `entertainment` group; three middleware paths register in `middleware.js`.

## 5. Data model

Schema lives in `lib/db.ts::initSchema()`. New `CREATE TABLE IF NOT EXISTS` blocks; idempotent on every boot. Per the hard rule, no edits to existing DDL.

### `shows` (from `future` sheet)

```sql
CREATE TABLE IF NOT EXISTS shows (
  id              INTEGER PRIMARY KEY,             -- synthetic; rebuilt each ingest
  location_id     TEXT NOT NULL DEFAULT 'default',
  band_name       TEXT NOT NULL,
  show_date       TEXT NOT NULL,                   -- ISO YYYY-MM-DD
  price           REAL,                            -- nullable; xlsx has 0/empty
  door_tix        TEXT,                            -- nullable; xlsx has -, numeric, 'y'/'n' mixed
  status_json     TEXT NOT NULL DEFAULT '{}',      -- raw cells for the 14 checklist columns
  source_row      INTEGER NOT NULL,                -- xlsx row for re-ingest debugging
  ingested_at     TEXT NOT NULL,
  ingest_run_id   INTEGER NOT NULL REFERENCES ingest_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_shows_date ON shows(location_id, show_date);
CREATE INDEX IF NOT EXISTS idx_shows_band ON shows(location_id, band_name);
```

`status_json` keys are the 14 checklist column names from the xlsx, lowercased + snake-cased once in the parser:

```
media_list, mkting_adv, auto_counts, announce_date, meta_ads, fb_event,
co_host_sent, create_dice_tickets, listing_jambase_bit_songkick,
dice_email, newsletter, assets, posts, whbv
```

Values are stored as raw strings (`"y"`, `"n"`, `"-"`, `"pending"`, `"jb, bit, sk"`, `"6.0"`). `lib/showStatus.ts` interprets them at render time.

### `shows_archive` (from the malformed `past` sheet)

The sheet has year-banner rows (`A1 = 2025.0`, then mostly `None`) interleaved with data rows where col A = band, col C = date. Parser strategy: scan column A for non-date cells to detect year banners, carry forward `current_year`, only emit rows where col A is a string AND col C is a date.

```sql
CREATE TABLE IF NOT EXISTS shows_archive (
  id            INTEGER PRIMARY KEY,
  location_id   TEXT NOT NULL DEFAULT 'default',
  band_name     TEXT NOT NULL,
  show_date     TEXT NOT NULL,                  -- ISO; year may come from banner
  era_year      INTEGER,                        -- the banner year if seen
  source_row    INTEGER NOT NULL,
  ingested_at   TEXT NOT NULL,
  ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_shows_archive_date ON shows_archive(location_id, show_date);
CREATE INDEX IF NOT EXISTS idx_shows_archive_band ON shows_archive(location_id, band_name);
```

Rows that fail the shape check (band absent, date absent, or "header" row) are skipped and counted into the ingest run's `dropped_json` so Lauren can see what was dropped.

### `tiktok_ideas` (9-row sheet with conversational notes)

```sql
CREATE TABLE IF NOT EXISTS tiktok_ideas (
  id            INTEGER PRIMARY KEY,
  location_id   TEXT NOT NULL DEFAULT 'default',
  idea          TEXT NOT NULL,
  video_content TEXT,
  staff_needed  TEXT,
  props         TEXT,
  notes         TEXT,                           -- col E free-text + standalone-note rows
  source_row    INTEGER NOT NULL,
  ingested_at   TEXT NOT NULL,
  ingest_run_id INTEGER NOT NULL REFERENCES ingest_runs(id)
);
```

Rows where `idea` is set + columns B/C are missing (Lauren's standalone notes like "thoughts on polishing my own personal tiktok account…") are captured into `notes` instead of dropped — preserves her thinking but doesn't pollute the structured view.

### Existing tables touched

- `ingest_runs` — one new row per `ingest:shows` run. Existing schema sufficient.
- No other tables touched. No HACCP, no `audit_events`, no compute-engine wiring.

## 6. Components / UI

Three routes, one shared layout shell. Each gets a `page.jsx` that composes server-rendered data into client components matching `design/Lariat2/pages-event.jsx`.

### `/booking` (port of `Booking()` at `pages-event.jsx:197`)

```
app/booking/
  page.jsx                  # server component; fetches via lib/showsRepo.ts
  BookingCalendar.jsx       # client; renders cal table (date/artist/cap/sold/sell-thru/price/status)
  BookingPipeline.jsx       # client; 6-stage funnel cards
```

- **Calendar table.** Pulls `shows` rows where `show_date BETWEEN today() AND today()+35 days`, sorted ascending. `cap`/`sold`/`sell-thru` columns aren't in the xlsx → render as `—` with a footer note "ticketing data not yet wired" (instead of fake numbers from `data.js`).
- **Pipeline funnel.** Six stages — *Inquiry, Hold, Offer Out, Confirmed, On Sale, Settled* — counts derived from `status_json` via `lib/showStatus.ts::pipelineStage(row)`. Contract: pure, deterministic, exhaustive — every row maps to exactly one stage. The exact `status_json → stage` mapping is deferred to the implementation plan and pinned by the test in §9 row 1; novel cell values default to whatever stage minimises misclassification (likely `Inquiry`), documented in `lib/showStatus.ts`.
- **Click-through.** Each row links to `/playbook?show=<id>`.

### `/playbook` (port of `Playbook()` at `pages-event.jsx:1042`)

```
app/playbook/
  page.jsx                  # server component; ?show=<id> selects current row
  PlaybookHeader.jsx        # KPI strip + tab nav
  tabs/
    AdsTab.jsx              # status_json: meta_ads, fb_event, listing_*, dice_email
    TicketsTab.jsx          # status_json: create_dice_tickets + price/door_tix
    NewsTab.jsx             # status_json: newsletter
    DayOfTab.jsx            # status_json: dice_email (DOS) + assets + posts
```

- **Tabs we ship:** `ads`, `tickets`, `news`, `dayof` — the four directly readable from xlsx columns.
- **Tabs we drop:** `scene` (Local Scene radar) and `count` (Auto-counts) — synthetic in `data.js`, no xlsx backing.
- **Status pills.** Every checklist row uses `<StatusPill value="..." column="meta_ads"/>`; color/label come from `lib/showStatus.ts::statusColor()`. Tabs stay dumb.
- **No-show-selected state.** If `?show` is missing or stale, page renders the next upcoming show by default and shows a small "switch show" link to `/booking`. If there are no upcoming shows at all, page renders the empty-state banner from `/booking` ("No shows ingested yet…") and hides the tab nav.

### `/shows/archive` (audit-defined; no direct prototype precedent)

```
app/shows/archive/
  page.jsx                  # server component
  ArchiveSearch.jsx         # client; <input> filters band_name; <select> filters era_year
```

Single table: `band_name` · `show_date` · `era_year`. Pulls `shows_archive` rows ordered by `show_date DESC`. Keeps the prototype's serif/ember aesthetic; no invented KPI strips.

### Nav + shared chrome

- Add three entries to `app/_components/navRegistry.js` under a new `entertainment` group: *Booking · Playbook · Past Shows*.
- All three render inside the existing `app/layout.jsx` (`Sidebar` + `ServiceStrip`); no new shell.
- Re-use `app/_components/PinLogout.jsx` and existing PIN flow — no new auth code.

## 7. Data flow

### Ingest flow (`npm run ingest:shows`)

```
scripts/ingest-shows.mjs
 ├─ db.exec('BEGIN IMMEDIATE')                    # better-sqlite3 transaction
 ├─ run_id = INSERT ingest_runs (kind='shows', started_at=now)
 ├─ json = execSync('python3 scripts/ingest_shows_xlsx.py <xlsx-path>')
 │     │
 │     └─ Python pure parser:
 │         {
 │           shows:        [{band_name, show_date, price, door_tix, status: {...}, source_row}],
 │           shows_archive:[{band_name, show_date, era_year, source_row}],
 │           tiktok_ideas: [{idea, video_content, staff_needed, props, notes, source_row}],
 │           dropped:      [{sheet, source_row, reason}]
 │         }
 ├─ DELETE FROM shows         WHERE location_id = ?
 ├─ DELETE FROM shows_archive WHERE location_id = ?
 ├─ DELETE FROM tiktok_ideas  WHERE location_id = ?
 ├─ batch INSERT all three (prepared statements)
 ├─ UPDATE ingest_runs SET ended_at, row_counts, dropped_json = ...
 ├─ COMMIT
 └─ scripts/lib/auditLog.mjs::logManagementAction('shows-xlsx-ingest', {run_id, counts, dropped_count})
```

`ingest:shows` is added to `package.json::scripts`. `ingest:all` gets `npm run ingest:shows` appended.

### Read flow (`/booking`, `/playbook`, `/shows/archive`)

```
Browser GET /booking
  → middleware.js  (PIN cookie check; redirects to /login-pin if missing/invalid)
  → app/booking/page.jsx (server component)
       ├─ const loc = locationFromRequest(req)            // lib/location.ts
       ├─ const rows = lib/showsRepo.ts::upcomingShows(loc, weeks=5)
       │     └─ better-sqlite3 prepared statement, stable order
       └─ render <BookingCalendar rows={rows}/> + <BookingPipeline counts={...}/>
```

Pipeline counts come from a single repo call: `lib/showsRepo.ts::pipelineCounts(loc) → { inquiry, hold, offer_out, confirmed, on_sale, settled }`, which delegates per-row classification to `lib/showStatus.ts::pipelineStage(row)`.

### `app/api/shows/route.js`

GET only, JSON. Three ops:

- `op=upcoming&weeks=5` → list of upcoming shows
- `op=playbook&show=<id>` → single show with full status_json
- `op=archive&q=<text>&era=<year>` → filtered archive rows

Used by future client-side filtering; not strictly required for v1, but registered so we don't bolt it on later.

## 8. Error handling

| Failure | Behavior | Surface |
|---|---|---|
| xlsx missing at ingest path | Python parser exits 2 with `{error: "xlsx_not_found", path}` on stdout; Node wrapper logs to `data/audit/management-actions.jsonl` and `process.exit(2)` | terminal red text + audit line |
| xlsx open in Excel (lock file `~$…xlsx` present) | Python detects the `~$` lock sibling → exits 3 with `{error: "xlsx_locked"}`; user-facing message: "Close the workbook and re-run" | terminal |
| Malformed `past` row (band but no date, etc.) | Skipped, counted into `dropped[]`, surfaced in `ingest_runs.dropped_json` and a one-liner at end of run: `"Dropped 4 rows from past sheet — see ingest_runs.id=12"` | terminal + DB |
| Same `(band_name, show_date)` appears twice in `future` | Both ingested as separate rows — duplicates are legitimate (the openmic case proves it); `id` is synthetic so no PK collision | n/a |
| `status_json` contains a value `lib/showStatus.ts` doesn't recognize | `statusColor()` returns `green` (Approach 1: unknown ≠ red); label is the literal string. Logged once per ingest run as `unrecognized_status_values: [...]` in `ingest_runs.notes` | DB only |
| DB read failure on `/booking` page render | Existing Next.js error boundary at `app/error.jsx` catches it; no special handling | error page |
| PIN cookie missing | `middleware.js` redirects to `/login-pin?next=/booking`; existing flow | login page |
| Empty result set on `/booking` (Lauren hasn't ingested yet) | Page renders empty calendar + a banner: "No shows ingested yet. Run `npm run ingest:shows`." | inline |

### Explicit non-behaviors

- No write paths from UI to xlsx tables.
- No retries / circuit breakers — `npm run ingest:shows` either succeeds or surfaces the error to the operator.
- No background sync, no cron, no `chokidar` (per Q2 = manual).
- No `audit_events` rows for shows ingest (this isn't HACCP/regulated).

## 9. Testing plan (TDD order)

Three runners as `CLAUDE.md` mandates; no mocked SQLite anywhere; fixtures use real band names from the xlsx, not `foo`/`bar`.

| # | File | Runner | What it pins |
|---|---|---|---|
| 1 | `tests/js/test-show-status.mjs` | `node --test` | `lib/showStatus.ts` pure rule: every cell value seen in the xlsx (`y`, `n`, `-`, `pending`, `accepted`, `w`, `jb, bit, sk`, `tix, dos`, `6.0`, `""`) → expected `(color, label)`. Plus exhaustiveness assertion: `pipelineStage(row)` returns one of the six known stages for every row in the fixture. |
| 2 | `tests/python/test_ingest_shows_xlsx.py` | `pytest` | Python parser against a generated fixture xlsx. Asserts: 14 status keys snake-cased correctly · `past`-sheet year banners propagate · malformed rows land in `dropped[]` · `~$lock` file → exit 3 · missing path → exit 2 · idea-only rows route to `tiktok_ideas.notes`. |
| 3 | `tests/js/test-shows-ingest.mjs` | `node --test` | `scripts/ingest-shows.mjs` against an in-memory DB. Asserts: idempotent re-run produces identical row counts · DELETE+INSERT keyed on `location_id` · `ingest_runs` row written · failed Python exit aborts the transaction (no partial rows) · `dropped_json` populated. |
| 4 | `tests/js/test-shows-repo.mjs` | `node --test` | `lib/showsRepo.ts`. `upcomingShows()` excludes past dates + respects window · `pipelineCounts()` sums to `total upcoming` · `archiveSearch(q, era)` filters correctly · all queries scoped by `location_id`. |
| 5 | `tests/js/test-shows-api.mjs` | `node --test` | `app/api/shows/route.js`. PIN cookie absent → 401/redirect · with cookie, returns expected JSON shape · `op=archive&q=` honors search/era · invalid `op` → 400. |
| 6 | `app/__tests__/BookingCalendar.test.jsx` | Jest | Renders the row table from a fixture · footer "ticketing data not yet wired" present when `cap`/`sold` are null · click row navigates to `/playbook?show=<id>`. |
| 7 | `app/__tests__/PlaybookTabs.test.jsx` | Jest | `<StatusPill>` renders correct color class for each fixture value · tab switching is keyboard-accessible · `?show=<id>` selects the right row · empty-show fallback ("next upcoming") engages on missing query. |
| 8 | `app/__tests__/ArchiveSearch.test.jsx` | Jest | Search input debounced · era filter `<select>` populated from distinct `era_year` values · empty result state present. |
| 9 | `tests/e2e/shows.spec.ts` | Playwright | One smoke trip: log in via PIN → `/booking` shows ingested rows → click row → `/playbook` highlights it → nav to `/shows/archive`. |

### Fixtures

- `tests/python/fixtures/build_shows_fixture.py` — committed script that builds `shows_minimal.xlsx` (the workbook itself is gitignored). Sheets: `future` with 5 rows (one duplicate band, one with `'w'` status, one with `'jb, bit, sk'`); `past` with 8 rows (year banner `2025` + `2024` + one malformed row); `tiktok plan` with 3 structured + 1 idea-only note row.
- `data/lariat.db` is **not** touched in tests; every test that needs a DB uses `setDbPathForTest()` with `:memory:`.

### Coverage targets

- `lib/showStatus.ts` — 100% branches (it's the rule module).
- `scripts/ingest_shows_xlsx.py` — every documented `dropped` reason exercised + every error exit code.
- API route — every `op` × auth state.
- React components — at least one render + one interaction per component.

### Explicit non-tests

- Visual regression of the prototype's exact pixel layout — out of scope; manual eyeball pass during the worktree review.
- Concurrency under multi-writer load — irrelevant; ingest is single-operator.
- Toast/POS / DICE integration — those tabs are explicitly cut.

## 10. References

- Audit transcript: `~/.claude/projects/-Users-seanburdges/9100e3f2-cf0c-4d70-aeb1-88206196e24f.jsonl`
- Visual/UX source of truth: `design/Lariat2/pages-event.jsx` (functions `Booking` line 197, `Promo` 642, `Playbook` 1042)
- Source data: `drive-event-ops-dl/Lariat_Shows_MKT_Plan(Lauren's_Ingestion_Dice).xlsx`
- Patterns this spec follows: `docs/PATTERNS.md §1` (rule modules), `§2` (ingest pattern), `§3` (audit tracks), `§4` (location scoping), `§9` (post-write fire-and-forget — *not used here*).
- Rule the rule module follows: `lib/<concept>.ts` shape — pure, no I/O, single source of truth for its rule.
