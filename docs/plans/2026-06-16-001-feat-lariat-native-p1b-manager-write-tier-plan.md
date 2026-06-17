---
title: "feat: Lariat Native P1b — manager write tier (pack-size acknowledge)"
date: 2026-06-16
type: feat
depth: standard
origin: docs/superpowers/specs/2026-06-16-lariat-native-p1a-manager-read-tier-design.md
---

# feat: Lariat Native P1b — manager write tier (pack-size acknowledge)

## Summary

Drop the read-only posture for one manager write path: **PIN-gated pack-size change acknowledgement** on the shared `lariat.db`, with management JSONL audit parity to the web app. Ship write-pool infrastructure, native PIN verification against `manager_pin_users`, a pack-changes triage screen, and polling refresh so the Management rollup tile count updates after ack — without schema migrations, HACCP `RuleGate` enforcement, or additional manager mutations.

## Problem Frame

P1a delivered the full manager **read** tier (Command, Analytics, Costing, six Management rollup tiles) against live `lariat.db`. Managers can see unacknowledged pack-size changes on the Management tile but must switch to the web app to acknowledge them. P1b is the first native **write** slice: prove cross-process WAL writes, PIN gating, and audit logging on macOS before broader manager mutations or regulated `audit_events` writes in later phases.

The shared database model is unchanged: the web app owns migrations; native opens the same file and must never run `DatabaseMigrator`. Writes are limited to costing-side management actions that the web already performs.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Open a **writable** GRDB `DatabasePool` on the same path as P1a reads (`resolveDatabasePath()`), with `busyMode = .timeout(5.0)` and `foreignKeysEnabled = true`. Never migrate. |
| R2 | Verify manager PIN before any write: SHA-256 hash of 4–6 digit PIN matched against active `manager_pin_users` for the default location, with `LARIAT_PIN` env override parity to `app/api/auth/pin/route.ts`. |
| R3 | Hold an in-app PIN session (8-hour max, mirroring web cookie TTL) so repeated acks in one shift do not re-prompt every row. |
| R4 | List pack-size changes with the same filters as web (`open` / `acknowledged` / `all`, optional vendor prefix, limit cap 1000 default 200). |
| R5 | Acknowledge one `pack_size_changes` row by id: idempotent when already acknowledged; `UPDATE … SET acknowledged = 1` inside a transaction when not. |
| R6 | Append a management-action audit line to `<dataDir>/audit/management-actions.jsonl` on first-time ack, matching `lib/auditLog.mjs` field shape (`action: pack_size_change_acknowledged`, vendor/sku/prev/new, optional note). |
| R7 | Surface errors without blanking unrelated UI: per-row ack failure, PIN failure, DB unavailable, empty queue — line-cook copy per `docs/UI_COPY_RULES.md`. |
| R8 | After ack, Management rollup tile **Pack-size changes unack'd** count decreases on the next poll (same polling model as P1a). |
| R9 | `RuleGate` and regulated `audit_events` (`postAuditEvent`) remain **unimplemented** for this mutation — web routes pack-size ack to JSONL, not `audit_events` (see origin P1b note and `lib/packChangesRepo.ts` header). |
| R10 | macOS 14+ only for P1b UI; iOS deferred. |

**Success criteria:** A manager with a configured PIN can open Pack-size changes from native, acknowledge an open row, see it leave the open list, and see the Management tile count drop — while the web `/costing/pack-changes` view reflects the same row state. `swift test` stays green.

## Key Technical Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| KTD1 | **Separate `LariatWriteDatabase`** alongside read-only `LariatDatabase` | P1a tests and views depend on read-only guarantees (`LariatDatabaseTests` asserts write throws). Writes opt in explicitly. |
| KTD2 | **First concrete write = pack-size ack only** | User-confirmed scope; matches Management tile subcopy and existing web route (`app/api/costing/pack-changes/route.js`). |
| KTD3 | **Management JSONL audit, not `audit_events`** | Web parity (`lib/packChangesRepo.ts`, `lib/auditLog.mjs`). Implement `ManagementAuditLogger`; leave `AuditedWrite` protocol wired for a future regulated mutation (P3). |
| KTD4 | **Native PIN session in Keychain**, not shared web cookie | Cookie is HttpOnly browser state; native must verify PIN locally against DB hash. Session stores verified `ManagerPinUser` id/name/role + expiry. |
| KTD5 | **Audit failure after DB commit: log and continue** | Matches web POST handler — ack is idempotent; surfacing 500 on audit failure would encourage harmful retries. |
| KTD6 | **No HTTP to web API for writes** | Direct SQLite write preserves offline/LAN deployment and avoids cookie bridging. Read paths unchanged. |
| KTD7 | **`RuleGate` deferred to P3** | Pack-size ack has no HACCP corrective-action contract; stub protocol stays in `InvariantContracts.swift`. |

## High-Level Technical Design

```mermaid
sequenceDiagram
    participant UI as PackChangesView
    participant Pin as PinSession / PinVerifier
    participant Repo as PackChangesRepository
    participant DB as lariat.db (WAL)
    participant Audit as management-actions.jsonl

    UI->>Pin: requireSession (sheet if expired)
    Pin-->>UI: ManagerPinUser context
    UI->>Repo: acknowledge(id, note)
    Repo->>DB: BEGIN; SELECT row; UPDATE if needed; COMMIT
    alt first-time ack
        Repo->>Audit: append JSONL entry
    end
    Repo-->>UI: AckResult
    UI->>UI: refresh list + rollup poll
```

**Write vs read pools:** `LariatApp` holds one `LariatWriteDatabase` (writable pool) passed only to write-capable views/repos; existing read views keep `LariatDatabase` to preserve accidental-write guards.

## Scope Boundaries

### In scope

- Writable pool, PIN verify + session, management JSONL logger, pack-changes repository + UI, navigation from Management tile, tests with in-memory/temp-file DB.

### Deferred for later (product roadmap)

- Regulated `audit_events` writes and `AuditedWrite` production use (P3 HACCP surfaces).
- `RuleGate` implementation and 422 corrective-action UX.
- Additional manager writes (performance reviews, margin moves, recipe edits, remaining five web Management tiles).
- iOS write surfaces, traffic-light tile colors, dishCostBridge costing parity.
- Idempotency keys (`withIdempotency`) — single-device native ack does not need web idempotency table in P1b.

### Deferred to Follow-Up Work

- Optional `docs/superpowers/specs/2026-06-16-lariat-native-p1b-manager-write-tier-design.md` design doc (mirror P1a spec PR pattern) — plan is sufficient to implement; spec PR can trail implementation.

### Outside this product's identity

- Cloud sync, multi-tenant auth, or replacing web as schema owner.

## System-Wide Impact

| Party | Impact |
|-------|--------|
| Managers (BOH) | Can clear pack-size queue from native app without browser context switch. |
| Web app | Remains schema owner; concurrent writes via WAL; native ack visible on web list after refresh. |
| Audit trail | New JSONL lines from native interleaved with web lines in same file — same as multi-browser web usage. |
| Developers | Two pool types to inject; PIN test fixtures need `manager_pin_users` seed rows. |

## Risks and Dependencies

| Risk | Mitigation |
|------|------------|
| WAL lock contention with web ingest | Keep `busyMode` timeout; show “database busy, try again” on `SQLITE_BUSY`. |
| PIN hash drift vs web | Port `hashPin` exactly: SHA-256 hex of UTF-8 PIN string (`lib/tempPin.ts`). |
| Audit path mismatch | `resolveManagementAuditPath()` mirrors `lib/auditLog.mjs` + `resolveDataDir()`; unit test with `LARIAT_AUDIT_PATH` override. |
| No PIN configured | Gate ack UI with clear copy (“PIN not set up — use web Settings”); list readable without PIN (manager read tier). |
| Schema drift on `pack_size_changes` | Repository uses explicit column list; fixture tests match production migration shape. |

**Depends on:** P1a merged (`main`), `manager_pin_users` table populated for real PIN (or `LARIAT_PIN` in dev).

## Implementation Units

### U1. Writable database pool

**Goal:** Opt-in writable GRDB pool on the shared DB path without breaking read-only tests.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `LariatNative/Sources/LariatDB/LariatWriteDatabase.swift`
- Modify: `LariatNative/README.md` (write posture note)
- Test: `LariatNative/Tests/LariatDBTests/LariatWriteDatabaseTests.swift`

**Approach:** Mirror `LariatDatabase` init but `config.readonly = false`. Expose `pool: DatabasePool` and `write<T>(_ block:)` helper. Document that callers must not run migrations.

**Patterns to follow:** `LariatNative/Sources/LariatDB/LariatDatabase.swift`

**Test scenarios:**
- Happy path: temp-file DB, insert into `pack_size_changes` succeeds.
- Error path: missing DB file throws on open (same as read pool).
- Integration: concurrent read pool + write pool on same path sees committed row.

**Verification:** `LariatWriteDatabaseTests` green; existing `LariatDatabaseTests` still assert read pool rejects writes.

---

### U2. Data directory and management audit path

**Goal:** Resolve `data/` root and JSONL audit file the same way as Node (`lib/dataDir.ts`, `lib/auditLog.mjs`).

**Requirements:** R6

**Dependencies:** None

**Files:**
- Create: `LariatNative/Sources/LariatDB/DataDirectory.swift`
- Test: `LariatNative/Tests/LariatDBTests/DataDirectoryTests.swift`

**Approach:** `resolveDataDirectory()` from `LARIAT_DATA_DIR` / cwd. `resolveManagementAuditPath()` → `<dataDir>/audit/management-actions.jsonl`, honoring `LARIAT_AUDIT_PATH` env override.

**Patterns to follow:** `LariatNative/Sources/LariatDB/DatabasePaths.swift`, `lib/auditLog.mjs`

**Test scenarios:**
- Absolute and relative `LARIAT_DATA_DIR`.
- `LARIAT_AUDIT_PATH` override wins.
- Whitespace-only env falls back to `<cwd>/data`.

**Verification:** Path tests mirror `DatabasePathsTests` style.

---

### U3. Manager PIN verification and session

**Goal:** Verify PIN against DB (and env override) and hold an 8-hour session for write authorization.

**Requirements:** R2, R3

**Dependencies:** U1 (read `manager_pin_users`)

**Files:**
- Create: `LariatNative/Sources/LariatModel/PinHash.swift`
- Create: `LariatNative/Sources/LariatModel/PinVerifier.swift`
- Create: `LariatNative/Sources/LariatModel/ManagerPinUser.swift`
- Create: `LariatNative/Sources/LariatApp/PinSessionStore.swift`
- Test: `LariatNative/Tests/LariatModelTests/PinVerifierTests.swift`

**Approach:** `PinHash.sha256Hex(_ pin: String)` matches Node `hashPin`. `PinVerifier.verify(pin:locationId:db:)` checks `LARIAT_PIN` env with constant-time compare first, else `SELECT … FROM manager_pin_users WHERE pin_hash = ? AND is_active = 1`. `PinSessionStore` saves actor + expiry in Keychain; `requireSession()` throws `PinRequired` if missing/expired.

**Execution note:** Implement `PinHash` + `PinVerifier` test-first against known vectors from `tests/js/test-manager-pins.mjs`.

**Patterns to follow:** `lib/tempPin.ts`, `lib/managerPins.ts`, `app/api/auth/pin/route.ts`

**Test scenarios:**
- Happy path: seeded hash matches 4-digit PIN returns user id/name/role.
- Error path: wrong PIN returns nil / throws.
- Edge case: `LARIAT_PIN` override matches without DB row.
- Edge case: inactive `manager_pin_users` row rejected.
- Edge case: PIN length 3 and 7 rejected (format validation).
- Session: store + reload before expiry; expired session requires re-verify.

**Verification:** Pin tests green; manual smoke with dev `LARIAT_PIN` optional.

---

### U4. Management audit JSONL logger

**Goal:** Append management-action audit entries compatible with web JSONL consumers.

**Requirements:** R6, KTD5

**Dependencies:** U2

**Files:**
- Create: `LariatNative/Sources/LariatModel/ManagementAuditLogger.swift`
- Test: `LariatNative/Tests/LariatModelTests/ManagementAuditLoggerTests.swift`

**Approach:** `logPackSizeAcknowledged(...)` builds entry dict with `action`, `pack_size_changes_id`, vendor, sku, prev/new pack fields, optional note, ISO timestamp, generated id prefix `audit_`. Create `audit/` dir if needed; append one JSON line + newline. Throw on IO error (caller decides swallow-after-commit policy).

**Patterns to follow:** `lib/auditLog.mjs` (`logAuditAction` payload from `app/api/costing/pack-changes/route.js`)

**Test scenarios:**
- Happy path: writes valid JSONL line to temp path via `LARIAT_AUDIT_PATH`.
- Happy path: second append adds second line without corrupting first.
- Error path: read-only directory propagates error to caller.

**Verification:** Logger tests parse written line with `JSONDecoder`.

---

### U5. Pack changes repository (read + write)

**Goal:** Port `lib/packChangesRepo.ts` list/count/acknowledge semantics to Swift.

**Requirements:** R4, R5, KTD5

**Dependencies:** U1, U4

**Files:**
- Create: `LariatNative/Sources/LariatDB/PackChangesRepository.swift`
- Modify: `LariatNative/Sources/LariatModel/Records.swift` (extend `PackSizeChange` with prev/new pack, prices, detected_at for list UI)
- Test: `LariatNative/Tests/LariatDBTests/PackChangesRepositoryTests.swift`

**Approach:** SQL mirrors TypeScript: filter clauses, ingredient LEFT JOIN via `ROW_NUMBER() OVER (PARTITION BY vendor, sku ORDER BY id DESC)`, `priceDeltaPct` helper in `LariatModel/Compute/` if needed. `acknowledge(id:note:auditLogger:)` runs transaction: load row → if already ack return `wasAlreadyAcknowledged` → else UPDATE → on success call audit logger (audit after commit to match web ordering).

**Patterns to follow:** `lib/packChangesRepo.ts`, `app/api/costing/pack-changes/route.js`, `tests/js/test-pack-changes-repo.mjs`, `tests/js/test-pack-changes-route.mjs` (parity oracle)

**Test scenarios:**
- Happy path: open filter returns only `acknowledged = 0` rows.
- Happy path: first ack sets `acknowledged = 1` and writes audit line.
- Edge case: second ack same id is idempotent (`wasAlreadyAcknowledged`, no duplicate audit).
- Error path: unknown id returns not-found result (no throw).
- Integration: ack decrements count query used by `ManagementRollupRepository`.

**Verification:** Repository tests use `Fixtures.swift` extended with multi-row pack changes.

---

### U6. Pin gate UI and pack-changes screen

**Goal:** Manager-facing triage UI with PIN sheet and navigation from Management tile.

**Requirements:** R3, R7, R8, R10

**Dependencies:** U3, U5

**Files:**
- Create: `LariatNative/Sources/LariatApp/PinEntrySheet.swift`
- Create: `LariatNative/Sources/LariatApp/PackChangesView.swift`
- Modify: `LariatNative/Sources/LariatApp/LariatApp.swift` (inject write DB; navigation to pack changes)
- Modify: `LariatNative/Sources/LariatApp/ManagementRollupView.swift` (tile tap → pack changes)
- Modify: `LariatNative/Sources/LariatModel/InvariantContracts.swift` (document `PinGate` conformance)

**Approach:** `PackChangesView` loads list via repository on appear + filter changes; polling timer aligned with P1a management refresh. Ack button → if no session, present `PinEntrySheet` → on success call `acknowledge`. Optional note field in SwiftUI sheet. Navigation from pack-size tile. Line-cook labels per UI copy rules.

**Patterns to follow:** `app/costing/pack-changes/page.jsx`, `app/costing/pack-changes/AckButton.jsx`, `ManagementRollupView.swift` polling

**Test scenarios:**
- Test expectation: none — SwiftUI views covered by repository/session tests; manual QA for navigation.

**Verification:** App builds; manual ack flow updates tile count within one poll interval.

---

### U7. Protocol wiring and documentation

**Goal:** Activate `PinGate` for the write path; document `AuditedWrite` / `RuleGate` deferral; update native README.

**Requirements:** R9

**Dependencies:** U3, U5

**Files:**
- Modify: `LariatNative/Sources/LariatModel/InvariantContracts.swift`
- Modify: `LariatNative/README.md`
- Create: `LariatNative/Sources/LariatModel/ManagementWrite.swift` (orchestrator: PIN check + repo call)

**Approach:** `ManagementWrite` bundles PIN check + repository write. Comment that `AuditedWrite` will wrap `audit_events` transactions in P3; `RuleGate` unused.

**Patterns to follow:** P1a spec deferred items

**Test scenarios:**
- Happy path: unit test `ManagementWrite` rejects when session empty.

**Verification:** README accurate; protocol stubs remain for P3.

---

## Open Questions

| Question | Status |
|----------|--------|
| Should native pack-changes **list** require PIN? | **Resolved:** ack requires PIN; list remains readable (manager read tier). |
| iOS write in P1b? | **Deferred** — macOS only. |

## Sources and Research

- Origin: `docs/superpowers/specs/2026-06-16-lariat-native-p1a-manager-read-tier-design.md`
- Web write reference: `app/api/costing/pack-changes/route.js`, `lib/packChangesRepo.ts`, `lib/auditLog.mjs`
- PIN: `lib/managerPins.ts`, `lib/tempPin.ts`, `app/api/auth/pin/route.ts`
- P1a plan: `docs/superpowers/plans/2026-06-16-lariat-native-p1a-manager-read-tier.md`
- `docs/PATTERNS.md` §3 (file audit vs `audit_events` split)
- External research: skipped — local web + P1a patterns are authoritative.

## Acceptance Examples

| ID | Example |
|----|---------|
| AE1 | Manager opens Pack-size changes, sees open rows matching web queue for same DB. |
| AE2 | Manager enters PIN once, acknowledges row id N with note; row leaves open list; Management tile count drops by 1. |
| AE3 | Manager acknowledges already-ack row — success without duplicate audit line. |
| AE4 | Wrong PIN — no DB mutation; error shown. |
| AE5 | Web pack-changes page shows acknowledged after native ack (shared DB). |
