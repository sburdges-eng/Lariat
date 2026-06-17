# Lariat Native — P1a: Manager/Mac read-only tier (design)

**Date:** 2026-06-16
**Phase:** P1a (read-only slice of the P1 · Manager/Mac tier)
**Builds on:** P0 Foundation (PR #340, `feat/lariat-native-p0-foundation`)
**Predecessor spec:** `docs/superpowers/specs/2026-06-16-lariat-native-rewrite-p0-design.md`

## 0. Why this is "P1a", not "P1"

The phase ladder's `P1 · Manager/Mac tier` bullet bundles two different risk
classes: read-only manager surfaces (command, analytics, costing detail, the
remaining rollup tiles) **and** the first PIN-gated manager writes. Writes break
P0's load-bearing safety story — "read-only `DatabasePool`, never migrate" — and
deserve their own spec, plan, and PR. So P1 is split:

- **P1a (this spec)** — completes the manager **read** tier on the proven
  read-only posture. Zero writes. Never migrates.
- **P1b (later spec)** — the first write path: `AuditedWrite` / `PinGate` /
  `RuleGate` activated against `audit_events`, dropping the read-only posture for
  manager surfaces only.

This mirrors P0, which was itself scope-tightened (it shipped 3 of 6 rollup tiles
as representative read patterns rather than the whole rollup).

## 1. Goal / success criteria

A **macOS 14** app opens the **live `lariat.db`** and renders the **complete
manager read tier** — Command, Analytics, Costing, and Management (all six rollup
tiles) — with numbers matching the web `/command`, `/analytics`, `/costing`, and
`/management` pages, and **refreshing** when the web app re-runs its compute
engine (cross-process writes). The app **ships no writes and never migrates**.
Host-run Core tests are green.

Success is proven when:

1. Each of the four surfaces renders values that match its web counterpart for a
   seeded fixture DB.
2. A write from a separate connection (simulating the web app) becomes visible to
   the read-only pool's next polled read.
3. A missing table / schema drift degrades **per tile/section**, never failing a
   whole screen.
4. `swift build` + `swift test` are clean on macOS (Xcode 26.5).

## 2. Scope

**In scope**

- Three new read-only screens: **Command**, **Analytics**, **Costing**.
- The **three remaining rollup tiles** on the Management screen: costing-ingest
  freshness, depletion exceptions, price shocks.
- **macOS 14 floor bump** + `@Observable` migration of the P0 view model +
  `ContentUnavailableView` for empty/error states.
- The four **carryover items** deferred from P0 (§9).

**Out of scope (YAGNI)**

- **All writes** — PIN-gated manager writes are P1b; `AuditedWrite` / `PinGate` /
  `RuleGate` remain unimplemented protocols.
- iPad & iPhone UI (P1a stays macOS-first, like P0).
- Cook-tier (P2), HACCP/labor (P3), events (P4), assistant (P5), sync (P6).
- Folding in `LariatKDSCore` (P2).
- UI / snapshot tests (deferred, per P0).

## 3. Architecture — Approach A (extend P0's three targets)

No new SwiftPM modules. P0's `LariatModel` / `LariatDB` / `LariatApp` split is
extended one notch, with a named home for the now-heavier ported business logic.

### 3.1 `LariatModel` (Core) — records + compute

- New GRDB `FetchableRecord` row types for the new reads, decoded **by column
  name** (tolerant of web-side migrations adding columns), faithful to the web
  `db.ts` / repo row types.
- New **`Compute/`** group of **pure Swift functions** — GRDB-free, take
  already-fetched record arrays, return view-model structs:
  - `commandSummary` + `alertsFor` — port of `lib/commandCenter.ts`.
  - `menuEngineering` — port of `lib/menuEngineering.ts`.
  - `varianceTrend` — port of `lib/varianceTrend.ts`.
  - `abc` — port of the costing ABC analysis (`app/costing/_components/AbcTile`).
  - analytics aggregations — the per-day / per-DOW / per-hour / monthly rollups
    the analytics page computes inline.
- This keeps the risky-to-port business logic isolated and unit-testable apart
  from the database, mirroring how P0 separated *fetch* (repository) from *shape*
  (records) — just with the heavier transforms given a name.
- Invariant primitives (`AuditedWrite`, `RuleGate`, `PinGate`) **stay as
  unimplemented protocols** — P1a uses only `LocationScope` (reads are
  location-scoped), exactly as P0 did.

### 3.2 `LariatDB` (Core) — repositories

- Add `CommandRepository`, `AnalyticsRepository`, `CostingRepository`.
- Extend `ManagementRollupRepository` for the three new tiles.
- Repositories **fetch rows only**; all transformation lives in `Compute/`.
- Reuse P0's existing variance + dish-coverage reads for the Costing surface (no
  duplication of `readLatestAccountingVariance` / dish-coverage logic).
- Read-only `DatabasePool`, WAL, `foreign_keys=ON`, `busy_timeout` — unchanged
  from P0. **Never migrates.**

### 3.3 `LariatApp` (SwiftUI, macOS-first) — screens

- One `@Observable` view model + one `View` per surface (Command, Analytics,
  Costing), plus the extended Management view.
- Activate **Command / Analytics / Costing / Management** sections in the existing
  `NavigationSplitView` sidebar (P0 had only Management active).
- Extend the DI container to inject the new repositories into the new view models.
- Analytics uses **Swift Charts** for its visualizations.

## 4. The four surfaces — faithful web mapping

| Surface | Web source | Reads | Native shape |
|---|---|---|---|
| **Command** | `lib/commandCenter.ts` `summarize` → `CommandSummary`; `alertsFor` → `CommandAlert { severity: 'red' \| 'amber' }` | 15+ tables incl. P2/P3-domain (`temp_log`, `date_marks`, `thermometer_calibrations`, `cleaning_schedule`, `eighty_six`, `inventory_*`, `toast_sales_daily`, `staff_certifications`, `performance_reviews`, `shift_breaks`) | **Thin read-only projections** scoped to this surface; `commandSummary` / `alertsFor` ported as pure fns. **Explicitly superseded** by P2/P3 domain models later — that supersession is expected, not rework. |
| **Analytics** | `app/analytics/page.jsx` | `toast_sales_daily`, `toast_sales_dow`, `toast_sales_hour`, `sales_lines`, `spend_monthly` | aggregation records + **Swift Charts** views |
| **Costing** | `app/costing/page.jsx` | `readLatestAccountingVariance` (P0 reuse), dish-coverage (P0 reuse), `computeMenuEngineering`, `getVarianceTrend`, ABC (`AbcTile`) | costing-detail screen: variance + coverage + menu-engineering + variance-trend sections + ABC tile |
| **Rollup tiles ×3** | `app/management/page.jsx` | costing-ingest freshness marker; `listDepletionExceptions` (`lib/depletionExceptions`); `listPriceShocks` (`lib/vendorPricesRepo`) | extend the P0 rollup record + `ManagementRollupRepository` |

### 4.1 Note on the Command surface

The Command surface deliberately reads tables that **P2 (cook-tier)** and **P3
(HACCP/labor)** will own. To avoid throwaway domain modeling, P1a models these as
**thin, read-only projections local to the command surface** — only the columns
the summary/alerts need, decoded by name. When P2/P3 introduce the canonical,
write-bearing domain models, they supersede these projections. This is an accepted
consequence of rendering the manager command center before its underlying domains
are natively modeled, chosen over deferring the surface entirely.

## 5. macOS 14 floor migration

P0 shipped on `.macOS(.v13)` / `.iOS(.v16)`. P1a raises the floor:

- `Package.swift`: `.macOS(.v13) → .macOS(.v14)`, `.iOS(.v16) → .iOS(.v17)`.
  (No iOS app exists yet; bumping iOS in lockstep keeps `@Observable` usable
  uniformly and avoids `@available` gating in shared code.)
- Migrate P0's `ManagementRollupViewModel` from `ObservableObject` / `@Published`
  to **`@Observable`**.
- All new view models use `@Observable`.
- Replace P0's hand-rolled empty/error tile states with **`ContentUnavailableView`**.

Doing this now — before three new screens are written in the old idiom — avoids a
later migration across the whole manager tier.

## 6. Data flow & live updates

`View ← @Observable ViewModel ← Repository ← DatabasePool ← lariat.db`. One-way,
read-only, reactive.

**Live refresh is via polling.** P0 established that GRDB `ValueObservation`
**cannot** observe the web app's cross-process writes (it only sees writes through
its own connection). Each surface therefore subscribes to the **polling refresh
stream** P0 introduced. *(This corrects the P0 design doc §3.3, which originally
specified `ValueObservation`; the shipped P0 code uses polling.)*

## 7. Error handling & degradation

- **Per-tile / per-section degradation** → `ContentUnavailableView`:
  "unavailable" on a missing table / schema drift; "no data yet" on empty reads.
  A single failed read never fails a whole screen.
- **Schema-version guard** *(carryover)*: read the web app's migration/version
  marker (e.g. a `schema_migrations` table) if present; on mismatch or absence,
  **degrade gracefully** (warn + read what's available) rather than crash.
  Confirming the marker exists is an early implementation task.
- **DB file missing/unreadable** → explicit state showing the resolved path
  (P0 behavior).
- **DB locked** (web mid-write) → `busy_timeout` retry; never block the UI
  (P0 behavior).

## 8. Testing

- Host-run Core tests (`swift test`, no simulator) against **seeded temp SQLite
  fixtures**.
- **Parity is the load-bearing assertion**: each `Compute/` function's output is
  asserted against **known web-computed values** for the seeded fixture.
- Pure `Compute/` functions are unit-tested **without GRDB**.
- Record **decode tests** for the new row types **and the two remaining P0
  records** that P0 deferred *(carryover)*.
- **Remove the trivial `Smoke.swift` tests** added during P0 *(carryover)*.
- Charts get **no snapshot tests** (UI/snapshot testing remains deferred, per P0).
- Optional gated smoke test against a real `lariat.db` for live decoding (as P0).

## 9. Carryovers from P0 (folded into P1a)

These were explicitly deferred in PR #340 as non-blocking; P1a absorbs them:

1. **macOS 14 floor** + `@Observable` migration + `ContentUnavailableView` (§5).
2. **Schema-version guard** (§7).
3. **Per-tile error degradation** (§7).
4. **Decode tests for the remaining two P0 records** (§8).
5. **Remove the trivial smoke tests** (§8).

## 10. Risks & mitigations

- **Command front-runs P2/P3 schema** → thin read-only projections scoped to the
  surface; supersession by P2/P3 is expected, not rework (§4.1).
- **Native charts = new dependency** → Swift Charts (first-party, fine on macOS
  14); no snapshot tests, so no fragile UI baselines.
- **Compute fidelity vs the web app** → every ported `Compute/` function is
  unit-tested for parity against fixtures with known web-computed values; a drift
  surfaces as a failing test, not a wrong number in production.
- **Shared-DB write contention / schema drift / data-dir mismatch** → unchanged
  from P0: `busy_timeout` + read-only pool + never migrating; name-based decoding +
  schema-version guard + per-tile degradation; data-dir resolver already verified
  against `lib/dataDir.ts` in P0.

## 11. Cutover model

The shared `lariat.db` lets P1a flip the manager **read** surfaces native while the
web app keeps serving everything else (and remains the only writer). No big-bang;
P1b later flips the manager **write** surfaces.
