# Protected Contracts

Protected contracts are the repo behaviors where "clean refactor" is not enough. These surfaces carry operational truth, replication truth, trust boundaries, or recovery guarantees. If you touch them, preserve semantics first, structure second.

This document defines the system behaviors that must not drift during cleanup, refactors, route extraction, typing migrations, sync work, and platform separation. If a change touches one of these areas, reviewers should treat it as contract-sensitive even when tests still pass.

See also:
- `docs/ARCHITECTURE.md`
- `docs/PATTERNS.md`
- `docs/multi-instance-sync.md`
- `docs/cloud-bridge-design.md`

---

## 1. What Counts as a Protected Contract

A protected contract is any behavior whose failure can:

- corrupt inventory, accounting, labor, or compliance truth
- misstate manager-facing rollups
- lose, duplicate, or misapply cross-device operations
- leak trust or topology data
- duplicate, strand, or drop cloud-bound batches
- silently widen the blast radius of a route, helper, or migration

These contracts outrank stylistic cleanup, file moves, route-thinning, and local abstractions.

When in doubt: skip, isolate, or fail loud.

---

## 2. Review Rules for Protected Surfaces

When a PR touches a protected contract:

1. Do not mix protected-contract edits with docs-only cleanup.
2. Do not mix regulated ops logic with UI copy or layout churn.
3. Do not mix sync or cloud semantics with startup, packaging, or desktop wrapper work.
4. Require targeted verification for the specific contract family touched.
5. Prefer extracting tests before or alongside refactors, never after.
6. Treat a passing broad test suite as insufficient if the targeted contract tests were not run.
7. Preserve current fail-loud behavior where the code intentionally refuses silent drift.

---

## 3. Protected Contract Map

The current protected surfaces cluster into six groups:

1. deterministic ops ledger
2. management read models
3. sync replay and checkpoints
4. peer trust and topology boundaries
5. cloud bridge durability and recovery
6. sick-note PHI file custody (encryption, key escrow, retention/purge)

Each group is described below.

---

## 4. Deterministic Ops Ledger Contracts

These are the operational-accounting chains where a single write can fan out into inventory, depletion, compute, costing, management review, and compliance-visible outputs.

### Key files

- `lib/receiving.ts`
- `app/api/receiving/route.js`
- `app/api/receiving/matches/route.js`
- `app/api/receiving/matches/[id]/route.js`
- `app/api/inventory/route.js`
- `app/api/inventory/counts/route.js`
- `lib/salesDepletion.ts`
- `lib/depletionExceptions.ts`
- `app/api/costing/depletion-exceptions/route.js`
- `lib/computeEngine/index.ts`

### Core invariants

- Receiving rows may be preserved even when ingredient/master matching is unresolved.
- Inventory credit must not occur unless accepted quantity, accepted unit, and sufficiently trustworthy ingredient resolution exist.
- Manager reconciliation is a first-class repair path, not an incidental admin tool.
- Live ops writes that trigger compute work must not silently stop doing so.
- Depletion exceptions are part of the protected accounting path, not cosmetic reporting.
- Append-only audit behavior on regulated surfaces must remain transactionally tied to the source write.

### Reviewer prompts

- Does this change alter when inventory is credited?
- Can a row now bypass the manager repair queue?
- Can compute become stale after receiving or inventory writes?
- Could this change make depletion or variance look cleaner than reality?

---

## 5. Management Rollup Contracts

`/management` is the executive read model for the system. It compresses live operational, compliance, labor, costing, and exception signals into manager-visible truth.

If this surface drifts, the system can look healthy while being wrong.

### Key files

- `app/management/page.jsx`
- `lib/commandCenter.ts`
- `tests/js/test-management-rollup.mjs`

### Core invariants

- One broken tile reader must not blank the whole page.
- Tile readers must degrade gracefully on fresh or partial DBs.
- Location scoping must be preserved for every location-sensitive tile and link target.
- Expensive reads must remain bounded, capped, or snapshot-backed.
- Dashboard values must come from existing operational truth sources, not ad hoc shadow logic.
- Linked drill-down destinations must agree with the tile counts that send a manager there.

### Specific invariants to preserve

- Pack-size change count remains O(1), not a full recomputation scan.
- Dish coverage prefers snapshots and may intentionally skip inline scans above the configured cap.
- Receiving-match debt counts accepted rows that still require manager intervention.
- Cert warnings continue to distinguish expired from expiring soon.
- Price-shock and depletion tiles stay aligned with their destination views.
- The command-center summary remains a prioritized operations surface, not a vanity dashboard.

### Reviewer prompts

- Does this change alter what a manager would see as safe, warning, or urgent?
- Does location scoping still match the linked queue or page?
- Did we introduce a slower fallback that can stall page load?
- Are we turning a hard operational signal into a soft or missing signal?

---

## 6. Sync Replay Contracts

The sync subsystem is not a generic row copier. It is a family-based replay engine with deliberate refusal paths.

### Key files

- `lib/syncApply.ts`
- `lib/syncScheduler.ts`
- `lib/syncSchedulerLifecycle.ts`
- `lib/syncClient.ts`
- `app/api/peers/sync-since/route.js`
- `tests/js/test-sync-apply.mjs`
- `tests/js/test-sync-scheduler.mjs`
- `tests/js/test-sync-scheduler-lifecycle.mjs`
- `tests/js/test-sync-client.mjs`

### 6.1 Family classification

Every replicated table must belong to exactly one declared sync family or be intentionally unsupported.

#### Invariants

- `FAMILY_*_TABLES` names must match live schema exactly.
- `assertFamilyTablesExist()` is a boot guard, not an optional diagnostic.
- Scheduler boot must fail loudly on schema-name drift.

### 6.2 Family 1 contracts

Family 1 is for row-level live ops replay.

#### Invariants

- Family 1 rows land individually.
- Schema drift may drop unknown columns, but must not invent rows or silently remap tables.
- Update semantics must remain explicit where supported.
- `inventory_updates` replay that references `receiving_log` must remap source receiving ids to the local receiving row correctly.
- Sync-source metadata columns, when present, must remain attached to replayed provenance.

### 6.3 Family 2 contracts

Family 2 is envelope-based replay using scoped `DELETE + INSERT` replacement.

#### Invariants

- Replay envelope shape remains `{ where, rows }`.
- Empty `where` must be refused.
- Required `where` columns must be enforced per table.
- Unknown `where` columns must be treated as schema drift, not ignored.
- `DELETE + INSERT` must stay within one transaction.
- Default scoping behavior must not silently widen table deletes.

#### Operating rule

Better to skip than wipe too much.

### 6.4 Family 3 contracts

Family 3 is intentionally deferred until last-write-wins metadata exists.

#### Invariants

- Family 3 must not be “sort of applied.”
- Replay should log or audit the skip rather than fake correctness.
- Scheduler must still advance checkpoints when only family-3 rows appear, so replay does not loop forever.

---

## 7. Replay Checkpoint Contracts

Checkpoint logic decides what the node believes it has already seen. Drift here causes loops, lag, or silent data omission.

### Key files

- `lib/syncScheduler.ts`
- `lib/syncFeed.ts`
- `app/api/peers/sync-since/route.js`

### Core invariants

- Replay checkpoints are per-peer, not global.
- Checkpoint advancement uses authoritative server-observed progress, not local row-count guesses.
- Advancement must tolerate `sync_feed` rowid gaps.
- One peer’s failure must not block others.
- Re-fetch windows may be retried, but must not silently skip unseen rows.

### Specific invariant

Advance replay checkpoints using the authoritative highest-seen signal (`max(nextOp, lastSeenId)` behavior), not naive arithmetic from returned row count.

---

## 8. Peer Trust and Signed Fetch Contracts

The sync fetch route is a trust boundary, not just an internal endpoint.

### Key files

- `lib/peerTrust.ts`
- `app/api/peers/sync-since/route.js`
- `tests/js/test-peer-auth.mjs`

### Core invariants

- Only trusted, non-revoked Ed25519 peers may fetch sync windows.
- The canonical signing payload contract is frozen unless explicitly versioned.
- Timestamp skew checks must remain enforced.
- Successfully authenticated signed requests must be one-use within the replay-defense window.
- Auth failures and malformed-param failures must not create a useful oracle.
- `last_seen` must update only after a real successful sync fetch path.
- Re-trusting a revoked peer must be explicit, not a side effect of re-adding it.

### Specific invariant

`addPeer()` must not silently unrevoke a revoked peer.

---

## 9. Peer Discovery and Topology Disclosure Contracts

Peer discovery must work during cold start and pre-PIN flows, but topology leakage must stay bounded.

### Key files

- `app/api/peers/route.js`
- `lib/peers.ts`
- `lib/hubElection.ts`
- `tests/js/test-peers-route.mjs`

### Core invariants

- Unauthenticated callers may learn presence, not full topology or trust identity.
- Unauthenticated responses must redact host, port, addresses, version, and `pubkey_fp`.
- Authenticated callers may receive the full shape.
- Timeout inputs must remain clamped to prevent worker pinning.
- Helper return shape must stay aligned with route JSON shape.
- Discovery behavior must stay injectable for tests without changing production behavior.

---

## 10. Scheduler Boot and Peer-Source Safety Contracts

Peer configuration is also a network safety surface.

### Key files

- `lib/syncSchedulerLifecycle.ts`
- `tests/js/test-sync-scheduler-lifecycle.mjs`

### Core invariants

- Only `http` and `https` peer base URLs are allowed.
- Loopback, RFC1918, metadata, and `.local` peers must be rejected unless explicitly allowed by configuration.
- Boot may no-op when peers are absent; it must not casually collapse into unsafe defaults.
- Default peer identity must be stable per boot and host-derived, not `process.pid`-derived.
- Discovered peers must map to scheduler peer keys deterministically.
- Sync startup must preserve idempotent lifecycle behavior.

---

## 11. Cloud Bridge Outbox Contracts

The cloud bridge is a durable outbox plus recovery system for corp-bound snapshots. It is part of the operational transport plane.

### Key files

- `lib/cloudBridgeQueue.ts`
- `lib/cloudBridgeDrainer.ts`
- `lib/cloudBridgePush.ts`
- `lib/cloudBridgeCanonical.ts`
- `app/api/cloud-bridge/dead-letters/route.js`
- `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`
- `tests/js/test-cloud-bridge-drainer.mjs`
- `tests/js/test-cloud-bridge-dead-letters-api.mjs`
- `tests/js/test-cloud-bridge-queue-race-safety.mjs`
- `tests/js/test-cloud-bridge-push.mjs`
- `tests/js/test-cloud-bridge-canonical.mjs`
- `tests/js/test-cloud-bridge-envelope-golden.mjs`
- `tests/js/test-cloud-bridge-envelope-coverage.mjs`

### 11.1 Queue semantics

#### Invariants

- The queue is durable and SQLite-backed.
- Queue claim order remains FIFO by id unless explicitly redesigned.
- `claim()` is atomic.
- `ack()` removes the claimed row.
- `nack()` either requeues or dead-letters according to attempt budget.
- Dead-letter rows are invisible to ordinary claims.
- Stale claims are recoverable.

### 11.2 Ownership and shutdown

#### Invariants

- Graceful shutdown only releases claims owned by the current process.
- Crash recovery via stale-claim sweep must not become ownership-blind stealing of healthy work.
- Start and stop behavior must remain idempotent.
- In-flight work must be awaited or safely released during graceful stop.

### 11.3 Dead-letter triage

#### Invariants

- Dead-letter listing may be location-scoped.
- Requeue and drop may only affect dead-letter rows.
- Requeue must re-check the table allow-list before reviving a row.
- Dead-letter mutation routes must remain PIN-gated and location-safe.
- Management actions on dead letters must emit audit entries.
- Corrupt dead-letter payloads must remain inspectable enough to triage and drop.

### 11.4 Envelope wire contract

The signed `/v2/snapshot` body is the protected surface that lets a second
producer (the Swift native encoder) be byte-identical.

#### Invariants

- The signed body is CanonicalJSON (`lib/cloudBridgeCanonical.ts`) of
  `{ schema_version, table, location_id, batch_id, rows }`: keys sorted
  recursively, no whitespace, forward slash NOT escaped, integer numbers only.
- The signature is `HMAC-SHA256(secret, body ‖ String(batch_id))`, lowercase
  hex, no separator. This construction is frozen unless explicitly versioned.
- `schema_version` is the per-table wire version (`TABLE_WIRE_VERSION`),
  independent of the DB `SCHEMA_VERSION`; bump it only when a table's pushed row
  shape changes. A receiver must verify the HMAC before trusting it
  (parse-before-verify).
- The canonical rule is single-sourced with the Swift twin
  (`LariatModel/CloudBridge/CanonicalJSON.swift`) and pinned byte-for-byte by the
  golden fixtures on both stacks. Regenerate the fixtures only via
  `scripts/gen-cloud-bridge-golden-envelopes.mjs` and review the diff as a
  contract change.
- A non-integer / non-finite row value must fail loud, never silently produce a
  divergent MAC.

---

## 12. Sick-Note PHI File Contracts

Doctor's-note attachments carry PHI-adjacent content. The files themselves are ciphertext at rest, not merely access-controlled — encryption is the P0-6 audit-fix answer to a plaintext-on-disk gap.

### Key files

- `LariatNative/Sources/LariatModel/Crypto/SickNoteCrypto.swift`
- `LariatNative/Sources/LariatModel/Crypto/SickNoteMediaKey.swift`
- `LariatNative/Sources/LariatDB/SickNoteKeyStore.swift`
- `LariatNative/Sources/LariatDB/SickNoteRepository.swift`
- `LariatNative/Sources/LariatDB/SickNoteMigrator.swift`
- `LariatNative/Sources/LariatApp/UI/Support/SickNoteAttach.swift`
- `LariatNative/Sources/LariatApp/UI/Support/SickNoteKeychain.swift`
- `scripts/backup.mjs` (manifest key fingerprint only — never the key)
- `scripts/sick-note-retention.mjs`

### Core invariants

- Sick-note files on disk are `LSN1` ciphertext (AES-256-GCM), with AAD bound to the row's `file_path`; a ciphertext moved, renamed, or swapped between rows fails authentication.
- The media key (`<dataDir>/keys/sick-note-media.json`, 0600) lives outside `uploads/`; it must never enter `scripts/backup.mjs` output or git. Rotation is explicitly unsupported in v1 — losing the key permanently loses every document (mitigated by the Keychain mirror; see the backup key-escrow note in `docs/OPERATIONS.md`).
- Attach and purge are PIN-gated, audited writes (`actor_source = native_mac`) with the audit row committed in the same transaction as the data change.
- Attach and purge audit payloads are metadata-only and differ in shape: attach carries `report_id`, `location_id`, `file_path` (UUID-based, non-identifying), `kind`, `uploaded_by`, `uploaded_at`; purge carries `document_id`, `report_id`, `location_id`, `file_path`, `uploaded_at` (no `kind`, no `uploaded_by`). Neither ever carries `original_filename`, symptoms, or diagnosis.
- Document removal (purge) requires manager PIN confirmation behind the existing `pinOk` gate; the overdue-document count may surface PIN-free, but the underlying list and the Remove action stay behind PIN.
- The nightly `scripts/sick-note-retention.mjs` job is report-only. It must never delete a row or a file.

### Reviewer prompts

- Does the change preserve the `LSN1` magic + AAD binding, or open a path where plaintext can reach `uploads/sick-notes/`?
- Does any change let the media key file, or its raw bytes, reach a backup, an export, or git?
- Does the attach or purge audit payload gain back `original_filename` or other PHI content?

---

## 13. Test Topology That Must Stay Attached

These tests are not incidental. They are contract tests for the most dangerous surfaces.

### Management rollup

- `tests/js/test-management-rollup.mjs`
- Protects location scoping, empty-state resilience, and alert math.

### Sync apply and replay

- `tests/js/test-sync-apply.mjs`
- `tests/js/test-sync-scheduler.mjs`
- `tests/js/test-sync-scheduler-lifecycle.mjs`
- `tests/js/test-sync-client.mjs`
- Protect family boundaries, schema-drift behavior, checkpoint math, peer isolation, and lifecycle boot rules.

### Peer trust and sync auth

- `tests/js/test-peer-auth.mjs`
- Protects trust CRUD, signature validation, replay defense, revoked-peer behavior, and route-oracle resistance.

### Peer topology

- `tests/js/test-peers-route.mjs`
- Protects redacted vs unredacted peer response shape and timeout clamping.

### Cloud bridge

- `tests/js/test-cloud-bridge-drainer.mjs`
- `tests/js/test-cloud-bridge-dead-letters-api.mjs`
- `tests/js/test-cloud-bridge-queue-race-safety.mjs`
- Protect queue lifecycle, DLQ recovery, claim races, graceful shutdown, and dead-letter mutation guards.
- `tests/js/test-cloud-bridge-push.mjs`
- `tests/js/test-cloud-bridge-canonical.mjs`
- `tests/js/test-cloud-bridge-envelope-golden.mjs`
- `tests/js/test-cloud-bridge-envelope-coverage.mjs`
- Protect the signed `/v2` envelope bytes, canonical serialization, per-table wire version, and cross-stack byte-parity.

### Deterministic ops ledger

At minimum, keep the receiving and depletion tests attached to their contracts:

- `tests/js/test-receiving-api.mjs`
- `tests/js/test-receiving-rules.mjs`
- `tests/js/test-depletion-exceptions.mjs`
- `tests/js/test-compliance-hybrid.mjs`
- `tests/js/test-compliance-rrf.mjs`

---

## 14. Refactor-Safe vs Refactor-Dangerous Changes

### Usually refactor-safe

- extracting pure helper functions with unchanged queries
- moving UI-only tile layout code
- renaming internal variables
- adding docs, tests, or comments
- deduplicating formatting helpers without changing thresholds or query semantics

### Refactor-dangerous

- changing management tile predicates or thresholds without documenting the contract shift
- altering sync family membership
- relaxing required `where` fields for family-2 replay
- changing checkpoint advancement math
- changing signed payload format
- modifying DLQ retry thresholds or `ack` vs `nack` branching semantics
- widening unauthenticated peer response shape
- changing graceful-stop or claim-release ownership behavior
- replacing fail-loud behavior with silent fallback on contract-sensitive surfaces

---

## 15. Required Verification by Contract Family

Run the targeted suite for the surface you touched.

### Management rollup changes

```bash
node --experimental-strip-types --test tests/js/test-management-rollup.mjs
```

### Sync apply or replay changes

```bash
node --experimental-strip-types --test \
  tests/js/test-sync-apply.mjs \
  tests/js/test-sync-scheduler.mjs \
  tests/js/test-sync-scheduler-lifecycle.mjs \
  tests/js/test-sync-client.mjs
```

### Peer auth or topology changes

```bash
node --experimental-strip-types --test \
  tests/js/test-peer-auth.mjs \
  tests/js/test-peers-route.mjs
```

### Cloud bridge changes

```bash
node --experimental-strip-types --test \
  tests/js/test-cloud-bridge-drainer.mjs \
  tests/js/test-cloud-bridge-dead-letters-api.mjs \
  tests/js/test-cloud-bridge-queue-race-safety.mjs \
  tests/js/test-cloud-bridge-push.mjs \
  tests/js/test-cloud-bridge-canonical.mjs \
  tests/js/test-cloud-bridge-envelope-golden.mjs \
  tests/js/test-cloud-bridge-envelope-coverage.mjs
```

### Receiving, inventory, depletion, or compliance changes

```bash
node --experimental-strip-types --test \
  tests/js/test-receiving-api.mjs \
  tests/js/test-receiving-rules.mjs \
  tests/js/test-depletion-exceptions.mjs \
  tests/js/test-compliance-hybrid.mjs \
  tests/js/test-compliance-rrf.mjs
```

Broad suite passes do not replace these targeted checks.

---

## 16. Known Current Weaknesses

These are existing reasons to review protected surfaces conservatively:

- Several sensitive routes still live in JS, and some remain under `@ts-nocheck`.
- Family 3 sync semantics are intentionally deferred, not solved.
- `/management` aggregates many truth sources and can become misleading if helpers drift apart.
- Sync, transport, and trust logic are spread across several modules rather than one narrow façade.
- Module-format/tooling warnings still appear in local test execution.

---

## 17. Future Hardening Candidates

- Migrate sync-sensitive routes from `@ts-nocheck` JS to typed TS or strict JSDoc-checked modules.
- Elevate management rollup queries into a dedicated typed read-model layer.
- Document table-by-table sync ownership, expectations, and explicit non-goals.
- Add a higher-level manager-truth integration test that spans summary signals and linked repair queues.
- Add a dedicated protected-surface CI lane once CI layout is stabilized.

---

## 18. Closing Rule

When in doubt: skip, isolate, or fail loud.

Do not silently widen deletes, silently widen trust, silently drop manager signals, or silently advance transport state on uncertain data.
