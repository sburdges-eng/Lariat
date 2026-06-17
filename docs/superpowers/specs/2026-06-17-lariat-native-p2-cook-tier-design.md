# Lariat Native — P2: Cook-tier (design)

**Date:** 2026-06-17
**Phase:** P2 (cook / on-floor tier — iPad-first)
**Builds on:** P1 manager tier complete (P1a #342, P1b #343, specs #341/#344)
**Ladder origin:** `docs/superpowers/specs/2026-06-16-lariat-native-rewrite-p0-design.md` §2
**Predecessor:** `docs/superpowers/specs/2026-06-16-lariat-native-p1b-manager-write-tier-design.md`

## 0. Why P2 is split like P1

P1 split **read** (P1a) from **first write** (P1b) to protect the shared-DB safety story.
P2 repeats that pattern: cook surfaces mix read-heavy dashboards with writes that touch
**regulated `audit_events`** (86, line checks) and **KDS ticket tables** — higher blast radius
than management JSONL.

Recommended sub-phases:

| Sub-phase | Focus | Write posture |
|-----------|--------|---------------|
| **P2a** | Today board + cook nav shell | Read-only |
| **P2b** | 86 board list + add + resolve | First `AuditedWrite` / `audit_events` |
| **P2c** | Station line checks + signoff | Checks + optional 86 coupling |
| **P2d** | KDS punch + ticket grid | Fold `LariatKDSCore`; `kds_tickets` writes |

Each sub-phase is an independent spec → plan → build → PR cycle. This doc is the **umbrella**;
the first implementation plan targets **P2a only**.

## 1. Goal / success criteria (full P2)

An **iPad-mounted** cook (and Mac back-of-house) can run the **v2 cook loop** natively against
live `lariat.db`:

1. **Today** — shift snapshot: station readiness, open 86 count, recent stock moves, cascaded impacts.
2. **86** — mark items out, resolve when back; web `/v2/eighty-six` and Command alerts stay in sync.
3. **Stations** — line-check templates, pass/fail/NA, glove attestation, signoff.
4. **KDS punch** — send tickets to line; existing `Lariat-KDS` client can poll the same rows.

Success when each surface matches web behavior for a seeded fixture, cross-process WAL visibility
works (web write → native poll), and `swift test` stays green. UI copy follows `docs/UI_COPY_RULES.md`.

## 2. Platform shift: iPad-first

P0–P1 shipped **macOS-only** manager UI. P2 is the first phase that **must** ship iPad:

- `LariatNative/Package.swift` already declares `.iOS(.v17)`; P2a adds a **Cook** section and
  iPad-optimized layout (larger tap targets, v2 shell styling parity).
- Mac remains supported for dev/smoke; iPhone stays deferred.
- Reuse polling (not `ValueObservation`) for cross-process refresh — same correction as P1a §6.

## 3. Web source map

| Surface | Web entry | Key libs / tables | Native first slice |
|---------|-----------|-------------------|-------------------|
| **Today** | `app/v2/today/page.jsx` | `stationProgress`, `activeLineCheckStations`, `eighty_six`, `inventory_updates`, `cascadedFromEightySix` | **P2a** |
| **86 board** | `app/v2/eighty-six/page.jsx`, `EightySixBoard.jsx` | `app/api/eighty-six/route.ts`, `resolve/route.ts`, `audit_events` | P2b |
| **Station checklist** | `app/stations/[id]/StationChecklist.tsx` | `line_check_entries`, `station_signoffs`, `/api/checks` | P2c |
| **KDS punch** | `app/v2/kds/punch/page.jsx` | `POST /api/kds/tickets`, `kds_tickets` / `kds_ticket_lines` | P2d |
| **KDS display** | `~/Dev/Lariat-KDS` | `LariatKDSCore`, Bonjour + `GET /api/kds/tickets` | P2d (fold-in) |

P1a Command already uses **thin read projections** over `eighty_six` and line-check tables (§4.1
P1a spec). P2 introduces **canonical cook write models** that will supersede those projections —
expected, not rework.

## 4. Architecture — extend LariatNative

No fourth SwiftPM module yet. Extend P1's three targets:

### 4.1 `LariatModel`

- **`Compute/`** additions: `stationProgress`, `activeLineCheckStations`, `cascadedFromEightySix`
  (ports of `lib/stationProgress.js`, `lib/lineSummary.ts`, `lib/subRecipeGraph.ts` — pure, GRDB-free).
- **Records** for `eighty_six`, `line_check_entries`, `inventory_updates`, `kds_tickets` (by column name).
- **P2b:** first production **`AuditedWrite`** helper wrapping transaction + `audit_events` insert
  (mirrors `postAuditEvent` / `tests/js/test-financial-acid.mjs` §5).
- **`RuleGate`** still deferred until P3 HACCP corrective-action routes.

### 4.2 `LariatDB`

- Read repos: `TodayBoardRepository`, `EightySixRepository` (P2a/b).
- Write repos opt into `LariatWriteDatabase` (reuse P1b pool).
- Station templates: read from bundled JSON via port of `getLineCheckTemplate` / `getStations` —
  same static data as web `lib/data` (not in SQLite).

### 4.3 `LariatApp`

- New sidebar tier: **Cook** (`Today`, `86`, `Stations`, `KDS`) alongside existing Manager sections.
- `#if os(iOS)` layout tweaks where needed; shared view models.
- Location scope: `DEFAULT_LOCATION_ID` + query parity (`lib/location.ts`).

### 4.4 `LariatKDSCore` fold-in (P2d)

`~/Dev/Lariat-KDS` ships independently today. P2d adds a **local Swift package dependency**
(path: `../../Lariat-KDS` or git submodule — decision in P2d plan) for ticket parsing/display.
Punch UI lives in `LariatApp`; Core stays host-testable.

**Alternative deferred:** keep KDS as a separate app polling HTTP — violates "folds in" ladder
but reduces monorepo coupling. Default plan: **fold Core only** in P2d; separate KDS app remains
until cutover.

## 5. Write / audit contracts (P2b+)

Unlike P1b management JSONL, cook writes use **`audit_events`**:

| Mutation | Tables | Audit |
|----------|--------|-------|
| 86 add | `eighty_six` INSERT | `postAuditEvent` entity `eighty_six` action `insert` |
| 86 resolve | `eighty_six` UPDATE `resolved_at` | audit on resolve route |
| Line check | `line_check_entries` | per `/api/checks` |
| KDS punch | `kds_tickets`, `kds_ticket_lines` | per tickets route |

Native must use **transactions** — financial-acid tests are the parity bar. Idempotency:
web uses `withIdempotency`; P2d punch should port key generation or call shared idempotency table.

## 6. Testing strategy

- Fixture DB seeds: `eighty_six`, `line_check_entries`, `inventory_updates`, `kds_tickets`.
- Pure `Compute/` parity vs known web outputs (same pattern as P1a menu engineering).
- API parity refs: `tests/js/test-v2-today.mjs`, `tests/js/test-financial-acid.mjs`,
  `tests/js/test-v2-eighty-six.mjs`, `StationChecklist-eighty-six.test.jsx`.
- iPad perf: `scripts/profile-ipad-cook-surfaces.mjs` thresholds as manual gate (not CI blocker P2a).

## 7. Risks

| Risk | Mitigation |
|------|------------|
| P2b pulls forward P3 `AuditedWrite` | Minimal helper scoped to `audit_events` INSERT; no RuleGate yet |
| Static station/template data drift | Port reads from same JSON sources or shared fixture in tests |
| iPad + Mac layout duplication | Shared view models; platform-specific chrome only |
| KDS repo coupling | P2d only; path package + CI clone step |
| 86 ↔ checklist double POST | Port exact web sequence (86 then check fail) in P2c |

## 8. Out of scope (full P2)

- HACCP temp logs, date marks, labor breaks (P3).
- Toast live ingest / Partner API (web owns until ingest lands).
- iPhone layout, push/SSE for KDS (poll only).
- Replacing web as schema owner.

## 9. Cutover model

Shared `lariat.db` lets cooks run native Today/86/checklists while managers stay on native
Command (already reading the same tables). Web v2 routes remain until each sub-phase flips.
