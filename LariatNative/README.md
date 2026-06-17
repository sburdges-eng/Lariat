# LariatNative (P2a Cook + AuditedWrite foundation + P1b manager writes)

macOS/iOS app reading the live `lariat.db` (shared with the web app) via GRDB.

Manager tier: four SwiftUI screens in a `NavigationSplitView`, `LariatModel/Compute/` parity ports,
and repositories for Command, Analytics, Costing, and Management rollup (6 tiles, traffic-light colors).
**Read-only by default** (`LariatDatabase`); pack-size acknowledge uses `LariatWriteDatabase` (JSONL audit).

**AuditedWrite foundation** adds in-transaction `audit_events` writes (`AuditEventWriter`, `AuditedWriteRunner`) —
parity with `lib/auditEvents.ts` so regulated native writes (86 board, line checks) can ship in P2b+.
`RuleGate` remains stub until HACCP corrective-action UX.

## Cook tier (P2a)

First **iPad-first** cook surface: **Today** shift board (`/v2/today` parity) in a **Cook** sidebar
section. Read-only — station progress, open 86 list, stock moves, cascaded recipe impacts. 86 writes,
station checklists, and KDS are stubbed ("Soon") until P2b–P2d.

```bash
# Point at the web app's data dir (needs data/cache/*.json + lariat.db)
LARIAT_DATA_DIR=/absolute/path/to/lariat/data swift run LariatApp
```

| Cook screen | Status |
|---|---|
| `TodayView` | **P2a** — hero stats, station grid, stock moves, 86 chips |
| 86 / Stations / KDS | Stubbed |

## Deployment floor: macOS 14 / iOS 17

The floor was raised from macOS 13 / iOS 16 to use:
- `@Observable` (macro-based observation, Swift 5.9) — replaces `ObservableObject` / `@Published`
- `ContentUnavailableView` — per-tile degrade placeholder (available macOS 14 / iOS 17)

## Run against real data

```bash
LARIAT_DATA_DIR=/absolute/path/to/lariat/data swift run LariatApp
# Reads <LARIAT_DATA_DIR>/lariat.db read-only. The web app keeps writing;
# each screen polls every 3 seconds for fresh data.
```

If `LARIAT_DATA_DIR` is unset, the app reads `<cwd>/data/lariat.db` (mirrors the
web app's `lib/dataDir.ts`).

## Test

```bash
swift test   # host-run Core tests (LariatDB + LariatModel); no simulator needed
# 150 tests (AuditedWrite foundation + P2a Today + P1b pack-size write)
```

## Architecture

### Compute layer (`LariatModel/Compute/`)

Pure Swift, GRDB-free modules that port the aggregation and derivation logic of the web's
TypeScript service functions. Repositories (`LariatDB`) fetch raw rows from SQLite;
compute modules (`LariatModel/Compute/`) derive values from those rows. The separation
means compute logic is deterministic, easily tested without a database, and auditable
against the web parity.

| Compute module | Web source |
|---|---|
| `CommandCompute` | `lib/commandCenter.ts` — summarize + alertsFor |
| `AnalyticsCompute` | `lib/analytics.ts` — daily/hourly/DOW aggregation, YoY delta |
| `CostingCompute` | `lib/costing.ts` — menu-engineering matrix + ABC ranking + variance trend |
| `DateMarkCompute` | date-mark filtering helpers |
| `ProbeCompute` | food-safety probe classification |
| `TempLogCompute` | temperature log red-breach counting |

### Polling refresh

Each screen polls its repository on a 3-second timer. `LariatDatabase` opens a
read-only `DatabasePool` but does not use GRDB `ValueObservation` — cross-process
writes from the web app are not visible to same-pool observation, so polling is the
correct approach here.

### Four manager screens

| Screen | Section key | Content |
|---|---|---|
| `ManagementRollupView` | `management` | 6-tile rollup — food cost vs. target, costing freshness, price shocks, depletion issues, menu items costed, pack-size changes unack'd |
| `CommandView` | `command` | Shift snapshot: sales, 86'd items, low-par, labor, reservations, food-safety (probes + temp logs), alerts |
| `AnalyticsView` | `analytics` | Swift Charts — daily totals, trailing YoY, hourly and day-of-week distributions, top items |
| `CostingView` | `costing` | Menu-engineering quadrant matrix, ABC ranking, accounting COGS variance trend |

The shell (`LariatApp`) opens one shared `LariatDatabase` at startup and injects it into
all four screens via initializer DI.

## Layout

```
LariatNative/
  Sources/
    LariatModel/
      Records.swift                 — GRDB record types for every table
      InvariantContracts.swift      — AuditedWrite / RuleGate / PinGate
      AuditEvent.swift              — AuditEventInput, RegulatedWriteContext
      ShiftDate.swift               — todayISO() parity with lib/db.ts
      LocationScope.swift           — location filter (LARIAT_LOCATION_ID env var)
      SchemaVersion.swift           — read-only schema-version probe
      Compute/
        CommandCompute.swift        — command-center summarize + alertsFor
        AnalyticsCompute.swift      — analytics aggregation and YoY delta
        CostingCompute.swift        — menu-engineering + ABC + variance trend
        DateMarkCompute.swift       — date-mark helpers
        ProbeCompute.swift          — food-safety probe classification
        TempLogCompute.swift        — temperature log breach counting
    LariatDB/
      LariatDatabase.swift          — read-only DatabasePool + polling stream
      LariatWriteDatabase.swift     — writable pool (never migrates)
      AuditEventWriter.swift        — in-tx audit_events insert (lib/auditEvents.ts)
      AuditedWriteRunner.swift      — regulated write transaction helper
      DatabasePaths.swift           — path resolution (LARIAT_DATA_DIR env var)
      ManagementRollupRepository.swift
      CommandRepository.swift
      AnalyticsRepository.swift
      CostingRepository.swift
    LariatApp/
      LariatApp.swift               — @main, NavigationSplitView shell, shared DB DI
      ManagementRollupView.swift    — 6-tile management rollup
      CommandView.swift             — shift command screen
      AnalyticsView.swift           — Swift Charts analytics screen
      CostingView.swift             — costing / menu-engineering screen
      Money.swift                   — currency formatting helpers
      TileDegrade.swift             — ContentUnavailableView per-tile fallback
  Tests/
    LariatModelTests/               — Compute + Records + Schema tests (no DB)
    LariatDBTests/                  — Repository tests (in-memory GRDB fixtures)
```

## Known limitations

- **Depletion tile** counts only `no_dish_components` rows (full resolver deferred).
- **Menu-engineering cost** — `dishCostBridge` not yet ported.
- **Margin moves** — `listMarginDeltas` not ported.
- **Costing variance section** — recipe-level `computeCostVariance` not ported.
- **Pack-size acknowledge (P1b)** — JSONL management audit (not `audit_events`).
- **Regulated writes (P2b+)** — use `AuditEventWriter` inside the same transaction as the source row.
