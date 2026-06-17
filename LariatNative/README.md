# LariatNative (P1b — Manager write tier: pack-size ack)

macOS/iOS app reading the live `lariat.db` (shared with the web app) via GRDB.

This is **P1b** on top of P1a — the manager READ tier plus the first PIN-gated write: four SwiftUI manager
screens wired into a `NavigationSplitView` shell, a `LariatModel/Compute/` layer of
GRDB-free parity ports of the web's command/analytics/costing logic, and repositories for
Command, Analytics, Costing, and an extended Management rollup (6 tiles). The app is
**read-only by default** (`LariatDatabase`); pack-size acknowledge uses a separate writable pool (`LariatWriteDatabase`). Never migrates; web app keeps writing.

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
# 129 tests (P1b pack-size write path)
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
      InvariantContracts.swift      — AuditedWrite / RuleGate / PinGate stubs (P1b writes)
      LocationScope.swift           — location filter (LARIAT_LOCATION_ID env var)
      SchemaVersion.swift           — read-only schema-version probe (tested primitive; not yet wired into DB-open path — enforcement is a follow-up)
      Compute/
        CommandCompute.swift        — command-center summarize + alertsFor
        AnalyticsCompute.swift      — analytics aggregation and YoY delta
        CostingCompute.swift        — menu-engineering + ABC + variance trend
        DateMarkCompute.swift       — date-mark helpers
        ProbeCompute.swift          — food-safety probe classification
        TempLogCompute.swift        — temperature log breach counting
    LariatDB/
      LariatDatabase.swift          — read-only DatabasePool + polling stream
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

## Known limitations (P1a)

These are documented parity gaps relative to the web app; all are deferred to P1b or later:

- **Depletion tile** counts only `no_dish_components` rows. The full depletion resolver
  (which also accounts for mapped-but-zero-par dishes) is deferred.
- **Menu-engineering cost** reads a `cost_per_unit` column that production may not
  populate. The web uses a `dishCostBridge` rollup to derive unit costs from recipe
  components; that join is not yet ported.
- **Margin moves** show zero. `listMarginDeltas` (the web's margin-movement feed) is not
  ported; `CommandSummary.marginMoves` defaults to 0.
- **Costing variance section** shows the accounting COGS variance trend (theoretical vs.
  actual from `accounting_variances`). The web's recipe-level `computeCostVariance` card
  (which uses dish-level ingredient costs) is not ported.
- **Per-tile color signaling** (traffic-light green/amber/red) is not implemented. Tiles
  show value and label only; color thresholds are still deferred.
- **Pack-size acknowledge (P1b)** — PIN-gated write to `pack_size_changes` + JSONL management audit. Management tile links to `PackChangesView`.
- **Regulated `audit_events` / `RuleGate`** — still deferred (P3). `AuditedWrite` stub unused for pack ack (web parity).
- **Per-tile color signaling** — still deferred.
