# LariatNative (P0 Foundation)

macOS app reading the live `lariat.db` (shared with the web app) via GRDB.

This is **P0** of the native Swift rewrite — the foundation: a read-only GRDB stack
over the shared SQLite database, the invariant-primitive contracts, and a macOS shell
rendering a read-only Management rollup (3 tiles) that proves the shared-DB approach
end-to-end. The web app keeps writing the database; the native app reads it and never
migrates.

## Run against real data

```bash
LARIAT_DATA_DIR=/absolute/path/to/lariat/data swift run LariatApp
# Reads <LARIAT_DATA_DIR>/lariat.db read-only. The web app keeps writing;
# the rollup tiles poll every 3 seconds for fresh data.
```

If `LARIAT_DATA_DIR` is unset, the app reads `<cwd>/data/lariat.db` (mirrors the
web app's `lib/dataDir.ts`).

## Test

```bash
swift test   # host-run Core tests (LariatDB + LariatModel); no simulator needed
```

## Layout

- `LariatModel` — GRDB record types + invariant-primitive contracts (`AuditedWrite`, `RuleGate`, `PinGate`) + `LocationScope`
- `LariatDB` — read-only `DatabasePool` over the shared DB, path resolution, and the management-rollup repository (with a polling refresh stream)
- `LariatApp` — macOS SwiftUI shell + the read-only Management rollup screen
