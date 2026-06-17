# Lariat Native — P1b: Manager/Mac first write tier (design)

**Date:** 2026-06-16
**Phase:** P1b (first write slice of the P1 · Manager/Mac tier)
**Builds on:** P1a read tier (PR #342), P0 Foundation (PR #340)
**Shipped:** PR #343 (`feat/lariat-native-p1b`), merge commit `50e8fe9`
**Implementation plan:** `docs/plans/2026-06-16-001-feat-lariat-native-p1b-manager-write-tier-plan.md`
**Predecessor spec:** `docs/superpowers/specs/2026-06-16-lariat-native-p1a-manager-read-tier-design.md`

## 0. Why this is "P1b", not more P1a

P1a locked the manager tier behind a read-only `DatabasePool` — the load-bearing safety
story for shared `lariat.db` with the web app. P1b is the **first deliberate break** of that
posture: a separate writable pool, PIN verification, and one management mutation with audit
parity to the web app.

Scope is intentionally **one write path** (pack-size acknowledge), not the full manager write
surface. Additional manager mutations (performance reviews, margin moves, recipe edits, the
remaining five web Management tiles) stay deferred so P1b can prove WAL cross-process writes,
PIN gating, and JSONL audit before regulated `audit_events` work in P3.

**Correction vs P1a §0:** P1a spec text suggested P1b would activate `AuditedWrite` against
`audit_events`. Shipped P1b matches **web behavior** for this mutation: management JSONL via
`lib/auditLog.mjs`, not `postAuditEvent`. `AuditedWrite` and `RuleGate` remain protocol stubs
until P3 HACCP surfaces.

## 1. Goal / success criteria

A **macOS 14** manager can open **Pack-size changes** from the native Management rollup,
enter a manager PIN once per shift, acknowledge an open `pack_size_changes` row, and see:

1. The row leave the open list and the Management tile **Pack-size changes unack'd** count drop
   on the next poll (same 3 s polling model as P1a).
2. The same row state on web `/costing/pack-changes` after refresh.
3. A new line in `<dataDir>/audit/management-actions.jsonl` on first-time ack, interleaved with
   web audit lines.

**Read tier survives write-pool failure:** if `lariat.db` is missing or the write pool cannot
open, Command / Analytics / Costing / Management **read** views still run on the read-only pool;
only pack-size ack is unavailable.

Success is proven when `swift test` is green (133 tests on ship) and manual smoke confirms ack
against a live `lariat.db` with `manager_pin_users` or `LARIAT_PIN` configured.

## 2. Scope

**In scope**

- **`LariatWriteDatabase`** — writable `DatabasePool` on the same path as reads; never migrates;
  refuses to create an empty DB file.
- **PIN gate** — SHA-256 hex hash of 4–6 digit PIN (`PinHash` / `PinVerifier`), matched against
  active `manager_pin_users` for the default location, with `LARIAT_PIN` env override parity to
  `app/api/auth/pin/route.ts`.
- **PIN session** — 8-hour in-app session (`PinSessionStore`) so repeated acks in one shift do
  not re-prompt every row; re-validates `manager_pin_users.is_active` on each ack.
- **`PackChangesRepository`** — list + acknowledge with web filter parity (`open` /
  `acknowledged` / `all`, vendor prefix, limit cap 1000 default 200).
- **`ManagementAuditLogger`** — append-only JSONL to `management-actions.jsonl`; serialized
  appends via a private queue.
- **`PackChangesView` + `PinEntrySheet`** — triage UI navigated from Management rollup tile 6.
- **Tests** — in-memory / temp-file fixtures; parity with `tests/js/test-pack-changes-*.mjs`.

**Out of scope (YAGNI)**

- Regulated `audit_events` writes and production `AuditedWrite` use (P3).
- `RuleGate` implementation and 422 corrective-action UX (P3).
- Additional manager writes beyond pack-size ack.
- Per-tile traffic-light **colors** on Management rollup (deferred from P1a).
- iOS write surfaces, `dishCostBridge` costing parity, web idempotency keys.
- HTTP proxy to web API for writes — native writes SQLite directly.

## 3. Architecture — dual pools on one file

No new SwiftPM modules. P1a's `LariatModel` / `LariatDB` / `LariatApp` split gains write-capable
types injected only where needed.

### 3.1 `LariatDB` — write pool + repository

- **`LariatWriteDatabase`** — `readonly = false`, `busyMode = .timeout(5.0)`, `foreignKeysEnabled = true`.
  Throws `databaseFileMissing` if the file does not exist (no silent empty DB creation).
- **`PackChangesRepository`** — owns ack transaction + optional JSONL append; uses explicit column
  lists tolerant of web-side schema drift on unrelated columns.
- Read-only **`LariatDatabase`** unchanged; P1a tests asserting write rejection stay valid.

### 3.2 `LariatModel` — PIN, audit, write orchestration

- **`PinHash` / `PinVerifier` / `ManagerPinUser`** — DB-backed PIN verify; `gateConfigured` tolerates
  missing `manager_pin_users` table.
- **`PinSession` / `PinSessionStore`** — session blob in `UserDefaults` (not shared web cookie);
  `validateActiveUser(db:)` re-checks DB on each write.
- **`ManagementWrite`** — bundles PIN check + repository call; documents future `AuditedWrite` wrap
  for P3.
- **`ManagementAuditLogger`** — `init(auditPath:)` only; default path from `resolveManagementAuditPath()`
  in `DataDirectory.swift` (single source of truth mirroring `lib/auditLog.mjs`).
- **`WriteErrorMapper`** — line-cook friendly copy for `SQLITE_BUSY`, missing row, PIN errors.

Invariant primitives: **`PinGate`** is partially realized via `ManagementWrite` + session;
**`AuditedWrite`** and **`RuleGate`** remain unimplemented protocols in `InvariantContracts.swift`.

### 3.3 `LariatApp` — optional write injection

- `LariatApp` opens read pool **required**, write pool **optional** (`try?`).
- `ManagementRollupView(database:writeDatabase:)` — tile 6 navigates to `PackChangesView` only when
  `writeDatabase != nil`; list remains readable without write pool (manager read tier).
- `NavigationStack` wraps detail routes for pack-changes push.

## 4. Web mapping — pack-size acknowledge

| Concern | Web source | Native shape |
|---|---|---|
| List | `lib/packChangesRepo.ts` `listPackChanges` | `PackChangesRepository.list` |
| Ack POST | `app/api/costing/pack-changes/route.js` | `PackChangesRepository.acknowledge` |
| PIN verify | `app/api/auth/pin/route.ts`, `lib/tempPin.ts` | `PinVerifier` |
| Audit | `lib/auditLog.mjs` → `management-actions.jsonl` | `ManagementAuditLogger` |
| UI | `app/costing/pack-changes/page.jsx`, `AckButton.jsx` | `PackChangesView`, `PinEntrySheet` |
| Rollup count | Management tile 6 query | `unacknowledgedCount()` + rollup poll |

**Audit contract:** `action: pack_size_change_acknowledged` with vendor/sku/prev/new fields and
optional note (max 500 chars). Audit failure after successful DB commit is logged and does not
roll back ack — matches web POST handler (idempotent ack; retries on audit failure are harmful).

## 5. Data flow

```mermaid
sequenceDiagram
    participant UI as PackChangesView
    participant Pin as PinSessionStore
    participant Repo as PackChangesRepository
    participant DB as lariat.db (WAL)
    participant Audit as management-actions.jsonl

    UI->>Pin: requireSession (sheet if expired)
    Pin-->>UI: ManagerPinUser context
    UI->>Pin: validateActiveUser(db)
    UI->>Repo: acknowledge(id, note, actor)
    Repo->>DB: BEGIN; SELECT; UPDATE if needed; COMMIT
    alt first-time ack
        Repo->>Audit: append JSONL (serialized queue)
    end
    Repo-->>UI: AcknowledgePackChangeResult
    UI->>UI: refresh list; rollup poll updates tile 6
```

**Live refresh:** unchanged from P1a — **polling** every 3 s; GRDB `ValueObservation` cannot see
web-app cross-process writes.

## 6. Error handling

- **DB file missing (write pool)** — read tier works; pack-size tile shows degrade / no navigation
  to ack UI.
- **`SQLITE_BUSY`** — friendly "database busy, try again" via `WriteErrorMapper`.
- **PIN not configured** — ack blocked with clear copy; open list still visible.
- **PIN invalid / user deactivated mid-session** — session cleared; re-prompt on next ack.
- **Missing ack row** — surfaced per-row without blanking the list.
- **Audit append failure** — log + continue; ack stands (web parity).

## 7. Testing

- Host-run Core tests (`swift test`, no simulator).
- **Repository tests:** list filters, idempotent ack, missing row, audit path override via env.
- **`LariatWriteDatabaseTests`:** rejects missing DB file; write pool accepts real INSERT.
- **`PinVerifierTests`:** hash parity, `LARIAT_PIN` override, gate-not-configured path.
- **Parity reference:** `tests/js/test-pack-changes-api.mjs`, `tests/js/test-pack-changes-repo.mjs`,
  `docs/PATTERNS.md` §3 (management JSONL audit).

No UI/snapshot tests (deferred, per P0/P1a).

## 8. Post-ship hardening (PR #343 review fix, `15a331a`)

Merged immediately after feature commit:

1. Read pool required / write pool optional at app launch.
2. No empty `lariat.db` creation on write open.
3. Audit path default centralized in `DataDirectory`.
4. Serialized JSONL appends.
5. `validateActiveUser` on each ack.
6. Orphaned XCTest method moved inside test class.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| WAL lock contention with web ingest | `busyMode` timeout; user-facing busy message |
| PIN hash drift vs web | Port `hashPin` exactly (`lib/tempPin.ts`); fixture tests |
| Audit path mismatch | `resolveManagementAuditPath()` mirrors web; env override test |
| PIN session in UserDefaults | Re-validate `is_active` on each ack; full Keychain hardening deferred |
| Schema drift on `pack_size_changes` | Explicit column lists; fixture matches migration shape |
| Accidental writes through read pool | Separate types; read pool `readonly = true` unchanged |

## 10. Cutover model

P1b flips **one** manager write workflow native while the web app remains schema owner and continues
to serve all other mutations. Native and web acks interleave in the same JSONL file and the same
`pack_size_changes` rows — identical to multi-browser web usage.

## 11. What comes next

**Remaining P1 manager work (no phase number yet):**

- Additional PIN-gated writes (performance reviews, margin moves, recipe edits, other Management tiles).
- Traffic-light tile colors on Management rollup.
- iOS surfaces when cook-tier (P2) justifies shared UI.

**Phase ladder (unchanged):**

- **P2 · Cook-tier** — today board, 86, KDS punch, station checklists (folds in `LariatKDSCore`).
- **P3 · HACCP + labor** — `RuleGate`, `AuditedWrite` / `audit_events`, first regulated write phase.
