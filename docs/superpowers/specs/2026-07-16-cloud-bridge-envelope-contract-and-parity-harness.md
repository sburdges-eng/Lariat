---
title: "Cloud Bridge — envelope contract (as-built) + cross-stack parity harness"
date: 2026-07-16
status: design
canonical_id: cloud-bridge-envelope-parity
supersedes: none
see_also:
  - docs/cloud-bridge-backend-decision.md      # §5 binding wire contract (authoritative)
  - docs/cloud-bridge-design.md                # why-a-bridge rationale + deny-list
  - docs/PROTECTED_CONTRACTS.md                # §8/§11/§14/§15 governance of signed payloads
  - docs/multi-instance-sync.md                # sync_feed — a DIFFERENT transport, do not conflate
  - docs/superpowers/specs/2026-06-01-cloud-bridge-replay-determinism-design.md  # existing determinism oracle
  - docs/superpowers/specs/2026-07-07-phase-iii-wire-parity.md  # calculator/cascade error-code parity
---

# Cloud Bridge — envelope contract & cross-stack parity harness

> **Two deliverables in one doc.**
> **Part A** is the venue→cloud push envelope *as-built*, verified line-by-line against code (not from memory).
> **Part B** is the recommended shared-contract hardening (the missing `schema_version`, and single-sourcing the envelope framing).
> **Part C** is the parity-harness plan that ports the repo's existing compliance-test pattern across everything that is — or is about to be — doubled between the web (TypeScript) and native (Swift) stacks.
>
> Every factual claim below carries a `file:line` citation. Claims marked **[verified]** were confirmed against code; **[spec]** are from the binding design doc for a component that is not yet built; **[rec]** are recommendations.

---

## 0. Orientation — two transports, don't conflate them

There are **two** replication surfaces in this codebase and they are separately governed. This doc is only about the first.

| | **Cloud bridge** (this doc) | **sync_feed** (multi-instance) |
|---|---|---|
| Direction | venue → corp cloud (WAN) | venue-internal LAN peer ↔ peer |
| Shape | **batch** envelope (`rows[]` per table) | **per-op** change-feed (`SyncOp`) |
| Identity | `(location_id, batch_id)` | `op_id` (UUIDv7) |
| Conflict | last-writer-at-envelope (server dedup) | three per-family conflict policies |
| Auth | HMAC now → Ed25519 (Item 13) | Ed25519 signed-fetch |
| Code | `lib/cloudBridge*.ts` | `lib/sync*.ts`, `app/api/peers/*` |
| Governance | PROTECTED_CONTRACTS §11 | PROTECTED_CONTRACTS §8 |

`app/api/peers/*` (sync-since, discovery) is the **sync_feed** subsystem, *not* the `/v1/snapshot` receiver — a common trap when grepping. `docs/multi-instance-sync.md` also carries a dangling link to `docs/cloud-bridge-decision.md` (nonexistent; the real file is `docs/cloud-bridge-backend-decision.md`) — fix on next edit, don't propagate.

---

## Part A — The envelope contract, as-built (verified)

The authoritative prose contract is **§5 of `docs/cloud-bridge-backend-decision.md`** ("binding regardless of backend"). This section is that contract *reconciled against the shipped producer code* — with the exact bytes a second implementation must reproduce.

### A.1 Topology — producer shipped, receiver not built

- **Producer**: `lib/cloudBridgePush.ts::pushBatch` drains one outbox batch to the cloud. **[verified]** `cloudBridgePush.ts:92-148`
- **Receiver**: **does not exist in this repo.** `POST /v1/snapshot` is still an *unchecked* checklist item — `docs/cloud-bridge-backend-decision.md:489` `- [ ] Implementing the /v1/snapshot handler per §5`. **[verified]** The nearest receiver-shaped code, `lib/cloudBridgeReplay.ts`, is an in-memory replay/dedup *model* used by tests, not an HTTP endpoint.
- **Consequence**: "peer rejects on schema drift / dup" is **[spec]**, not running code. This is load-bearing for Part B — there is no deployed receiver whose contract a change would break, so the envelope is at its **cheapest-ever moment to harden**.

### A.2 Endpoint & headers — **[verified]**

```
POST {LARIAT_CLOUD_BRIDGE_URL}/v1/snapshot
content-type: application/json
idempotency-key: <String(batch.id)>
x-lariat-location: <location_id>
x-lariat-signature: <lowercase-hex HMAC-SHA256>
```

- URL is `joinUrl(base, '/v1/snapshot')`, which strips **all** trailing slashes from the base (`base.replace(/\/+$/, '')`) then appends the path — base with/without trailing slash yields the same URL. `cloudBridgePush.ts:69-71,111`
- Header keys are emitted as **lowercase string literals** (`cloudBridgePush.ts:114-119`). HTTP header names are case-insensitive, but a byte-exact verifier keyed on raw case must use lowercase. (The doc comment at `cloudBridgePush.ts:80-83` title-cases them — the *sent* bytes are lowercase.)
- `x-lariat-signature` carries HMAC hex today; it will carry Ed25519 base64 after Item 13 — same header, verification swap only. `docs/cloud-bridge-backend-decision.md:244-246`

### A.3 Request body — **[verified]**, key order is load-bearing

```js
// cloudBridgePush.ts:97-102
JSON.stringify({ table, location_id, batch_id, rows })
```

- Keys in **exactly** this order: `table`, `location_id`, `batch_id`, `rows`. Because the signature is computed over this serialized string (A.4), the key order, whitespace, number formatting, and string escaping are **all part of the contract**.
- `table`: string, one of the allow-list (A.5). `location_id`: string. `rows`: `unknown[]` — **opaque** JSON array; the producer never inspects row shape. `cloudBridgeQueue.ts:71`
- **`batch_id` is a NUMBER**, not a string — `batch.id` is the SQLite `AUTOINCREMENT` rowid, so it serializes unquoted (e.g. `"batch_id":4271`). The `idempotency-key` header and the signing input use `String(batch.id)` — same value, **different type**. `cloudBridgePush.ts:96,100`

### A.4 Signature — **[verified]**, and the JSON-canonicalization coupling

```js
// cloudBridgePush.ts:61-67
crypto.createHmac('sha256', secret)   // key = raw secret string, no pre-hash
  .update(body)                       // 1st: the JSON.stringify'd body (UTF-8)
  .update(idempotencyKey)             // 2nd: String(batch.id), no delimiter
  .digest('hex')                      // lowercase hex
```

The MAC covers `body-bytes ‖ idempotencyKey-bytes` (two sequential `.update()` calls == concatenation, **no separator**), keyed by the raw secret, hex-encoded.

> **This is the deepest native-producer hazard — deeper than the missing version field.**
> The signed bytes are the **exact `JSON.stringify` output**. A Swift `JSONEncoder` (or any re-serializer) that differs by a single byte — key order, whitespace, `/` or unicode escaping, number formatting, `+`/exponent forms — produces a different MAC and the receiver rejects it. Any second implementation must either (a) reproduce V8's `JSON.stringify` byte-for-byte, or (b) the contract must move to an explicit **canonical serialization** (see B.5). This is the concrete reason "the envelope framing lives only in TypeScript" bites.
>
> Note: nothing *external* pins these bytes today — the shipped web test **recomputes** the MAC over the emitted body rather than asserting a golden hex (`test-cloud-bridge-push.mjs:211-217`). The byte-exactness becomes a hard commitment only when a receiver verifies it. That is exactly why hardening now is cheap (B.5).

### A.5 Per-table opt-in — **[verified]**, enforced upstream

Allow-list is **deny-by-default** and enforced at **enqueue**, not in the push client:

```
ALLOWED_TABLES = { settlement_summaries, beo_events, spend_monthly }   // cloudBridgeQueue.ts:53-57
enqueue(): if (!ALLOWED_TABLES.has(table)) throw CLOUD_BRIDGE_TABLE_DENIED  // :98
```

`pushBatch` pushes whatever table it is handed and relies on server-side rejection as defense-in-depth. A producer that bypasses the queue (e.g. a native one) would **not** inherit this client-side guard. Re-checked defensively at requeue (`cloudBridgeQueue.ts:454`) and in the replay model (`cloudBridgeReplay.ts:79`).

### A.6 Reliability / framing — **[verified]**

One durable SQLite table, `cloud_bridge_outbox`, is **both** the outbox **and** the dead-letter store (there is no separate DLQ table — dead letters are rows with `dead_letter=1`). `lib/db.ts:1893-1914` (table; index `idx_cbo_drain` at `:1915-1917`)

| Column | Notes |
|---|---|
| `id INTEGER PK AUTOINCREMENT` | == `batch_id` == idempotency identity |
| `table_name TEXT` | allow-list gated at enqueue |
| `location_id TEXT DEFAULT 'default'` | |
| `rows_json TEXT` | the batch payload |
| `attempts INTEGER DEFAULT 0` | max 5 before dead-letter |
| `last_error TEXT` | failure reason / triage |
| `dead_letter INTEGER DEFAULT 0` | `1` = DLQ |
| `enqueued_at TEXT` | |
| `claimed_at TEXT` | in-flight marker (NULL = claimable) |
| `claim_owner TEXT` | per-process `randomUUID()` |

- **Claim** (`cloudBridgeQueue.ts:127-169`): single `SELECT+UPDATE` txn, FIFO `ORDER BY id ASC LIMIT n`, claimable when `dead_letter=0 AND claimed_at IS NULL`; stamps `claimed_at`, `attempts+1`, `claim_owner=OWNER`.
- **ack** = `DELETE` the row (`:176-179`). **nack** (`:189-229`): if `attempts >= 5` → `dead_letter=1`; else requeue (`claimed_at=NULL`).
- **Recovery**: `sweepStaleClaims(300s)` nulls stale `claimed_at` (crash recovery, ignores ownership); `releaseAllClaimedRows()` on graceful stop (OWNER-scoped).
- **No backoff.** A retryable nack immediately re-claims on the next tick. Cadence is the fixed tick only: `DEFAULT_TICK_MS=30_000` (`cloudBridgeDrainer.ts:88`); per-request timeout `10_000ms` (`cloudBridgePush.ts:53`). `DEFAULT_MAX_ATTEMPTS=5` (`cloudBridgeQueue.ts:65`).
- **DLQ routes** (`app/api/cloud-bridge/dead-letters/[id]/{requeue,drop}`): PIN-gated, `withIdempotency`, location-scoped (404-not-403 to avoid existence leak via `cloudBridgeRouteGuards.ts`), JSONL-audited (`cloud_bridge_dead_letter_{requeued,dropped}`); drop captures the full `rows[]` in the audit trail for recoverability; requeue re-checks `ALLOWED_TABLES`.

### A.7 Response → drainer action — **[verified]** (`cloudBridgePush.ts:132-148`, mirrors §5.4)

| Status | `PushResult` | Drainer action |
|---|---|---|
| `2xx` (any 200–299) | `{ok:true}` | `ack(id)` — delete row |
| `4xx` | `{ok:false, permanent:true, status, reason}` | `ack(id)` — **drop, never retry** |
| `5xx` | `{ok:false, permanent:false, status, reason}` | `nack(id)` — retry ≤5 then DLQ |
| network / timeout / abort | `{ok:false, permanent:false, reason}` | `nack(id)` — retry ≤5 then DLQ |

`pushBatch` **never throws**; `reason` is bounded to 500 chars of the response body and never contains the secret or payload (`:139-142`). The producer treats **any** 2xx as success (`res.status >= 200 && res.status < 300`, `:132`) — it never inspects for `202` or reads a `{batch_id}` body; the `202 {batch_id}` form is the **[spec]** receiver reply (§5.4), not producer-verified.

### A.8 Idempotency / dedup — **[verified] producer + [spec] receiver**

Server-side dedup on `(location_id, batch_id)`, retention ≥7 days; a duplicate is a **safe-replay ACCEPT** (`202 {batch_id}` with no re-apply), **not** a reject. `docs/cloud-bridge-backend-decision.md:333-342`; modeled in `cloudBridgeReplay.ts:40-44`, dedup key `` `${locationId}\0${batchId}` `` where `\0` is a **U+0000 NUL** byte (not a space), `cloudBridgeReplay.ts:89-91` — counted as `deduped`, not `rejected`. (Exactly the byte-level value Part C pins as a shared fixture.)

### A.9 Config — **[verified]**

`LARIAT_CLOUD_BRIDGE_URL` + `LARIAT_CLOUD_BRIDGE_SECRET` (`cloudBridge.ts:88-89,176-177`). When either is absent the drainer no-ops and `pushSnapshot` throws the `CLOUD_BRIDGE_NOT_IMPLEMENTED` sentinel. Native `isConfigured()` mirrors the same both-non-empty truthiness (`CloudBridgeStatusRepository.swift:98-107`).

### A.10 Inconsistencies found during verification (pre-existing; not introduced here)

These surfaced while grounding the contract and are worth a follow-up regardless of the hardening work:

1. **`settlement_summaries` is push-allow-listed but has no table.** It is in `ALLOWED_TABLES` yet `initSchema` defines no `settlement_summaries` table — settlements are computed at read-time (`syncApply.ts:85-87` "removed — settlements are computed at read … not persisted"). One of three pushable tables maps to a schema that doesn't exist. **[verified]**
2. **Two producer paths disagree on `batch_id` semantics.** The queue/drainer path uses the monotonic outbox rowid (matches §5.2). The legacy direct-push path (`cloudBridge.ts:92-134`) synthesizes `id: Date.now()` — an epoch-ms timestamp, **not** monotonic-per-location. Two direct-push (`pushSnapshot`) calls inside the same ms, or clock skew, could collide or reorder `batch_id`; the drainer/queue path is unaffected. **[verified]**
3. **Doc/emit case mismatch** on header names (A.2) — cosmetic today (HTTP case-insensitivity), a footgun for a byte-exact verifier.

---

## Part B — The gap & recommended hardening

### B.1 The gap, precisely

There is **no `schema_version` / `schemaVersion` / `version` field anywhere in the envelope** — grep across `cloudBridgePush.ts`, `cloudBridge.ts`, `cloudBridgeQueue.ts`, `cloudBridgeReplay.ts`, `cloudBridgeDrainer.ts` returns **zero hits**. **[verified]** The only versioning is the coarse `/v1/` URL prefix, which versions the *whole wire format*, not a table's row shape.

So within an allow-listed table, row-shape drift is **neither declared nor inferred**:
- **Not declared** — no version field on the envelope.
- **Not inferred** — the producer ships `rows: unknown[]` opaque; the only shape check anywhere (the replay model) is "is each row a JSON object" (`cloudBridgeReplay.ts:101-103`). No column-set diff, no try/catch-on-insert, no compare. **[verified]**

The design doc already **acknowledges** this as deferred: §7 "What this does NOT commit to" — *"the wire format versions independently; cross-version negotiation is future work."* `docs/cloud-bridge-backend-decision.md:528`

### B.2 Why it bites

- When `spend_monthly` or `beo_events` gains/renames a column, an old venue keeps pushing the **old** shape with no signal. The (future) receiver must **guess** from row keys — exactly the "inferred, not declared" failure. And a schema-drift 4xx, if the receiver ever emits one, is `ack`'d and **silently dropped** from the outbox (A.7) — data loss with no drift signal to venue ops beyond an optional local audit row.
- The row shapes ride on an **already single-sourced** schema (`lib/db.ts::initSchema`, gated by `SCHEMA_VERSION=4` at `lib/db.ts:1005`). So the *data* side is covered. What is **not** single-sourced is the **envelope framing** — path, header set, body key order, signing construction, canonicalization — which lives **only** in `cloudBridgePush.ts`. That is what blocks a byte-identical second producer.

### B.3 Governance — which protected-contract rule actually applies

A subtlety the verification caught: the two transports are governed by **different** PROTECTED_CONTRACTS sections, and — by the letter of that doc — the cloud bridge's signature is **not a protected surface today**.
- **§8** — *"The canonical signing payload contract is frozen unless explicitly versioned"* (`PROTECTED_CONTRACTS.md:239`) — governs **peer trust / Ed25519 signed-fetch**, i.e. the *sync_feed* transport (`lib/peerTrust.ts`, `app/api/peers/sync-since`). **Not** the cloud bridge. (Cited §8 here originally; that was a category error.)
- **§11** (Cloud Bridge Outbox Contracts) governs the **outbox durability / queue / DLQ**. It contains **no** signing-freeze invariant, never mentions the HMAC, and does **not** list `cloudBridgePush.ts` among its key files; `test-cloud-bridge-push.mjs` is absent from §13/§15.
- The rule that genuinely applies is **§14**: "changing signed payload format" is **refactor-DANGEROUS** — the shift must be **documented**, verified with a targeted suite (§15), and land via the protected-surface PR process (`docs/PROTECTED_PR_TEMPLATE.md`), not mixed with cleanup (§2).

So the barrier here is **governance discipline, not existing compatibility** — nothing external pins these bytes today (B.1, A.4). This change should therefore also **add `cloudBridgePush.ts` to §11's key files and the push + new envelope/coverage tests to §13/§15**, making the wire signature the protected surface it currently isn't.

### B.4 Options for declaring `schema_version`

| Option | Integrity | Coarseness | Signing freeze? |
|---|---|---|---|
| **(a) signed body field** `schema_version` (per-table, B.5) | ✅ HMAC-protected, un-spoofable | per-table (good) | **Yes** — changes signed bytes → §14 versioned route |
| **(b) unsigned header** `x-lariat-schema-version` | ❌ strippable/spoofable — useless for a security-relevant drift gate | per-table | No |
| **(c) `/v2/` path bump** | ✅ (path is routed) | whole-format only, not per-table | No, but a hard format break |

### B.5 Recommendation — **[rec]**

**Add a per-table wire-contract version to the *signed* body (option a), as an explicit `/v2/snapshot` envelope, and do it now.**

Rationale:
1. **Integrity matters.** Drift detection an attacker/misconfig can strip (option b) is not a contract — it must be inside the MAC.
2. **Per-table, not global — this is the point.** Stamp a **dedicated per-table wire-contract version** (a small map, e.g. `{ beo_events: 1, spend_monthly: 1 }`, bumped only when *that* table's pushed row shape changes) — **not** the global DB `SCHEMA_VERSION`. A single global number does **not** solve the per-table drift this section is about: `SCHEMA_VERSION` bumps on *any* DDL change to *any* table (`db.ts:1002`), so it would (i) fire false-positive drift on unchanged pushed tables after an unrelated migration, (ii) fail to tell the receiver *which* table drifted, and (iii) couple the external wire contract to internal storage evolution — two concerns standard versioning keeps apart. The cost is one small dedicated constant; that separation of concerns is the correct design, not a burden to avoid.
3. **Nearly free right now — and nothing external pins these bytes yet.** The receiver is unbuilt (A.1), so there is no deployed peer to coordinate with. And the shipped web test *recomputes* the HMAC over whatever body the producer emits + JSON-parses field-by-field (additive-tolerant) — it does **not** pin a golden hex (`test-cloud-bridge-push.mjs:211-217,231-237`). So an additive `schema_version` field + a canonicalization switch keep every existing gate green; the "byte-exact contract" is a *forward* property of the not-yet-built receiver. The only real cost is the §14 process ceremony (B.3), not wire breakage. Waiting until a cloud receiver ships turns this into a genuine cross-version migration.
4. **Fix the canonicalization coupling in the same move.** Define the signed body as an **explicit canonical serialization** (a pinned field order + no-whitespace + a documented escaping/number rule, or sorted-key canonical JSON) rather than "whatever V8 `JSON.stringify` emits". This is the enabling change that lets a native (or any) producer be **provably** byte-identical — and it is what Part C's Swift parity test depends on (C.3 step 5 / C.6).

Proposed `/v2/` body:
```json
{ "schema_version": 1, "table": "beo_events", "location_id": "default", "batch_id": 4271, "rows": [ … ] }
```
where `schema_version` is *that table's* wire-contract version. Signed input stays `canonical(body) ‖ String(batch_id)` — the existing no-delimiter `body‖batch_id` construction is unambiguous only because a JSON `}` precedes the decimal `batch_id` digits, so a future receiver **must verify the HMAC before trusting `schema_version`** to select a decode/validate path (parse-before-verify). Keep `/v1/` accepted during transition (with no receiver yet, "transition" is just producer + tests).

Process (B.3): land via §14's protected-surface route — document the shift here, **add `cloudBridgePush.ts` to §11 key-files and the push/envelope/coverage tests to §13/§15** (the signature isn't a protected surface today), re-run the cloud-bridge suite, extend the determinism spec (`2026-06-01-…`), and flip the freeze rows (`PROJECT_ROADMAP.md`, `V2_FREEZE_PLAN.md`) with the new envelope test as evidence.

### B.6 Respect the ratified native boundary

Native has **no producer by ratified decision** (A5.4 option B, 2026-07-03: "transport stays on the Next.js edge"; `CloudBridgeStatusRepository.swift:52-59`). This doc does **not** propose building a native producer. It proposes **single-sourcing the envelope framing** so that *if/when* native ever produces (the L1 cutover endgame, or offline BEO signing), day-one parity is mechanical rather than a hand-port of V8's serializer. The vehicle for that single-sourcing is the parity harness — Part C.

---

## Part C — The parity harness (port the compliance-test pattern)

**Goal:** pin every doubled — or about-to-be-doubled — wire/serialization contract to a **shared, language-neutral oracle**, with a **coverage gate** that fails when a new doubled surface ships without one. Everything needed already exists in the repo as five separate patterns; the harness **composes** them.

### C.1 The five reusable building blocks (already in the repo)

1. **Allow-list drift/coverage gate** — `tests/js/test-pin-gate-coverage.mjs`. Walks a set of surfaces, classifies each as gated / allow-listed / violation, and **fails on any unaccounted surface**; sub-tests also fail on a *stale* allow-list entry and on a silently-regressed parser. This is the template for "a pushable table shipped without a golden fixture."
2. **Swift↔JS parity test with injected runner + named oracle** — `BeoCascadeClientTests.swift` pins that the Swift port produces shape-identical output to a named JS oracle (`test-beo-cascade.mjs`) using an injected closure so no subprocess/network is spawned.
3. **Golden JSON fixture + `#filePath`-relative loader** — `Tests/Fixtures/BeoCascade/*.json` carry `schema_version` + `source_test` provenance and are decoded by `BeoFixtureLoader.swift` relative to `#filePath` (no bundle wiring). The frozen fixture directory is the oracle.
4. **`test:regression-*` aggregates + CI job-per-lane** — `package.json` groups suites into named lanes; `ci.yml` runs each as a discrete job; `native-ci.yml` runs `swift test` path-filtered to `LariatNative/**`. The cloud-bridge suites **already live in `test:regression-core`**.
5. **Shared decision seam** — `RegulatedReadGate.swift` extracts a web authority rule into one tested seam both platforms honor. The envelope's authority rule is `ALLOWED_TABLES` deny-by-default.

### C.2 What already exists vs. the gap

A web-side envelope **oracle already exists**: `tests/js/test-cloud-bridge-push.mjs` pins body §5.3, the HMAC (server-side recompute equality), the headers, and the response→`PushResult` mapping (the drainer *action* map is pinned separately in `test-cloud-bridge-drainer.mjs`); `test-cloud-bridge-replay-determinism.mjs` pins canonical replay/dedup. **But**: the envelope body is built **inline** (`makeBatch()`), so there is **no extractable golden fixture**; there is **no Swift envelope encoder**; and **no coverage gate** walks `ALLOWED_TABLES` to require a fixture per table.

### C.3 The concrete harness — envelope (six steps, correctly ordered)

1. **Extract** a golden fixture per pushable table: `tests/fixtures/cloud-bridge/golden-envelope.<table>.json` = `{ schema_version, headers:{idempotency-key, x-lariat-location, x-lariat-signature}, body:{…}, canonical_body_string, hmac_hex }`, each with a `source_test` back-link to `test-cloud-bridge-push.mjs`.
2. **Freeze the web side to the file**: `test-cloud-bridge-push.mjs` asserts its produced envelope **===** the golden file (byte-exact body string + recomputed HMAC) — turning today's self-recompute into a pinned artifact.
3. **Coverage gate**: `tests/js/test-cloud-bridge-envelope-coverage.mjs`, a clone of `test-pin-gate-coverage.mjs`, walks `ALLOWED_TABLES` and **fails** if any pushable table lacks a golden fixture — plus the "no stale fixture for a removed table" and "ALLOWED_TABLES parses to >0" sub-tests. (This gate immediately flags the `settlement_summaries` A.10 inconsistency.)
4. **Land B.5** — the explicit canonical serialization + per-table `schema_version`, via the §14 protected-surface route (B.3). Re-extract the golden fixtures against the canonical rule so `canonical_body_string` is defined by a *rule*, not "whatever V8 emits".
5. **Add the Swift encoder + parity test** *(depends on step 4)*: a `CloudBridgeEnvelope` encoder in `LariatModel` + an XCTest that loads the *same* golden file (`BeoFixtureLoader` `#filePath` pattern), re-encodes from identical inputs, and asserts the canonical body string **and** HMAC are identical. This is where single-sourced envelope framing (B.6) becomes machine-checked — and it is only reliable *after* step 4.
6. **Register**: add the new TS suites to `test:regression-core` (or a new `test:regression-cloudbridge` lane) in `package.json` + `ci.yml`, **and to PROTECTED_CONTRACTS §13/§15**; the Swift test rides `native-ci.yml` automatically. **No new workflow needed.**

> **Ordering constraint:** steps 1–3 are buildable today with no contract change. Step 5 — the Swift byte-parity pin, the point of the whole harness — is **not** reliable until step 4 lands, because Swift's `JSONEncoder` cannot reproduce V8's `JSON.stringify` bytes for opaque, float-bearing `rows` (number formatting, `/` and non-ASCII escaping, key sorting — the A.4 hazard). Canonicalize first, then pin parity.

### C.4 The broader doubled-surface work-list (prioritized)

Ordered **wire/serialization contracts first** (a mismatch corrupts shared rows or fails cross-app verification *silently*), then confirm the algorithmic pins hold, then stand up producer-side oracles before native ever writes.

| # | Surface | Web | Native | Oracle today | Action |
|---|---|---|---|---|---|
| **Unpinned / higher-risk (do first)** |
| 1 | **audit_events `actor_source`** (19-value enum) | `lib/auditEvents.ts` + `phase-c-reconcile.mjs` CANONICAL set | `ActorSource.swift` | ❌ 3 hand-copies, no cross-lang test | **Cheapest high-value pin.** Emit Swift set→JSON, diff vs JS set in a node test (or one shared fixture). A drift means native writes a value the reconciler rejects. |
| 2 | **audit_events row/payload** | `postAuditEvent` (payload_json canonicalization, in-txn) | `AuditEvent.swift` + `*AuditLogger.swift` | ❌ both INSERT, no shape test | Fixture pinning column set + NOT-NULL/defaults + `payload_json` canonicalization. |
| 3 | **UnitConvert** | `lib/unitConvert.mjs` (Python-authoritative) | `UnitConvert.swift` | ⚠️ **native NOT wired** to `tests/fixtures/unit_convert_parity.json`; **documented divergence** (`2026-07-07-bom-unit-table-diff.md`) | Wire native test to the shared fixture (as IngredientKey does), then close/waive each divergent row. Feeds costing/variance both apps display. |
| 4 | **UUIDv7** | `lib/uuid.ts` (crypto random tail) | `UuidV7.swift` (**non-crypto** `UInt8.random` tail) | ❌ no parity test | Shape+bit-layout parity test both sides run; switch native to `SystemRandomNumberGenerator`/`SecRandom` for the `op_id` collision guarantee. |
| 5 | **SickNote LSN1 PHI envelope** | none yet | `SickNoteCrypto.swift` (AES-256-GCM, AAD=file_path) | ⚠️ native golden vectors only, "Node parity lands later" | Promote native golden vectors to a language-neutral hex fixture before any Node reader ships. |
| **Future-doubled the instant native gains a producer** |
| 6 | **cloud-bridge envelope** (this doc) | `cloudBridgePush.ts` (+ web oracle, inline) | read-only status only | ⚠️ web-only, inline | **Part C.3** — extract golden fixture + Swift encoder test + coverage gate. |
| 7 | **SyncOp change-feed envelope** | `lib/syncFeed.ts` (`op_id` UUIDv7) | none | ❌ | Freeze the SyncOp + delete-batch envelope as a language-neutral fixture **before** any Swift producer. |
| 8 | **idempotency request-hash** | `lib/idempotency.ts` (`sha256(METHOD\npath\nbody)`, method uppercased) | none | ❌ | Pin the field order + method-case as a fixture. |
| 9 | **beoShare token** | `lib/beoShare.ts` (128-bit, shape regex) | none (edge-retained) | web shape test only | No action while share stays edge-only; pin token shape + `signed_name` rules if native ever verifies. |
| **Well-pinned (regression-guard only — the templates to copy)** |
| 10 | **IngredientKey** | `lib/ingredientKey.ts` | `IngredientKey.swift` | ✅ **both load `tests/fixtures/ingredient_key_parity.json` verbatim** | Gold standard — copy this shape. |
| 11 | **PinHash** | `lib/pinHash.ts` | `PinHash.swift` | ✅ native verifies web golden vectors | Add the reverse vector (web verifies native-written `p1$`) to fully close the loop. |
| 12 | **BomExpand / BeoCascade** | Python-authoritative via `lib/*.ts` | `*Compute.swift` | ✅ fixtures mechanically exported from the Python corpus | Keep `export_*_fixtures.py` green in CI; confirm the error-code map from `2026-07-07-phase-iii-wire-parity.md` is asserted native-side. |

### C.5 CI wiring — nothing new to stand up

Both enforcement lanes already exist. Envelope + coverage TS suites → `test:regression-core` (already owns cloud-bridge) + `verify`. Swift encoder/fixture test → rides `native-ci.yml`'s `swift test` (path-filtered `LariatNative/**`) automatically. Cross-language *equality* pins (#1, #10) live as a node test that reads a Swift-emitted JSON or a shared fixture — no new runner.

### C.6 Suggested sequencing

1. **C.4 #1** (actor_source equality gate) — cheapest, highest-value, catches an already-live drift risk.
2. **C.3 steps 1–3** — extract golden fixture + web freeze + coverage gate (surfaces the `settlement_summaries` bug). Buildable now; no contract change.
3. **B.5 (= C.3 step 4)** — land per-table `schema_version` + canonical serialization via the §14 protected route; re-extract fixtures.
4. **C.3 step 5** — the Swift encoder byte-parity pin (only reliable after step 3).
5. **C.4 #3, #4, #2** — wire UnitConvert to the shared fixture; UUIDv7 parity + crypto tail; audit_events row shape.
6. **C.4 #7, #8** — freeze SyncOp + idempotency-hash fixtures **before** any native producer work begins.

---

## Appendix — verification provenance & open questions

**Verified against** (representative): `lib/cloudBridgePush.ts:53-148`, `lib/cloudBridgeQueue.ts:42-229,444-481`, `lib/cloudBridgeDrainer.ts:88-178`, `lib/cloudBridgeReplay.ts:40-103`, `lib/db.ts:1005,1893-1915,3294-3303`, `lib/cloudBridge.ts:88-177`, `LariatNative/Sources/LariatDB/CloudBridgeStatusRepository.swift:26-107`, `docs/cloud-bridge-backend-decision.md §4-§7`, `docs/PROTECTED_CONTRACTS.md §2/§8/§11/§14/§15`, `tests/js/test-cloud-bridge-push.mjs`, `tests/js/test-pin-gate-coverage.mjs`, `LariatNative/Tests/LariatModelTests/BeoCascadeClientTests.swift`, `LariatNative/Tests/Fixtures/BeoCascade/*.json` + `BeoFixtureLoader.swift`.

**Open questions for the owner:**
1. **Version granularity** — B.5 recommends a **per-table** wire-contract version (not the global DB `SCHEMA_VERSION`). Confirm, and decide where the version map lives: a code constant next to `ALLOWED_TABLES`, or an operator-bumpable config row? (B.5)
2. **`settlement_summaries`** — remove from `ALLOWED_TABLES`, or restore/define the table? It currently maps to nothing. (A.10 #1)
3. **Direct-push path** — is `cloudBridge.ts::pushSnapshot` (the `Date.now()` `batch_id` path) still a live surface, or can it be retired in favor of the queue path so `batch_id` semantics are single? (A.10 #2)
4. **Canonicalization** — adopt sorted-key canonical JSON, or freeze the explicit field order + a documented escaping rule? Either unblocks a byte-identical second producer. (B.5)
