# Cloud-Bridge /v2 Canonical Envelope + Swift Byte-Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cloud-bridge signed envelope's implicit "whatever V8 `JSON.stringify` emits" serialization with an explicit, portable canonical rule + per-table `schema_version` on a `/v2/snapshot` path, promote the envelope to a protected surface, and pin it byte-for-byte across the web (TypeScript) and native (Swift) producers.

**Architecture:** Two PRs. **PR 1 (protected-surface, TS)** introduces `lib/cloudBridgeCanonical.ts` (a recursively sorted-key, integer-only, fail-loud JSON serializer + the per-table wire-version map), rewires `pushBatch` to emit the canonical `/v2` body with `schema_version`, re-freezes the golden fixtures against the canonical rule, and edits `docs/PROTECTED_CONTRACTS.md` to make the envelope signature the protected surface it currently isn't. **PR 2 (native, additive)** ports the identical canonical rule to Swift (`CanonicalJSON` + `CloudBridgeEnvelope`) and adds an XCTest that loads the **same** shared golden fixtures and asserts the Swift canonical body + HMAC are byte-identical — C.3 step 5 of the parity-harness spec.

**Tech Stack:** TypeScript (Node's `node:test` + `--experimental-strip-types`), Swift 5.9 / CryptoKit (`HMAC<SHA256>`), GRDB-adjacent LariatModel package. HMAC-SHA256 over `canonical(body) ‖ String(batch_id)`, lowercase hex.

## Global Constraints

- **Never push to `main`.** One `feat/` branch per PR; open a PR for review. (`CLAUDE.md`)
- **PR 1 is a protected-surface PR** — it MUST use `docs/PROTECTED_PR_TEMPLATE.md`, must NOT mix in unrelated cleanup/UI/schema work (`PROTECTED_CONTRACTS.md §2`), and must run the §15 cloud-bridge targeted suite before merge.
- **Signed-payload discipline** — changing the envelope bytes is "refactor-dangerous" (`PROTECTED_CONTRACTS.md §14`): the shift is documented in this plan + the spec, the new bytes are re-pinned by golden fixtures, and the tests are registered in §13/§15.
- **Canonical number rule is integer-only + fail-loud** — the pushable tables (`beo_events`, `spend_monthly`) carry money as integer cents and counts as integers; a non-integer/non-finite row value MUST throw rather than risk a silent MAC divergence (`§14`/`§18` fail-loud).
- **The signed HMAC construction is unchanged** — `HMAC-SHA256(secret, body ‖ String(batch_id))`, lowercase hex, no separator. Only the `body` bytes and the path (`/v1`→`/v2`) change.
- **The canonical rule is single-sourced** — `lib/cloudBridgeCanonical.ts` (TS) and `LariatModel/CloudBridge/CanonicalJSON.swift` (Swift) must stay behaviorally identical; the golden fixtures are the shared oracle both sides load.
- **Read before edit; run GitNexus `impact` before editing any symbol** (`Lariat/CLAUDE.md`). The GitNexus index is **stale** (still lists the #559-retired `pushSnapshot` as a `pushBatch` caller) — re-run `node .gitnexus/run.cjs analyze` before relying on it, or verify callers by grep as this plan did.

**Blast radius (verified against the committed tree, not the stale index):** `pushBatch`'s only production caller is `lib/cloudBridgeDrainer.ts` (via an injected `defaultPushBatch`), which is byte-agnostic — it consumes the `PushResult`, never the request bytes. `pushBatch`'s signature is unchanged. Everything else that observes the bytes is the test/fixture oracle layer this plan intentionally re-pins. **Risk: LOW.**

---

## File Structure

**PR 1 — TypeScript (protected surface)**

| Path | Disposition | Responsibility |
|---|---|---|
| `lib/cloudBridgeCanonical.ts` | **Create** | The portable wire-contract definitions: `canonicalize(body)` (recursive sorted-key, integer-only, fail-loud) + `TABLE_WIRE_VERSION` map. DB-free, so `cloudBridgePush.ts` stays DB-free. |
| `tests/js/test-cloud-bridge-canonical.mjs` | **Create** | Unit-pins the canonical rule (sorted keys, no whitespace, `/` unescaped, integer-only throw). |
| `lib/cloudBridgePush.ts` | Modify (`92-121`) | Emit canonical `/v2` body with `schema_version`; import `canonicalize` + `TABLE_WIRE_VERSION`. |
| `lib/cloudBridgeQueue.ts` | Modify (`53-60`) | Add a pointer comment by `ALLOWED_TABLES` to `TABLE_WIRE_VERSION` (kept in the DB-free module). |
| `scripts/gen-cloud-bridge-golden-envelopes.mjs` | Modify (`108`, `99-102`) | Path literal `/v1`→`/v2`; note text. Re-run to regenerate fixtures. |
| `tests/fixtures/cloud-bridge/golden-envelope.beo_events.json` | Regenerate | New canonical `/v2` bytes + HMAC. |
| `tests/fixtures/cloud-bridge/golden-envelope.spend_monthly.json` | Regenerate | New canonical `/v2` bytes + HMAC. |
| `tests/js/test-cloud-bridge-push.mjs` | Modify (`75,89,222-240`) | `/v1`→`/v2`; assert `schema_version`. |
| `tests/js/test-cloud-bridge-envelope-coverage.mjs` | Modify (`21,40-60`) | Add: every `ALLOWED_TABLE` has a `TABLE_WIRE_VERSION`; every fixture body carries it. |
| `docs/PROTECTED_CONTRACTS.md` | Modify (`§11,§13,§15`) | Promote the envelope to a protected surface; add key files + tests + new §11.4 invariant. |
| `docs/V2_FREEZE_PLAN.md` | Modify (`87`) | Update the "Cloud-bridge push" freeze row with the /v2 canonical evidence. |
| `docs/PROJECT_ROADMAP.md` | Modify (`~139`) | Note the /v2 canonical envelope + cross-stack parity harness. |
| `docs/superpowers/specs/2026-06-01-cloud-bridge-replay-determinism-design.md` | Modify (append) | Note the envelope is now /v2 canonical + `schema_version`. |
| `package.json` | Modify (`25`) | Add `test-cloud-bridge-canonical.mjs` to `test:regression-core`. |

**PR 2 — Swift (native, additive)**

| Path | Disposition | Responsibility |
|---|---|---|
| `LariatNative/Sources/LariatModel/CloudBridge/CanonicalJSON.swift` | **Create** | `JSONValue` enum + `CanonicalJSON.encode` — behavioral twin of `cloudBridgeCanonical.ts`. |
| `LariatNative/Sources/LariatModel/CloudBridge/CloudBridgeEnvelope.swift` | **Create** | `canonicalBody(...)` + `sign(...)` (CryptoKit HMAC-SHA256 hex). |
| `LariatNative/Tests/LariatModelTests/CanonicalJSONTests.swift` | **Create** | Mirrors the TS canonical unit tests. |
| `LariatNative/Tests/LariatModelTests/CloudBridgeEnvelopeParityTests.swift` | **Create** | Loads the **shared** repo goldens; asserts Swift body + HMAC == frozen `expected`. The headline pin. |

**Ordering constraint (from the spec, C.3):** PR 2 depends on PR 1's *merged, canonical* golden fixtures. Do not start PR 2's parity test until PR 1's fixtures are regenerated — Swift cannot reproduce the pre-canonical V8 bytes, which is the entire reason for this work.

---

# PR 1 — TypeScript canonical envelope (protected surface)

Branch: `feat/cloud-bridge-v2-canonical-envelope`

### Task 1: Canonical serializer + per-table wire-version map

**Files:**
- Create: `lib/cloudBridgeCanonical.ts`
- Test: `tests/js/test-cloud-bridge-canonical.mjs`

**Interfaces:**
- Produces: `canonicalize(body: unknown): string` — deterministic sorted-key JSON string; throws on a non-integer number. `TABLE_WIRE_VERSION: Readonly<Record<string, number>>`. `CLOUD_BRIDGE_CANONICAL_UNSUPPORTED: string` (error-message prefix).

- [ ] **Step 1: Write the failing test** — `tests/js/test-cloud-bridge-canonical.mjs`

```js
#!/usr/bin/env node
// Unit-pins the cloud-bridge canonical serialization rule (B.5 / PROTECTED_CONTRACTS §11.4).
// The Swift twin (LariatModel/CloudBridge/CanonicalJSON.swift) must match this byte-for-byte.
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-canonical.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));
const { canonicalize, TABLE_WIRE_VERSION } = await import('../../lib/cloudBridgeCanonical.ts');

describe('cloud-bridge canonical serialization', () => {
  it('sorts object keys recursively and emits no whitespace', () => {
    assert.equal(canonicalize({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
  });
  it('does not escape forward slashes (matches V8; Swift default would escape them)', () => {
    assert.equal(canonicalize({ p: 'a/b' }), '{"p":"a/b"}');
  });
  it('preserves array order but sorts keys inside array elements', () => {
    assert.equal(canonicalize({ rows: [{ y: 2, x: 1 }] }), '{"rows":[{"x":1,"y":2}]}');
  });
  it('throws on a non-integer number (fail-loud keeps cross-language parity safe)', () => {
    assert.throws(() => canonicalize({ n: 1.5 }), /non-integer/);
  });
  it('throws on a non-finite number', () => {
    assert.throws(() => canonicalize({ n: Infinity }), /non-integer/);
  });
});

describe('cloud-bridge wire-version map', () => {
  it('is a non-empty map of integer versions', () => {
    const entries = Object.entries(TABLE_WIRE_VERSION);
    assert.ok(entries.length >= 1);
    for (const [, v] of entries) assert.ok(Number.isInteger(v) && v >= 1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-canonical.mjs`
Expected: FAIL — `Cannot find module '../../lib/cloudBridgeCanonical.ts'`.

- [ ] **Step 3: Create `lib/cloudBridgeCanonical.ts`**

```ts
// Cloud-bridge canonical wire serialization (B.5 / PROTECTED_CONTRACTS §11.4).
//
// The bytes the cloud-bridge HMAC signs must be reproducible by any second
// producer (the Swift native encoder — see docs/superpowers/specs/
// 2026-07-16-cloud-bridge-envelope-contract-and-parity-harness.md, C.3 step 5).
// V8's JSON.stringify is not a portable contract, so the signed body is defined
// by THIS rule instead:
//
//   1. Object keys are sorted ascending (code-unit order), recursively.
//   2. No insignificant whitespace.
//   3. Scalars follow JSON.stringify: strings escape " \ and C0 controls, the
//      forward slash is NOT escaped, non-ASCII is emitted raw (UTF-8).
//   4. Numbers must be integers. A non-integer / non-finite number throws — the
//      pushable tables carry money as integer cents, so this cannot happen in
//      practice; the guard keeps cross-language number parity provably exact and
//      fails loud (§14/§18) rather than sign a body a second producer can't match.
//
// The web side leans on V8's JSON.stringify for scalar encoding (it IS the
// reference); the Swift twin reproduces the same rule byte-for-byte.
//
// This module is DB-free on purpose so lib/cloudBridgePush.ts stays DB-free.

/** Error-message prefix when a value outside the canonical-safe set reaches the serializer. */
export const CLOUD_BRIDGE_CANONICAL_UNSUPPORTED = 'cloud bridge: value not canonical-serializable';

/**
 * Per-table cloud-bridge wire-contract version, stamped into the signed body as
 * `schema_version`. Bump a table's number ONLY when that table's pushed row
 * shape changes. Deliberately NOT the global DB SCHEMA_VERSION (which bumps on
 * any migration): a per-table version tells a future receiver which table
 * drifted and does not couple the wire contract to internal storage evolution.
 * A receiver selects its decode/validate path from this only AFTER verifying the
 * HMAC (parse-before-verify). Every ALLOWED_TABLES entry must have one —
 * enforced by tests/js/test-cloud-bridge-envelope-coverage.mjs.
 */
export const TABLE_WIRE_VERSION: Readonly<Record<string, number>> = {
  beo_events: 1,
  spend_monthly: 1,
};

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortDeep(src[key]);
    return out;
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`${CLOUD_BRIDGE_CANONICAL_UNSUPPORTED}: non-integer number ${value}`);
  }
  return value;
}

/**
 * Serialize `body` to the canonical signed-envelope string. Deterministic and
 * portable: same input → same bytes on any conforming producer. Rebuilding
 * objects with sorted string-key insertion order and handing them to
 * JSON.stringify preserves that order (column-name keys are never integer-like).
 */
export function canonicalize(body: unknown): string {
  return JSON.stringify(sortDeep(body));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-canonical.mjs`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/cloudBridgeCanonical.ts tests/js/test-cloud-bridge-canonical.mjs
git commit -m "feat(cloud-bridge): canonical wire serializer + per-table wire-version map"
```

---

### Task 2: Rewire `pushBatch` to the canonical `/v2` envelope + re-freeze goldens

**Files:**
- Modify: `lib/cloudBridgePush.ts:92-121`
- Modify: `lib/cloudBridgeQueue.ts:53-60` (pointer comment only)
- Modify: `scripts/gen-cloud-bridge-golden-envelopes.mjs:99-108`
- Modify: `tests/js/test-cloud-bridge-push.mjs:75,89,222-240`
- Regenerate: `tests/fixtures/cloud-bridge/golden-envelope.{beo_events,spend_monthly}.json`

**Interfaces:**
- Consumes: `canonicalize`, `TABLE_WIRE_VERSION` (Task 1).
- Produces: `pushBatch(batch, opts): Promise<PushResult>` — **signature unchanged**; now POSTs `/v2/snapshot` with a canonical body `{schema_version, table, location_id, batch_id, rows}`.

- [ ] **Step 1: Run `impact` on the symbol being edited** (per `Lariat/CLAUDE.md`)

Run: `node .gitnexus/run.cjs analyze` (index is stale), then in an MCP-enabled session `impact({target: "pushBatch", direction: "upstream"})`.
Expected: sole production caller is `lib/cloudBridgeDrainer.ts` (byte-agnostic); risk LOW. If the tool still shows `pushSnapshot`, the re-analyze did not take — fall back to `grep -rn pushBatch lib scripts`.

- [ ] **Step 2: Write the failing test** — update `tests/js/test-cloud-bridge-push.mjs`

Change the happy-path URL assertion (line ~89) and its `it` text (line ~75) from `/v1/snapshot` to `/v2/snapshot`:

```js
  it('returns { ok: true } and posts to /v2/snapshot', async () => {
```
```js
        assert.equal(requests[0].url, 'https://bridge.example/v2/snapshot');
```

Add a `schema_version` assertion to the body-shape test (after line ~237, `assert.equal(parsed.rows[0].totals_cents, 12345);`):

```js
        assert.equal(parsed.schema_version, 1);
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-push.mjs`
Expected: FAIL — URL is `/v1/snapshot`, `parsed.schema_version` is `undefined`.

- [ ] **Step 4: Rewire `pushBatch`** — `lib/cloudBridgePush.ts`

Add the import below line 21 (`import type { OutboxBatch } ...`):

```ts
import { canonicalize, TABLE_WIRE_VERSION } from './cloudBridgeCanonical.ts';
```

> Note: import BOTH from the DB-free canonical module **directly** — NOT via `cloudBridgeQueue.ts`, which imports `db.ts` and would pull the DB into the push client, breaking the "pure-network client, no DB access" contract in this file's header (lines 1-18).

Replace the body-build block (lines 96-103, `const idempotencyKey ... const signature ...`) with:

```ts
  const idempotencyKey = String(batch.id);
  const schemaVersion = TABLE_WIRE_VERSION[batch.table];
  if (schemaVersion === undefined) {
    // Coverage-gated (test-cloud-bridge-envelope-coverage.mjs) so unreachable in
    // practice; fail loud rather than sign an unversioned body.
    return {
      ok: false,
      permanent: true,
      reason: `cloud bridge: no wire version for table '${batch.table}'`,
    };
  }
  const body = canonicalize({
    schema_version: schemaVersion,
    table: batch.table,
    location_id: batch.locationId,
    batch_id: batch.id,
    rows: batch.rows,
  });
  const signature = signRequest(opts.secret, body, idempotencyKey);
```

Change the fetch path (line 111) from `'/v1/snapshot'` to `'/v2/snapshot'`:

```ts
    res = await fetch(joinUrl(opts.url, '/v2/snapshot'), {
```

Update the doc-comment `Request shape (§5.3)` block (lines 78-84) so `/v1/snapshot` reads `/v2/snapshot` and the body line reads `{ schema_version, table, location_id, batch_id, rows } (canonical — lib/cloudBridgeCanonical.ts)`.

- [ ] **Step 5: Run the push test to confirm it passes**

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-push.mjs`
Expected: PASS. (The golden freeze + coverage tests are now RED — bytes changed — fixed in Step 7.)

- [ ] **Step 6: Add the `TABLE_WIRE_VERSION` pointer to the queue** — `lib/cloudBridgeQueue.ts`

After the `ALLOWED_TABLES` definition (after line 60), add a **pointer comment only** — no import/re-export, so the queue's dependency graph is unchanged and the push client's DB-free import path is preserved:

```ts
// The per-table wire-contract version for these tables lives in the DB-free
// module lib/cloudBridgeCanonical.ts (TABLE_WIRE_VERSION), so the push client can
// import it without pulling in db.ts. Every ALLOWED_TABLES entry must have one
// (enforced by tests/js/test-cloud-bridge-envelope-coverage.mjs).
```

- [ ] **Step 7: Update the gen script path + regenerate the fixtures**

In `scripts/gen-cloud-bridge-golden-envelopes.mjs`, change the fixture `path` literal (line ~108) from `'/v1/snapshot'` to `'/v2/snapshot'`, and update the `note` string (lines ~99-102) `/v1/snapshot` → `/v2/snapshot`.

Regenerate:

Run: `npm run gen:cloud-bridge-golden`
Expected: `wrote tests/fixtures/cloud-bridge/golden-envelope.beo_events.json` + `...spend_monthly.json`. The regenerated `beo_events` body is (illustrative — **do not hand-write it; the script produces the exact string + HMAC**):

```
{"batch_id":4271,"location_id":"default","rows":[{"event_id":42,"settled_at":"2026-05-06T23:59:00Z","totals_cents":1250000}],"schema_version":1,"table":"beo_events"}
```

- [ ] **Step 8: Run the freeze + coverage suite to confirm green**

Run: `npm run test:cloud-bridge-golden`
Expected: PASS — the web producer now matches the regenerated canonical goldens byte-for-byte.

- [ ] **Step 9: Commit**

```bash
git add lib/cloudBridgePush.ts lib/cloudBridgeQueue.ts scripts/gen-cloud-bridge-golden-envelopes.mjs tests/js/test-cloud-bridge-push.mjs tests/fixtures/cloud-bridge/golden-envelope.beo_events.json tests/fixtures/cloud-bridge/golden-envelope.spend_monthly.json
git commit -m "feat(cloud-bridge): emit canonical /v2 envelope with per-table schema_version"
```

---

### Task 3: Coverage gate — wire-version presence + fixture-body pin

**Files:**
- Modify: `tests/js/test-cloud-bridge-envelope-coverage.mjs:21,40-60`

**Interfaces:**
- Consumes: `ALLOWED_TABLES`, `TABLE_WIRE_VERSION`, the regenerated fixtures.

- [ ] **Step 1: Write the failing assertions** — add the `TABLE_WIRE_VERSION` import after line 21:

```js
const { TABLE_WIRE_VERSION } = await import('../../lib/cloudBridgeCanonical.ts');
```

Add two `it` blocks inside the `describe` (before its closing `});` at line 61):

```js
  it('every pushable table has a wire version', () => {
    const missing = [...allowed].filter((t) => TABLE_WIRE_VERSION[t] === undefined);
    assert.deepEqual(missing, [], `pushable tables missing a TABLE_WIRE_VERSION: ${missing.join(', ')}`);
  });

  it('each fixture body carries the table wire version', () => {
    for (const t of fixtureTables) {
      const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, `golden-envelope.${t}.json`), 'utf8'));
      const parsed = JSON.parse(fx.expected.body);
      assert.equal(parsed.schema_version, TABLE_WIRE_VERSION[t], `golden-envelope.${t}.json body schema_version`);
    }
  });
```

- [ ] **Step 2: Run it to confirm it passes** (the map + fixtures already exist from Tasks 1-2)

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-envelope-coverage.mjs`
Expected: PASS — all sub-tests green.

- [ ] **Step 3: Prove it catches drift** — temporarily delete `spend_monthly: 1` from `TABLE_WIRE_VERSION` in `lib/cloudBridgeCanonical.ts`, rerun the test.

Run: `node --experimental-strip-types --test tests/js/test-cloud-bridge-envelope-coverage.mjs`
Expected: FAIL — "pushable tables missing a TABLE_WIRE_VERSION: spend_monthly". **Restore the line** and rerun → PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/js/test-cloud-bridge-envelope-coverage.mjs
git commit -m "test(cloud-bridge): gate wire-version presence + fixture-body schema_version"
```

---

### Task 4: Promote the envelope to a protected surface — `docs/PROTECTED_CONTRACTS.md`

**Files:**
- Modify: `docs/PROTECTED_CONTRACTS.md` (§11 key files, new §11.4, §13, §15)

This task adds no code — its deliverable is that the wire signature becomes a governed surface. A reviewer can approve/reject it independently, so it is its own task.

- [ ] **Step 1: Add the producer + canonical module to §11 key files.** After `- \`lib/cloudBridgeDrainer.ts\`` (line 301) insert:

```markdown
- `lib/cloudBridgePush.ts`
- `lib/cloudBridgeCanonical.ts`
```

After `- \`tests/js/test-cloud-bridge-queue-race-safety.mjs\`` (line 307) insert:

```markdown
- `tests/js/test-cloud-bridge-push.mjs`
- `tests/js/test-cloud-bridge-canonical.mjs`
- `tests/js/test-cloud-bridge-envelope-golden.mjs`
- `tests/js/test-cloud-bridge-envelope-coverage.mjs`
```

- [ ] **Step 2: Add the new §11.4 invariant subsection.** Before the `---` that closes §11 (line 341) insert:

```markdown
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
```

- [ ] **Step 3: Register the tests in §13.** In the "Cloud bridge" block (after line 407) add the envelope/canonical tests + a one-line purpose:

```markdown
- `tests/js/test-cloud-bridge-push.mjs`
- `tests/js/test-cloud-bridge-canonical.mjs`
- `tests/js/test-cloud-bridge-envelope-golden.mjs`
- `tests/js/test-cloud-bridge-envelope-coverage.mjs`
- Protect the signed `/v2` envelope bytes, canonical serialization, per-table wire version, and cross-stack byte-parity.
```

- [ ] **Step 4: Register the tests in §15.** Extend the cloud-bridge command (lines 476-481) to include the four tests:

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

- [ ] **Step 5: Verify the doc references resolve** (no broken paths)

Run: `for f in lib/cloudBridgePush.ts lib/cloudBridgeCanonical.ts tests/js/test-cloud-bridge-canonical.mjs; do test -f "$f" && echo "ok $f" || echo "MISSING $f"; done`
Expected: `ok` for all three.

- [ ] **Step 6: Commit**

```bash
git add docs/PROTECTED_CONTRACTS.md
git commit -m "docs(protected): promote the cloud-bridge /v2 envelope to a protected surface"
```

---

### Task 5: Flip the freeze/evidence rows + determinism spec

**Files:**
- Modify: `docs/V2_FREEZE_PLAN.md:87`
- Modify: `docs/PROJECT_ROADMAP.md` (~line 139)
- Modify: `docs/superpowers/specs/2026-06-01-cloud-bridge-replay-determinism-design.md` (append)

- [ ] **Step 1: Update the V2_FREEZE_PLAN "Cloud-bridge push" row** (line 87) to cite the new evidence — append to that row's evidence cell: `; /v2 canonical envelope + per-table schema_version pinned by test-cloud-bridge-envelope-golden.mjs + coverage + test-cloud-bridge-canonical.mjs (PROTECTED_CONTRACTS §11.4)`.

- [ ] **Step 2: Add a PROJECT_ROADMAP note** near the existing cloud-bridge determinism row (~139): a one-line "Closed" entry that the venue→cloud envelope is now `/v2` canonical + per-table `schema_version`, single-sourced across web/native with byte-parity fixtures (C.3 of the 2026-07-16 parity-harness spec).

- [ ] **Step 3: Append a note to the determinism spec** — a short section: "2026-07-16: the push envelope moved to `/v2/snapshot` with CanonicalJSON + per-table `schema_version`; replay determinism is unaffected (the outbox row shape is unchanged), and the byte contract is now pinned by the golden-envelope fixtures. See `docs/superpowers/plans/2026-07-16-cloud-bridge-v2-canonical-envelope.md`."

- [ ] **Step 4: Register the canonical test in `package.json`** — append ` tests/js/test-cloud-bridge-canonical.mjs` to the `test:regression-core` command (line 25). (`push`, `golden`, and `coverage` are already in that lane.)

Run: `npm run test:regression-core 2>&1 | tail -5`
Expected: PASS — the whole regression-core lane green, including the new canonical test.

- [ ] **Step 5: Commit**

```bash
git add docs/V2_FREEZE_PLAN.md docs/PROJECT_ROADMAP.md docs/superpowers/specs/2026-06-01-cloud-bridge-replay-determinism-design.md package.json
git commit -m "docs(cloud-bridge): flip freeze/roadmap evidence rows + register canonical test"
```

---

### PR 1 verification gate + open PR

- [ ] **Run the §15 cloud-bridge targeted suite** (protected-surface requirement):

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
Expected: all suites PASS.

- [ ] **Run the project verify gate:** `npm run verify` (or `/verify`) — eslint + typecheck + Jest + node test runner + build. Expected: green.
- [ ] **Run `detect_changes`** (per `CLAUDE.md`): `detect_changes({scope: "compare", base_ref: "main"})` — confirm only the expected symbols/flows changed. Expected: `pushBatch` bytes + new canonical module; no unexpected surface.
- [ ] **Open the PR using `docs/PROTECTED_PR_TEMPLATE.md`.** Check "Cloud bridge outbox / drainer / DLQ"; in "Invariants intentionally changed" state: old = `/v1` body `{table, location_id, batch_id, rows}` as raw `JSON.stringify`; new = `/v2` CanonicalJSON body with `schema_version`; why = portable byte contract for a second producer + per-table drift signal; tests updated = golden/coverage/canonical/push. List the §15 command as run.

---

# PR 2 — Swift byte-parity (native, additive)

Branch: `feat/cloud-bridge-native-envelope-parity`. **Do not start until PR 1 is merged** (needs the canonical goldens).

### Task 6: Swift canonical serializer

**Files:**
- Create: `LariatNative/Sources/LariatModel/CloudBridge/CanonicalJSON.swift`
- Test: `LariatNative/Tests/LariatModelTests/CanonicalJSONTests.swift`

**Interfaces:**
- Produces: `enum JSONValue` (`.object/.array/.string/.int/.bool/.null`, `Decodable`, `Equatable`); `CanonicalJSON.encode(_ value: JSONValue) throws -> String`; `enum CanonicalJSONError: Error { case unsupportedNumber }`.

- [ ] **Step 1: Write the failing test** — `CanonicalJSONTests.swift`

```swift
import XCTest
@testable import LariatModel

/// Mirrors tests/js/test-cloud-bridge-canonical.mjs — the Swift canonical
/// serializer must produce the same bytes as lib/cloudBridgeCanonical.ts.
final class CanonicalJSONTests: XCTestCase {
    func testSortsKeysRecursivelyNoWhitespace() throws {
        let v: JSONValue = .object(["b": .int(1), "a": .object(["d": .int(4), "c": .int(3)])])
        XCTAssertEqual(try CanonicalJSON.encode(v), #"{"a":{"c":3,"d":4},"b":1}"#)
    }
    func testDoesNotEscapeForwardSlash() throws {
        XCTAssertEqual(try CanonicalJSON.encode(.object(["p": .string("a/b")])), #"{"p":"a/b"}"#)
    }
    func testArrayOrderPreservedKeysSorted() throws {
        let v: JSONValue = .object(["rows": .array([.object(["y": .int(2), "x": .int(1)])])])
        XCTAssertEqual(try CanonicalJSON.encode(v), #"{"rows":[{"x":1,"y":2}]}"#)
    }
    func testDecodingNonIntegerNumberThrows() {
        XCTAssertThrowsError(try JSONDecoder().decode(JSONValue.self, from: Data("1.5".utf8)))
    }
    func testEscapesControlCharactersAndQuotes() throws {
        XCTAssertEqual(try CanonicalJSON.encode(.string("a\"\n")), #""a\"\n""#)
    }
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd LariatNative && swift test --filter CanonicalJSONTests`
Expected: FAIL — `CanonicalJSON` / `JSONValue` undefined (compile error).

- [ ] **Step 3: Create `CanonicalJSON.swift`**

```swift
import Foundation

/// Portable canonical JSON — the byte-for-byte rule the cloud-bridge envelope
/// signs, mirroring lib/cloudBridgeCanonical.ts. Keys sorted recursively, no
/// whitespace, forward slash NOT escaped, integers only (a float throws, as on
/// the web side — the pushable tables carry money as integer cents).
public enum JSONValue: Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case int(Int64)
    case bool(Bool)
    case null
}

public enum CanonicalJSONError: Error, Equatable {
    /// A non-integer / non-finite number reached the codec.
    case unsupportedNumber
}

extension JSONValue: Decodable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let i = try? c.decode(Int64.self) { self = .int(i); return }
        // A number that isn't an integer decodes as Double → reject (fail-loud).
        if (try? c.decode(Double.self)) != nil { throw CanonicalJSONError.unsupportedNumber }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw CanonicalJSONError.unsupportedNumber
    }
}

public enum CanonicalJSON {
    public static func encode(_ value: JSONValue) throws -> String {
        switch value {
        case .object(let dict):
            let parts = try dict.keys.sorted().map { key in
                "\(encodeString(key)):\(try encode(dict[key]!))"
            }
            return "{\(parts.joined(separator: ","))}"
        case .array(let items):
            return "[\(try items.map { try encode($0) }.joined(separator: ","))]"
        case .string(let s):
            return encodeString(s)
        case .int(let n):
            return String(n)
        case .bool(let b):
            return b ? "true" : "false"
        case .null:
            return "null"
        }
    }

    /// Escapes per JSON.stringify: " \ and C0 controls; forward slash NOT
    /// escaped; non-ASCII emitted raw.
    static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{09}": out += "\\t"
            case "\u{0A}": out += "\\n"
            case "\u{0C}": out += "\\f"
            case "\u{0D}": out += "\\r"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) }
                else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd LariatNative && swift test --filter CanonicalJSONTests`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/CloudBridge/CanonicalJSON.swift LariatNative/Tests/LariatModelTests/CanonicalJSONTests.swift
git commit -m "feat(native): canonical JSON serializer mirroring lib/cloudBridgeCanonical.ts"
```

---

### Task 7: Swift envelope encoder + cross-stack byte-parity test (the headline pin)

**Files:**
- Create: `LariatNative/Sources/LariatModel/CloudBridge/CloudBridgeEnvelope.swift`
- Test: `LariatNative/Tests/LariatModelTests/CloudBridgeEnvelopeParityTests.swift`

**Interfaces:**
- Consumes: `JSONValue`, `CanonicalJSON` (Task 6).
- Produces: `CloudBridgeEnvelope.canonicalBody(schemaVersion:table:locationId:batchId:rows:) throws -> String`; `CloudBridgeEnvelope.sign(secret:body:idempotencyKey:) -> String` (HMAC-SHA256 hex).

- [ ] **Step 1: Write the failing parity test** — `CloudBridgeEnvelopeParityTests.swift`

```swift
import XCTest
@testable import LariatModel

/// Cross-stack byte-parity for the cloud-bridge /v2 envelope (C.3 step 5 of the
/// 2026-07-16 parity-harness spec). Loads the SAME shared golden fixtures the web
/// freeze test pins — tests/fixtures/cloud-bridge/golden-envelope.<table>.json —
/// rebuilds the envelope from each fixture's `input`, and asserts the canonical
/// body string AND the HMAC are byte-identical to the frozen `expected`. Pointing
/// at the shared repo fixture (not a LariatNative-local copy) is what makes this a
/// real cross-stack gate.
final class CloudBridgeEnvelopeParityTests: XCTestCase {

    struct Golden: Decodable {
        let table: String
        let testSecret: String
        let input: Input
        let expected: Expected
        enum CodingKeys: String, CodingKey {
            case table, input, expected
            case testSecret = "test_secret"
        }
        struct Input: Decodable {
            let batchId: Int64
            let locationId: String
            let rows: [JSONValue]
            enum CodingKeys: String, CodingKey {
                case rows
                case batchId = "batch_id"
                case locationId = "location_id"
            }
        }
        struct Expected: Decodable {
            let body: String
            let headers: [String: String]
        }
    }

    /// Shared repo fixture dir: <repo>/tests/fixtures/cloud-bridge, reached by
    /// walking up from this test file (LariatNative/Tests/LariatModelTests/…).
    static var fixtureDir: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // LariatNative
            .deletingLastPathComponent()   // repo root
            .appendingPathComponent("tests")
            .appendingPathComponent("fixtures")
            .appendingPathComponent("cloud-bridge")
    }

    func testEnvelopeParityAcrossAllGoldenFixtures() throws {
        let files = try FileManager.default
            .contentsOfDirectory(at: Self.fixtureDir, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent.hasPrefix("golden-envelope.") && $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertGreaterThanOrEqual(files.count, 1, "no golden fixtures at \(Self.fixtureDir.path)")

        for url in files {
            let fx = try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
            // The per-table wire version is read from the frozen body (the oracle).
            let bodyObj = try JSONSerialization.jsonObject(with: Data(fx.expected.body.utf8)) as? [String: Any]
            let schemaVersion = bodyObj?["schema_version"] as? Int ?? -1

            let body = try CloudBridgeEnvelope.canonicalBody(
                schemaVersion: schemaVersion,
                table: fx.table,
                locationId: fx.input.locationId,
                batchId: fx.input.batchId,
                rows: fx.input.rows)
            XCTAssertEqual(body, fx.expected.body, "\(fx.table): canonical body must match the frozen envelope")

            let sig = CloudBridgeEnvelope.sign(
                secret: fx.testSecret, body: body, idempotencyKey: String(fx.input.batchId))
            XCTAssertEqual(sig, fx.expected.headers["x-lariat-signature"], "\(fx.table): HMAC must match")
        }
    }
}
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd LariatNative && swift test --filter CloudBridgeEnvelopeParityTests`
Expected: FAIL — `CloudBridgeEnvelope` undefined (compile error).

- [ ] **Step 3: Create `CloudBridgeEnvelope.swift`**

```swift
import Foundation
import CryptoKit

/// Builds and signs the cloud-bridge /v2/snapshot envelope, byte-identical to
/// lib/cloudBridgePush.ts. The signed body is CanonicalJSON of
/// {schema_version, table, location_id, batch_id, rows}; the signature is
/// HMAC-SHA256(secret, body ‖ idempotencyKey) as lowercase hex.
public enum CloudBridgeEnvelope {
    public static func canonicalBody(
        schemaVersion: Int,
        table: String,
        locationId: String,
        batchId: Int64,
        rows: [JSONValue]
    ) throws -> String {
        let body: JSONValue = .object([
            "schema_version": .int(Int64(schemaVersion)),
            "table": .string(table),
            "location_id": .string(locationId),
            "batch_id": .int(batchId),
            "rows": .array(rows),
        ])
        return try CanonicalJSON.encode(body)
    }

    /// HMAC-SHA256(secret, body ‖ idempotencyKey), lowercase hex. The two
    /// updates with no separator mirror lib/cloudBridgePush.ts::signRequest.
    public static func sign(secret: String, body: String, idempotencyKey: String) -> String {
        var mac = HMAC<SHA256>(key: SymmetricKey(data: Data(secret.utf8)))
        mac.update(data: Data(body.utf8))
        mac.update(data: Data(idempotencyKey.utf8))
        return mac.finalize().map { String(format: "%02x", $0) }.joined()
    }
}
```

- [ ] **Step 4: Run the parity test to confirm it passes**

Run: `cd LariatNative && swift test --filter CloudBridgeEnvelopeParityTests`
Expected: PASS — Swift reproduces the web canonical body + HMAC for every golden fixture. If the body differs, diff the two strings for a key-order or escape mismatch; if only the HMAC differs, the `‖` concatenation order is wrong.

- [ ] **Step 5: Run the full native model suite** (no regressions)

Run: `cd LariatNative && swift build && swift test --filter LariatModelTests`
Expected: build succeeds; LariatModelTests green.

- [ ] **Step 6: Commit + open PR**

```bash
git add LariatNative/Sources/LariatModel/CloudBridge/CloudBridgeEnvelope.swift LariatNative/Tests/LariatModelTests/CloudBridgeEnvelopeParityTests.swift
git commit -m "feat(native): cloud-bridge envelope encoder + cross-stack byte-parity test"
```

Open the PR (rides `native-ci.yml` automatically). Reference PR 1 and the spec's C.3 step 5.

---

## Self-Review (against the 2026-07-16 envelope-contract spec, Part B/C)

**Spec coverage:**
- B.5 "explicit canonical serialization" → Task 1 (`canonicalize`) + Task 6 (Swift twin). ✓
- B.5 "per-table `schema_version` in the signed body, `/v2`" → Task 2. ✓
- B.5 open-Q#1 "where the version map lives" → **resolved: a code constant, in the DB-free `cloudBridgeCanonical.ts`, with a pointer comment (not a re-export) from the queue** (deviates from "next to ALLOWED_TABLES" to preserve `cloudBridgePush.ts`'s documented DB-free property — the push client imports it directly from the canonical module; noted in Task 2 Steps 4 & 6). ✓
- B.5 open-Q#4 "sorted-key canonical vs fixed-order + rule" → **resolved: sorted-key canonical (Option A)**, chosen because it maps onto Swift's native sort and is one uniform rule. ✓
- B.3 "add `cloudBridgePush.ts` to §11 + tests to §13/§15; make the signature protected" → Task 4. ✓
- B.3/§14 "document the shift, protected-PR route" → PR 1 gate uses `PROTECTED_PR_TEMPLATE.md`; freeze rows flipped in Task 5. ✓
- C.3 step 4 (land B.5, re-extract goldens) → Task 2. C.3 step 5 (Swift encoder + parity, depends on step 4) → PR 2. C.3 step 6 (register) → Tasks 4/5. ✓
- §18 fail-loud → integer-only guard throws (Tasks 1, 6). ✓

**Placeholder scan:** every code step carries complete code; every command has an expected result; the one illustrative body string is explicitly labelled "do not hand-write — the gen script produces it." No TBDs.

**Type consistency:** `canonicalize`/`TABLE_WIRE_VERSION` (TS) and `JSONValue`/`CanonicalJSON.encode`/`CloudBridgeEnvelope.canonicalBody`/`.sign` (Swift) are named identically wherever referenced across tasks. `schema_version` (wire field) vs `schemaVersion` (Swift param) vs `SCHEMA_VERSION` (DB, untouched) are kept distinct deliberately.

**Not in scope (deferred, do not mix):** the `/v1/snapshot` receiver (still unbuilt); the native *producer* wiring (ratified edge-only, A5.4 option B — this ships only the encoder + parity pin, not a live native push); SyncOp/idempotency fixtures (#7/#8, gated on the separate native-producer decision); Ed25519 migration (Item 13).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-cloud-bridge-v2-canonical-envelope.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks; fast iteration, tight scope control (well-suited to the protected-surface discipline PR 1 needs).
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

Which approach?
