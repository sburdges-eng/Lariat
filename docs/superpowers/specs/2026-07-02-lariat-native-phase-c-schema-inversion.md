# Phase C — Schema-Ownership Inversion (sub-spec)

**Date:** 2026-07-02
**Status:** Design complete; execution gated on Phase A exit + Phase B landing.
**Parent docs:** full-replacement roadmap (`2026-06-30-…-roadmap-design.md`),
Risk 2 outline (`2026-06-30-lariat-native-risk-mitigations.md`), endgame
(`2026-07-02-lariat-native-endgame.md` §3).

## Goal

Flip `LariatNative` from reader/audited-writer to **system of record**: native owns
the schema, the migrations, and the write-side business rules currently spread across
the ~130 web API routes. The web app keeps only the edge surfaces (Phase D scope) and
becomes a *client* of a schema it no longer owns.

**Engine decision:** SQLite stays. `data/lariat.db` remains the store; only *ownership*
inverts. No data migration, no engine change, no dual databases.

## Preconditions (hard gates — do not start C before all hold)

1. Phase A exit criteria met (every operator screen native at behavior parity).
2. Phase B (kitchen assistant) landed — its writes must already flow through native
   contracts so the rule inventory is complete.
3. The endgame §2 shut-off test has passed at least once (proves the web write path
   is no longer needed for operations).
4. A verified, restore-tested backup of `data/lariat.db` + the JSONL audit dir.

## Workstreams

### C1 — Rule inventory (the map; itself a deliverable)
Enumerate all ~130 `app/api/**` route files and classify each write path:
- **ported** — rule already lives in a native repository (cite the Swift file + test),
- **edge-retained** — stays on the web edge (guest e-sign, PWA endpoints; must appear
  in `lariat-native-edge-blockers.md`),
- **dead** — v2-frozen or unreachable; delete in Phase D.
Ledger format: route → rules (validation / status codes / audit semantics / idempotency /
location scoping) → native owner → parity test. **Exit:** zero unclassified routes.

### C2 — Migration ownership handoff
- Port the `lib/db.ts` migration list into a native `SchemaMigrator` (GRDB
  `DatabaseMigrator`), replaying the web's DDL history so a fresh DB built by native
  is byte-identical in schema (`sqlite3 .schema` diff = empty).
- Freeze web migrations: `lib/db.ts` migration array becomes append-forbidden (CI guard
  in the web repo: fail if the migration list grows).
- Introduce a `schema_version` handshake: native stamps the version; the web edge
  refuses to start against a version newer than it knows (fail-closed, clear error).
- **Single-DDL-writer rule:** from the flip forward, only native runs migrations.

### C3 — `actor_source` canonical taxonomy (Risk 3 resolution)
- Define the canonical enum in `LariatModel` as the union: the web's 16 surface values
  + `native_cook` / `native_mac` / `kds_app`, with a documented mapping table.
- Historical rows are **never rewritten** — the taxonomy applies to new writes only.
- The edge server's residual writes (`beo_client_share`) keep their existing value —
  it is part of the canonical set.

### C4 — Shadow / dual-write validation period
Native and web writers coexist today against the same DB (that *is* the current state).
Before removing the web write path, run a **reconciliation window of ≥7 consecutive
service days**, green on all invariants:
- per-table daily row-count deltas attributable to a known writer (`actor_source`),
- every mutation row has its in-transaction `audit_events` row (join check),
- money columns: no drift in the daily settlement/costing checksums vs the prior
  computation path,
- no writes with `actor_source` outside the canonical set.
Deliverable: a `scripts/phase-c-reconcile` check (runs read-only, prints a pass/fail
table) — run nightly during the window.

### C5 — Write-path cutover (per-domain flip order)
Remove web write routes in waves, lowest risk first; each wave = delete routes + verify
the native owner covers every rule in the C1 ledger + reconcile clean for 2 days:
1. read-mostly/diagnostic (health, discover, datapack),
2. operational logs (temp/cooling/sanitizer/cleaning/pest…, 86, KDS, prep),
3. labor + management (PIN issuance last within this group),
4. money + compliance (costing, settlement, tip-pool, receiving, inventory),
5. BEO internal (guest e-sign write stays on the edge, pinned to the C2 handshake).
The web login/PIN cookie machinery survives until Phase D decides the edge auth story.

### C6 — Rollback
- Every wave reversible: web routes are removed by *revertible commits* (no logic
  rewrites in the same change), and the "web as writer" capability is kept on a branch
  until C exit.
- Backup before each wave; restore drill performed once before wave 1.
- A documented fall-back switch: redeploy prior web build + native goes read-only
  (`LariatDatabase` default) — one command each, tested.

### C7 — Integrity parity tests
For each write rule in the ledger: a test that drives the same operation through the
native repository and asserts identical rows + `audit_events` shape as the frozen web
fixture (captured before its route is deleted). These live in `LariatNative/Tests` and
are the permanent regression floor after the web path is gone.

## Exit criteria

- C1 ledger: 100% classified; every "ported" row cites a green parity test.
- Native `SchemaMigrator` reproduces the schema exactly; web migration list frozen + CI-guarded.
- ≥7-day reconciliation window green; cutover waves 1–5 complete; edge writes limited
  to the edge-blocker set via the version handshake.
- Rollback drill documented and rehearsed once.
- The web codebase contains **zero** write routes outside the edge-blocker set → Phase D begins.

## Non-goals

- No engine/store change, no cloud DB, no historical-data rewrites.
- No new features during C (feature freeze on write paths while waves are flipping).
- The A5.4 cross-host sync/peers/cloud-bridge decision is Phase D scope if "edge" was
  chosen; C only requires its writes be classified in the ledger.
