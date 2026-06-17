# Lariat Native (Swift) Rewrite — P0 Foundation Design

**Date:** 2026-06-16
**Status:** Design — pending user review, then implementation plan
**Scope of this doc:** the overall rewrite decomposition (context) + the detailed design for **P0 Foundation**, the first buildable slice.

---

## 1. Context & foundational decisions

The Lariat web app (Next.js 16 / TypeScript / better-sqlite3, tagged `v2.0.0`) is being
rewritten as a **native Swift/Xcode app** that will eventually replace it. The web app is
**109 SQLite tables · 124 API routes · 94 pages** across many subsystems — too large for a
single spec, so the rewrite is **decomposed into phased sub-projects**, each with its own
spec → plan → build cycle.

Three load-bearing decisions are locked:

| Decision | Choice | Consequence |
|---|---|---|
| **Driver** | Whole-platform modernization (phased port, no single first-win) | Deliverable is a sequenced port, not one prioritized feature |
| **Data layer** | **GRDB on the same `lariat.db`** (WAL, multi-process) | Native + web read/write identical data; surface-by-surface cutover, no data fork. The Swift side must honor the web app's invariants and **must never run migrations** |
| **Logic** | **Hybrid** — Swift Core for all runtime logic; **Python ingest retained** as a back-office companion writing the shared DB | Ingest parsers (pdfplumber/lxml/pandas) are out of the Swift port scope |

**Platform targets:** iPad (on-floor) + Mac (manager/back-office), iOS 16 / macOS 13 —
matching the existing `Lariat-KDS` package. iPhone deferred.

**Package pattern:** reuse the `Lariat-KDS` Core/App split — pure-Swift Core modules
(host-testable via `swift test`) consumed by a SwiftUI App.

## 2. Phase ladder (decomposition)

Each phase is an independent sub-project (own spec → plan → build → PR). Order reflects the
user's call to **lead with the manager/Mac tier** (read-heavy → lower shared-DB write risk).

- **P0 · Foundation** — GRDB shared-DB stack, invariant-primitive contracts, app shell/nav/DI, proven by one read-only manager surface. *(This doc.)*
- **P1 · Manager/Mac tier** — completes the manager tier on the P0 foundation: command, analytics, costing detail, the remaining rollup tiles, and PIN-gated manager writes.
- **P2 · Cook-tier** — today board, 86, KDS punch, station checklists/line checks (folds in `LariatKDSCore`).
- **P3 · HACCP + labor** — rule engine + 422 gates + audit transactionality (first heavy write phase).
- **P4 · Events / venue** — BEO + share tokens, shows/settlement/box office.
- **P5 · LaRi assistant** — grounded context + `db_query` registry + Ollama client + conversation memory.
- **P6 · Sync / multi-instance** — mDNS (Network), Ed25519 (CryptoKit), sync feed, cloud-bridge push.

**Cutover model:** shared `lariat.db` lets each phase flip its surfaces native while the web
app keeps serving the rest — no big-bang.

---

## 3. P0 Foundation — detailed design

### 3.1 Goal / success criteria

A **macOS** app opens the **live `lariat.db`** and renders the **Management rollup** with
numbers matching the web `/management` page, and **updates live** when the web app re-runs the
compute engine. Host-run Core tests are green.

P0 ships no writes and only the one manager surface — it exists to prove the foundation
end-to-end (Swift/GRDB can open the WAL DB the web app writes, map the schema, render correct
data on macOS, and react to external writes).

### 3.2 The proof surface — Management rollup

`app/management/page.jsx` aggregates six read sources, rendered as tiles. P0 reproduces these:

1. **Accounting variance** — theoretical vs actual COGS (`lib/computeEngine` `readLatestAccountingVariance`)
2. **Dish coverage** — snapshot-first (`dish_coverage_snapshots`), fallback compute
3. **Costing-ingest freshness** — last costing ingest marker
4. **Depletion exceptions** — `listDepletionExceptions`
5. **Price shocks** — `listPriceShocks`
6. **Unacknowledged pack-size changes** — `COUNT(*) … WHERE acknowledged = 0`

### 3.3 Modules

**`LariatDB` (Core)** — the shared-DB spine.
- Opens `lariat.db` via GRDB `DatabasePool` (WAL → concurrent with web writes).
- Mirrors the web app's connection pragmas (`foreign_keys=ON`, `busy_timeout`); resolves the DB
  path with the **same data-dir logic** as the web app so both point at one file.
- **Read-only posture; never runs migrations** (web app owns the schema). Decodes rows by column
  name so unknown/extra columns from web-side migrations don't break decoding.
- **Schema-version guard:** read the web app's migration/version marker (e.g. a `schema_migrations`
  table) if one exists; on mismatch or absence, degrade gracefully (warn + read what's available)
  rather than crash. *(Confirming the marker exists is an early implementation task.)*

**`LariatModel` (Core)** — records + contracts.
- GRDB `FetchableRecord` row types for the six rollup sources, faithful to the `db.ts` row types.
- Invariant primitives as **protocols** now (implemented in write phases): `AuditedWrite`
  (transactional source-row + audit-event), `RuleGate` (`needs_corrective_action` 422),
  `PinGate`, `LocationScope`. P0 actually uses `LocationScope` (reads are location-scoped).

**`LariatApp` (SwiftUI, macOS-first)** — shell + screen.
- `NavigationSplitView` with a manager-sections sidebar (only **Management** active in P0); a DI
  container injecting repositories/the pool into view models.
- `ManagementRollupView` ← `@Observable ManagementRollupViewModel` ← repositories.
- **Live updates** via GRDB `ValueObservation` (tiles refresh when the web app writes).
- Swift `formatDollars` mirroring `lib/formatMoney` precision.

### 3.4 Data flow

`View ← @Observable ViewModel ← Repository (ValueObservation) ← DatabasePool ← lariat.db`.
One-way, read-only, reactive.

### 3.5 Error handling

- DB file missing/unreadable → explicit state showing the resolved path.
- DB locked (web mid-write) → `busy_timeout` retry; never block the UI.
- Missing table / schema drift → degrade **per-tile** ("unavailable") rather than failing the screen.
- Empty data (no compute run yet) → "no data yet" tile states.

### 3.6 Testing

- Host-run Core tests (`swift test`, no simulator) against a **seeded temp SQLite fixture**:
  assert record decoding + rollup aggregation match expected values. Mirrors `LariatKDSCoreTests`.
- Optional gated smoke against a real `lariat.db` to validate live decoding.
- UI/snapshot tests deferred.

### 3.7 Out of P0 scope (YAGNI)

Any writes · other manager surfaces (command/analytics/costing-detail = P1) · cook-tier / HACCP /
sync / assistant · iPad & iPhone UI (P0 is macOS-first) · folding in `LariatKDSCore` (P2).

### 3.8 Key risks

- **Shared-DB write contention** — web app holds write locks; mitigate with `busy_timeout` +
  read-only pool + never migrating.
- **Schema drift** — web app migrations change columns; mitigate with name-based decoding + the
  schema-version guard + per-tile degradation.
- **Data-dir resolution mismatch** — if Swift resolves a different path than the web app, it reads
  a stale/empty DB; the path logic must be verified against the web app's resolver as the first
  implementation task.
