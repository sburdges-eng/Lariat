# LariatNative A5 — Management Writes Wave (audit-log / PINs / receiving-matches)

**Date:** 2026-07-02
**Branch:** `feat/lariat-native-a5-management`
**Scope:** three manager-tier boards ported from the web management surface into
`LariatNative`, per the A5 dispatch brief. One worktree, one branch, Swift + docs only.

## Boards

### Board 1 — `manager.auditLog` (read-only)
- **Web spec:** `app/management/audit-log/page.jsx`, `app/api/audit/log/route.js`,
  `lib/auditLog.mjs`. Parity oracle: `tests/js/test-audit-log-pagination.mjs`.
- **Native shape:**
  - `LariatModel/AuditLogRecords.swift` — `ManagementAuditEntry` (tolerant JSONL
    decode: `id`, `timestamp`, `action`, `slug`, `user`, `changes` payload, raw JSON)
    plus pure parse/filter/ordering functions (`AuditLogCompute`): whole-content
    line iteration, corrupted-line skip, newest-first reverse, `getRecent(limit:)`
    tail slice, action/slug filters with **no** legacy 1000-entry cap, inclusive
    date-range export with NaN-timestamp skip and unparseable-bounds → `[]`.
  - `LariatDB/ManagementAuditLogReader.swift` — buffered whole-file read at the
    path from the existing `resolveManagementAuditPath` (honors `LARIAT_AUDIT_PATH`,
    else `<dataDir>/audit/management-actions.jsonl`); file-missing → `[]` no-throw.
  - `LariatApp/AuditLogView(.swift)` + `AuditLogViewModel` — filterable table
    (action picker, slug picker, `.searchable` free text), expandable changes
    payload rows, count label. STRICTLY read-only: no write imports.
- **Ported test cases (value parity):** 1500-entry scan with matches at
  10/50/100/250/700 (all surface, newest-first); slug matches past legacy cap;
  empty file → []; no matches → []; corrupted line skipped with valid neighbors;
  exportAuditLog inclusive range + newest-first + start>end → [] + bad entry
  timestamps skipped + unparseable bounds → []; missing file → []; partial tail
  line skipped.

### Board 2 — `manager.pins` + `manager.tempPins` (security-critical writes)
- **Web spec:** `app/management/pins/page.jsx`, `app/management/temp-pins/page.jsx`,
  `app/api/auth/manager-pins/route.js`, `app/api/auth/temp-pin/{issue,list,revoke}`,
  `lib/managerPins.ts`, `lib/tempPin.ts`. Oracles: `tests/js/test-manager-pins.mjs`,
  `tests/js/test-temp-pin-rules.mjs`, `tests/js/test-temp-pin-routes.mjs`.
- **Native shape:**
  - `LariatModel/TempPinScopes.swift` — `KNOWN_SCOPES` port (exact list + order),
    `serializeScopes` (throws on unknown scope), `isExpired` fail-closed rule,
    `ManagerPinRecord` / `TempPinRecord` row types (snake_case CodingKeys).
  - `LariatDB/ManagerPinRepository.swift` — `create` (name required ≤80, PIN
    4–6 digits via `PinHash.validateFormat`, role ∈ {manager, owner}, default
    `manager`; INSERT pin_hash only; audit `entity=manager_pin_user action=insert`
    same txn), `update` (merge semantics — absent fields keep existing; re-hash
    only when a new PIN arrives; `disabled_at` CASE parity; audit `action=update`),
    `disable` (= update isActive=false), `list` (`is_active DESC, updated_at DESC,
    id DESC`, includeDisabled). Typed `ManagerPinWriteError` thrown BEFORE any
    write/audit. Never stores/logs/returns a raw PIN or hash.
  - `LariatDB/TempPinRepository.swift` — `issue` (label required ≤200 clip,
    canonical-ISO future expiry, ≥1 scope all ∈ KNOWN_SCOPES, pin_length default 4
    clamp to 4–6, `SystemRandomNumberGenerator` PIN with leading-zero padding,
    UNIQUE pin_hash collision retry ×5, INSERT + audit `entity=temp_pin
    action=insert` one txn, raw PIN returned ONCE in the result and never
    persisted), `listActive` (`revoked_at IS NULL AND datetime(expires_at) >
    datetime('now')`, metadata only — never pin_hash), `revoke` (not-found typed
    error; already-revoked idempotent without a second audit row; else stamp
    `revoked_at` + audit `action=update` one txn).
  - `LariatApp/ManagerPinsView` + VM; `TempPinsView` + VM — list + add form +
    inline edit (blank PIN = keep); issue form (label, expiry, scope checkboxes) +
    one-time issued banner + active list with revoke. All writes PIN-gated via
    `ManagementWrite.requireSession` / `PinEntrySheet` / `PinSessionStore`.
- **Documented divergences:** no `withIdempotency` layer natively (single-process
  direct call — no SW replay path; the web /issue route itself is deliberately
  NOT idempotent); `actor_source = native_mac` (web: `manager_ui`); typed errors
  instead of HTTP codes.

### Board 3 — `manager.receivingMatches`
- **Web spec:** `app/management/receiving-matches/page.jsx` +
  `ReceivingMatchResolver.jsx`, `app/api/receiving/matches/route.js`,
  `app/api/receiving/matches/[id]/route.js`. Oracle: web route code (no dedicated
  JS test covers the manager PATCH; `test-receiving-api.mjs` stops at "queued
  without credit" — native tests author the resolver path from the route code).
- **Native shape:** extend `LariatDB/ReceivingRepository.swift` with
  - `loadUnmatched(locationId:)` — status IN (accepted, accepted_with_note),
    received_qty > 0, received_unit non-blank, match_status IN (unmatched,
    ambiguous), `created_at DESC, id DESC LIMIT 100` (page query shape).
  - `resolveMatch(id:masterId:cookId:context:)` — validation ladder (positive id;
    master_id clip ≤200 + EXISTS in ingredient_masters else notFound; row exists
    at location else notFound; status must be accepted/accepted_with_note else
    conflict; qty>0 + unit non-blank + item non-null else conflict), then ONE
    transaction: UPDATE receiving_log SET master_id/match_status='matched'/
    match_reason='manager_selected' + audit `action=correction` with before/after
    payload + `note='receiving_match:<id>'`; closed-loop inventory credit —
    UPDATE the existing `inventory_updates` row's master_id (audit correction,
    `actor_source='receiving_match_resolution'`) when a credit exists for this
    receiving_log_id, else INSERT direction='in' credit (audit insert, same
    actor_source). All-or-nothing.
  - `LariatApp/ReceivingMatchesView` + VM — unmatched queue table + master picker
    + resolve button, PIN-gated per-write.
- **Documented divergence:** the web route also appends `sync_feed` ops via
  `appendOp` (cross-host sync transport). That transport stays on the edge —
  logged in `docs/superpowers/specs/lariat-native-edge-blockers.md` this wave.

## Registration (A0 self-registration only)
- One `FeatureModule` per board in `ManagerFeatures.swift`
  (`manager.auditLog`, `manager.pins`, `manager.tempPins`, `manager.receivingMatches`).
- One `FeatureDescriptor` each appended to `FeatureCatalog.all` under `.manager`.
- One line each appended to `FeatureRegistry.all`.
- `LariatApp.swift`, `FoodSafetyHubView.swift`, hub views untouched.

## Order + commits (resilience order per board)
Compute/Records → Repository → tests (red → green) → View/VM → registration,
one commit per board, plus one docs commit (this plan + the edge-blocker entry).

## Binding rules honored
- No migrations: test fixtures CREATE the existing web schema (audit_events,
  manager_pin_users, temp_pins, receiving_log, inventory_updates,
  ingredient_masters) verbatim from `lib/db.ts`.
- Never touches `data/lariat.db`; in-memory/temp GRDB fixtures only.
- Audit rows in the same transaction as source writes (AuditedWriteRunner +
  AuditEventWriter).
- Location scoping via `LocationScope.resolve()` / context.
