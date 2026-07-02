# LariatNative

Native SwiftUI app (macOS 14 / iOS 17) for Lariat restaurant operations. It reads and
writes the **live `lariat.db`** shared with the web app via GRDB — the web app still owns
the schema (never migrate from Swift). The full-replacement program is tracked in
`docs/superpowers/specs/2026-06-30-lariat-native-full-replacement-roadmap-design.md` and
`docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`.

## Run

```bash
# Point at the web app's data dir (needs lariat.db + data/cache/*.json)
LARIAT_DATA_DIR=/absolute/path/to/lariat/data swift run LariatApp
```

If `LARIAT_DATA_DIR` is unset, the app reads `<cwd>/data/lariat.db` (mirrors the web
app's `lib/dataDir.ts`). Boards poll on a short timer — the read pool cannot observe
cross-process writes from the web app, so polling is the correct refresh model here.

### Keyboard (macOS)

- **⌘K** — command palette: fuzzy-jump to any registered board.
- **Boards menu** — "Jump to Board…" plus **⌘1…⌘n** to the first board of each tier.

## Test

```bash
swift test   # host-run, no simulator needed; in-memory GRDB fixtures, never the real DB
```

1,093 tests as of 2026-07-02 (696 `LariatModelTests` + 397 `LariatDBTests`). The count
grows every wave — trust the run, not this line.

## Architecture

Three layers, strict direction (`LariatApp` → `LariatDB` → `LariatModel`):

| Target | Role |
| --- | --- |
| `LariatModel` | Pure, I/O-free: record types, rule/`Compute/` parity ports of the web `lib/` modules, `FeatureCatalog` |
| `LariatDB` | Repositories over GRDB. Reads use `LariatDatabase` (read-only pool); regulated writes use `LariatWriteDatabase` |
| `LariatApp` | SwiftUI shell + one View/ViewModel pair per board |

### Feature self-registration (A0)

The shell is generic — `LariatApp.swift` never names a feature. Every screen registers
itself in three small steps, with **`Sources/LariatModel/FeatureCatalog.swift` as the
single source of truth** for which boards exist (ids, tiers, titles, sidebar order —
don't enumerate them here, read that file):

1. a `FeatureModule` (`makeView` owns the board's DI + `TileDegrade` fallback) in its
   tier group file (`CookFeatures.swift`, `SafetyFeatures.swift`, …);
2. one `FeatureDescriptor` appended to `FeatureCatalog.all` (stable id like `safety.cooling`);
3. one line appended to `FeatureRegistry.all`.

Sidebar sections, detail routing, the ⌘K palette, and the Boards menu all enumerate the
registry dynamically, so a new board appears everywhere the moment it is registered.
Inter-board navigation goes through `AppContext.navigate(id)` — never bespoke closures.

### Invariant contracts (write discipline)

`Sources/LariatModel/InvariantContracts.swift` — parity with the web routes' semantics:

- **`AuditedWrite`** — every regulated write inserts its `audit_events` row **in the same
  transaction** as the source row (`AuditEventWriter` / `AuditedWriteRunner`, parity with
  `lib/auditEvents.ts`). Never a second transaction.
- **`RuleGate`** — the HACCP 422 corrective-note contract: out-of-range writes are
  rejected unless a corrective note accompanies them.
- **`PinGate`** — manager-PIN gate for protected writes (`PinVerifier`, `TempPinVerifier`).

Writes tag `actor_source` (`native_cook`, …) and carry `location_id` via `LocationScope`.
Status-code semantics match the web routes (409 double-discard, 422 missing note, …).

## Layout

```text
LariatNative/
  Sources/
    LariatModel/    — records, Compute/ parity ports, FeatureCatalog, invariant contracts
    LariatDB/       — LariatDatabase (RO) / LariatWriteDatabase, repositories, audit writers
    LariatApp/      — @main shell (LariatApp.swift), CommandPalette, boards, tier group files
  Tests/
    LariatModelTests/   — compute/value-parity tests (no DB)
    LariatDBTests/      — repository tests (in-memory GRDB fixtures)
```

## Notes

- `LariatApp` is an executable target with no test target, so pure UI-layer logic there
  (e.g. `PaletteRanker`) is kept trivial and documented for manual exercise; anything
  substantial belongs in `LariatModel`/`LariatDB` where it is tested.
- Deployment floor macOS 14 / iOS 17 for `@Observable`, `ContentUnavailableView`, and
  `onKeyPress`.
- Known gaps and deliberate deferrals live in the endgame spec's edge-blocker log, not here.
