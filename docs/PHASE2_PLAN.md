# Phase 2 — Plan

**Objective:** Replace **Prism.fm** for venue management and the **costing/menu-engineering** add-ons of **Restaurant365**. Stand up the event-ops surfaces (Stage / Sound / Box Office) as first-class SQLite-backed repos, complete the master-costing tile, wire outbound Toast for 86-sync, and pull DICE ticket data into the Box Office.

**Predecessors:** Phase 1 stable on `main` (this PR's chain). The cron orchestrator, compliance grounding, and CSV-sync patterns are direct reuse targets.

**Success criterion:** Lariat handles a real show end-to-end — booking confirmation → stage plot save → sound scene save → box-office settlement → DICE reconciliation → manager dashboard P&L — without anyone touching Prism.

---

## Architecture sketch

```
Existing (Phase 1)                    Phase 2 additions
─────────────────────                 ──────────────────────────
shows / shows_archive  ──┐            stage_setups
showsRepo.ts             │            sound_scenes
showStatus.ts            │            box_office_lines
                         ├─ shared ── settlement_summaries (view)
                         │            outbound_toast_eighty_six
                         └─ FK to shows.id

Booking + Playbook         ─→   add: Stage + Sound + Box Office surfaces
(/booking, /playbook)            (/shows/[id]/stage, .../sound, .../box-office)
                                  + per-show settlement page

Toast inbound (CSV+API)    ─→   add: Toast outbound for 86 sync
                                  (lib/toastApi.ts; PIN-gated)

(no DICE ingest yet)       ─→   add: scripts/ingest-dice.mjs
                                  → box_office_lines
                                  + settlement reconciliation
```

## Schema additions

All new tables follow the `location_id TEXT NOT NULL DEFAULT 'default'` rule from `docs/PATTERNS.md §4`. All mutations write `audit_events` rows inside the same tx as the source INSERT, per `docs/PATTERNS.md §3`.

### `stage_setups`
One row per show describing the configured room layout, run-of-show schedule, and hospitality rider. The room-config catalog (`Listening Room · 220`, `Cabaret · 160`, etc.) is enumerated in `lib/stageRepo.ts` as a `KNOWN_ROOM_CONFIGS` const — house decision; not user-configurable from the UI.

```sql
CREATE TABLE stage_setups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id         INTEGER NOT NULL REFERENCES shows(id),
  location_id     TEXT NOT NULL DEFAULT 'default',
  room_config     TEXT NOT NULL,          -- one of KNOWN_ROOM_CONFIGS keys
  run_of_show_json TEXT NOT NULL DEFAULT '[]',  -- [{t, what, who}]
  hospitality_rider_json TEXT NOT NULL DEFAULT '{}',
  tech_rider_json TEXT NOT NULL DEFAULT '{}',
  notes           TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (show_id, location_id)
);
```

### `sound_scenes`
One row per stage-plot/scene save. Multiple per show (a band can save several). The plot itself is a structured JSON of channels + monitor mixes + positions; stored as JSON not separate tables because edits are atomic-by-scene.

```sql
CREATE TABLE sound_scenes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id       INTEGER NOT NULL REFERENCES shows(id),
  location_id   TEXT NOT NULL DEFAULT 'default',
  scene_name    TEXT NOT NULL,
  plot_json     TEXT NOT NULL,            -- {channels: [...], monitors: [...], positions: [...]}
  spl_limit_db  REAL,
  notes         TEXT,
  saved_by_cook_id TEXT,
  saved_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sound_scenes_show ON sound_scenes(show_id, location_id);
```

### `box_office_lines`
One row per ticket-source line (DICE primary, plus walkup, comp, will-call). `source` keys to the upstream system; `external_ref` is the DICE order id when present.

```sql
CREATE TABLE box_office_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  show_id       INTEGER NOT NULL REFERENCES shows(id),
  location_id   TEXT NOT NULL DEFAULT 'default',
  source        TEXT NOT NULL,            -- 'dice' | 'walkup' | 'comp' | 'will_call' | 'guestlist'
  ticket_class  TEXT,                     -- 'GA' | 'VIP' | 'comp' | 'staff' | etc.
  qty           INTEGER NOT NULL DEFAULT 1,
  face_price    REAL,
  fees          REAL,
  external_ref  TEXT,                     -- DICE order id when source='dice'
  scanned_at    TEXT,                     -- nullable; door scan timestamp
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_box_office_show ON box_office_lines(show_id, location_id);
CREATE INDEX idx_box_office_source ON box_office_lines(source, external_ref);
```

### `settlement_summaries` (computed view, not a table)

Per-show roll-up: ticket revenue (face × qty) − fees − talent buyout − deal-point splits + bar revenue + food revenue. Implemented as a SQL view that aggregates `box_office_lines` + `shows.status_json.deal` + a Toast settlement query. Source-of-truth is the underlying tables; the view exists so the dashboard tile is one query.

## Component map

| Module | Status | Owner |
|---|---|---|
| `lib/stageRepo.ts` | **scaffolded this phase** (full reference impl) | Engineering |
| `lib/soundRepo.ts` | **scaffolded this phase** (skeleton) | Engineering |
| `lib/boxOfficeRepo.ts` | **scaffolded this phase** (skeleton) | Engineering |
| `lib/settlementRepo.ts` | future | Engineering |
| `lib/toastApi.ts` | future | Engineering |
| `app/shows/[id]/stage/` | future (route stub this phase) | Engineering |
| `app/shows/[id]/sound/` | future (route stub this phase) | Engineering |
| `app/shows/[id]/box-office/` | future (route stub this phase) | Engineering |
| `app/shows/[id]/settlement/` | future | Engineering |
| `scripts/ingest-dice.mjs` | future | Engineering |
| `scripts/ingest-toast-86-outbound.mjs` | future | Engineering |
| `lib/computeEngine` master-costing tile | future | Engineering |

## Task breakdown

### A. Repo + route + UI for Stage/Sound/Box Office (current scaffold launches all three)

| # | Task | Files | Tests |
|---|---|---|---|
| A1 | Stage repo (full) | `lib/stageRepo.ts`, schema in `lib/db.ts`, `app/api/shows/[id]/stage/route.js`, `app/shows/[id]/stage/page.jsx` | `tests/js/test-stage-repo.mjs`, `tests/js/test-stage-route.mjs` |
| A2 | Sound repo (skeleton → full) | `lib/soundRepo.ts`, `app/api/shows/[id]/sound/route.js`, `app/shows/[id]/sound/page.jsx` | `tests/js/test-sound-repo.mjs` |
| A3 | Box-office repo (skeleton → full) | `lib/boxOfficeRepo.ts`, `app/api/shows/[id]/box-office/route.js`, `app/shows/[id]/box-office/page.jsx` | `tests/js/test-box-office-repo.mjs` |
| A4 | Nav registry + dashboard tile entries | `app/_components/navRegistry.js`, `app/booking/page.jsx`, `app/playbook/page.jsx` | snapshot-style |

### B. Settlement math

| # | Task | Notes |
|---|---|---|
| B1 | Deal-point parser | Input: `shows.status_json.deal` shape; output: `{guarantee, vs_pct_after_costs, costs_off_top}`. Pure-fn, unit-tested with curated deal samples. |
| B2 | Per-show settlement query | Joins `box_office_lines` + `bar_revenue` (Toast) + `food_revenue` (Toast) + `talent_costs` + `deal`. Returns `SettlementSummary` row. |
| B3 | Settlement publish surface | `/shows/[id]/settlement` page, signed PDF export. PIN-gated. |
| B4 | Reconciliation against DICE | After DICE ingest writes to `box_office_lines`, reconcile against `shows.status_json.tickets_sold`. Surface variance > $X in `/costing/depletion-exceptions`-shaped queue. |

**Rounding convention.** `lib/dealPoints.ts::computeTalentPayout` uses `Math.floor` for the vs%-bonus calculation — i.e., venue-favorable on any non-clean overage. The talent loses the fractional cent per show. This matches the long-running deal-buyer convention; the alternative (round / round-half-up / banker's) would produce slightly different parity numbers against Prism. Money values stored as INTEGER cents at every boundary; `parseDeal` rounds at the INPUT side via `Math.round` for guarantee/buyout/costs (no float drift). The asymmetry is documented in code at `lib/dealPoints.ts::computeTalentPayout` and pinned by the fractional-cent fixture in `tests/js/test-deal-points.mjs`.

### C. DICE Box Office ingest

| # | Task | Notes |
|---|---|---|
| C1 | DICE OAuth bootstrap | `scripts/dice_api/auth.mjs` (token refresh + cache). Pattern from `scripts/prism_api/`. Per-tenant secrets via env. |
| C2 | Per-show ticket pull | `scripts/ingest-dice.mjs` — `npm run ingest:dice -- --show <show_id>`. Writes to `box_office_lines` with `source='dice'`. Idempotent (UPDATE on `external_ref` match). |
| C3 | Cron wiring | Add to `data/scheduled-jobs.json` as `ingest-dice` (4× per day during show week, daily otherwise). |

### D. Outbound Toast 86 sync

| # | Task | Notes |
|---|---|---|
| D1 | Toast Partner API auth | `lib/toastApi.ts`. Uses Toast OAuth2 client credentials. Per-restaurant GUID. |
| D2 | 86 push endpoint | When `/api/eighty-six` POST creates a row, fire-and-forget call to Toast `PUT /menus/{guid}/items/{itemId}` with `outOfStock=true`. Pattern: `setImmediate` + static import per `docs/PATTERNS.md §9`. |
| D3 | Reconcile on resolve | When 86 row resolves, push `outOfStock=false` back to Toast. Failure → enqueue in `outbound_toast_eighty_six` retry queue. |

### E. Master costing tile

| # | Task | Notes |
|---|---|---|
| E1 | Per-recipe ABC ranking | Group recipes into A/B/C tiers by `gross_margin × menu_mix_pct`. |
| E2 | Menu engineering quadrant | Stars / Plowhorses / Puzzles / Dogs grid. Already exists at `/menu-engineering` — Phase 2 polishes copy + adds explainer per quadrant. |
| E3 | Variance trend tile | 28-day trend on `/costing` showing variance trajectory; recipe-level drill-down. |

## Acceptance criteria

| Criterion | Target |
|---|---|
| Stage setup save round-trip | UI → API → DB → API → UI within 100 ms p95 (in-memory write + read). |
| Sound scene autosave | Save fires every 30 s of inactivity, on focus loss, and on page unload. No data loss on tab close. |
| Box-office reconciliation | DICE ticket count vs scanned count variance ≤ $0 at close-of-show. |
| Settlement parity vs Prism | For ≥ 6 consecutive shows, no settlement variance > $X (X to be set with talent buyer; suggest $5 absolute, 0.5% relative). |
| 86 outbound latency | 86 created in Lariat → reflected at Toast terminal in < 60 s. |
| Audit trail completeness | Every Stage/Sound/Box Office mutation has a corresponding `audit_events` row with `entity_type` and `actor_source` set. |

## Cutover plan (Prism → Lariat)

1. **Parallel run.** First N shows (suggest 6–10), Lariat captures Stage/Sound/Box Office data alongside Prism. Settlement computed in both; variance reviewed weekly.
2. **Settlement primary cutover.** After N shows with zero unexplained variance, the Lariat settlement becomes the authoritative number; Prism stays read-only for archive.
3. **Cancel Prism subscription.** Once cutover sticks for two more shows, drop the Prism contract. Archive the historical data (Prism API → CSV → in-tree under `data/archive/prism/`).

## Risks (Phase 2 register)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DICE API rate limit | Med | Med | Per-show pull, not per-ticket. Cache + ETag. |
| Toast outbound 86 fails silently | Med | High | `outbound_toast_eighty_six` retry queue + alert if depth > 3. |
| Settlement deal-point ambiguity | Med | High | Curated deal samples in tests; manager-review flag on first 6 cutover shows. |
| Prism CSV export breaking | Low | Med | One-shot archive script first; lock the export shape. |
| Soundboard data loss on tab close | Med | Med | localStorage autosave + server-side scene draft; recover on reopen. |
| Manager-only PIN gate too coarse | Low | Med | Per-route role check (sound engineer ≠ box-office manager) deferred to Phase 3 labor. |

## Out of scope (intentionally)

- **Consumer ticketing.** DICE remains the front-of-house ticketing app; Lariat ingests but does not sell.
- **Card processing for door cash.** Toast handles card-present; Lariat tracks the deposit but does not authorize.
- **Talent payment rail.** Settlement computes the number; ACH disbursement is Phase 4 supply-chain + Phase 5 financial-core territory.
- **Promoter portal.** Outside agencies see the data via PDF export from Phase 2; a self-serve portal is post-Phase-5.

## How this phase composes with Phase 1

- Cron jobs added in this phase (DICE ingest, Toast outbound retry) ride the Phase 1 `run-job.mjs` orchestrator. New entries go in `data/scheduled-jobs.json`.
- Compliance JSONL grounding extends to liquor-license boundary checks ("can we sell at the door at 1:30 am?") — the corpus is already seeded.
- Settlement tile reuses the depletion-exception queue pattern: BM25-relevant rows aggregated by impact, click-through to the per-row triage page.
- Audit trail uses `lib/auditEvents.ts` (regulated DB stream) for box-office writes (cash custody is regulated) and `lib/auditLog.mjs` (file stream) for stage/sound config edits (operational).

## Pre-flight checklist before Phase 2 work starts

- [ ] PR #58 merged into `feature/in-flight-batch-2026-04-28`
- [ ] `feature/in-flight-batch-2026-04-28` merged into `main`
- [ ] `npm run sync:normalized` run on the production DB (so the new `bom_lines` rows are present before Phase 2 settlement queries reference them)
- [ ] `bash scripts/install-cron.sh` run on the production Mac mini (so the existing 7 jobs run on schedule, freeing up time for Phase 2 work)
- [ ] DICE API access requested (org admin → developer.dice.fm)
- [ ] Toast Partner API access requested (Toast admin → Toast for Developers)
- [ ] Talent buyer signs off on the Prism cutover criteria above
