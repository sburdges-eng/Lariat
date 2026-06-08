# Sync / Cloud Route-Thickness Audit

Status: draft
Scope: protected sync/cloud HTTP routes only
Purpose: identify which route handlers are already thin enough, which still carry meaningful protected logic, and where the safest first extraction seam exists.

## Summary

The sync/cloud route layer is thinner than the average Lariat route, but it is not uniformly thin.

Best overall reading:
- `/api/peers` is already a good route shape and should mostly stay as-is.
- `/api/peers/sync-since` is short, but it is still a high-blast-radius route because it owns auth/param-ordering/error-shape discipline.
- `/api/cloud-bridge/dead-letters` and `/api/cloud-bridge/status` are acceptably thin.
- `/api/cloud-bridge/dead-letters/[id]/requeue` and `/drop` are the thickest routes in this lane, but their thickness is mostly policy orchestration rather than raw query logic.

That means the safest first protected-lane extraction target is not the sync fetch route. It is the repeated dead-letter mutation flow in the cloud-bridge routes.

---

## Route Inventory

### 1. `app/api/peers/route.js`
Approx size: 121 lines

Responsibilities currently in route
- parse and clamp `timeout`
- call `loadPeersAndHub()`
- check PIN cookie
- redact peer topology for unauth callers
- shape final response

What is already good
- route is `@ts-check`, not `@ts-nocheck`
- pure helpers are already extracted inside the route:
  - `parseTimeout`
  - `redactPeerForUnauth`
  - `buildPeersResponse`
- network discovery and hub election are already delegated to `lib/peers.ts`
- trust/topology policy is explicit in comments and testable by shape

Why this route is protected
- pre-PIN discovery must work
- unauth callers must not receive topology/trust identity fields
- timeout clamping is a worker-protection guardrail

Thickness assessment
- thin enough
- most remaining code is policy-revealing glue, not accidental complexity

What should stay in the route
- HTTP-specific request parsing
- PIN-cookie decision point
- final response-shape decision

What could move, but probably does not need to yet
- `parseTimeout` into a tiny route helper module
- `buildPeersResponse` into a shared response helper if another peer route needs identical redaction rules

Recommendation
- do not use this as the first extraction PR
- value/risk ratio is too low; current shape is already good

---

### 2. `app/api/peers/sync-since/route.js`
Approx size: 105 lines

Responsibilities currently in route
- parse `peer_id`, `from_op`, `limit`
- intentionally validate param shape before auth outcome is surfaced
- call `authenticateSyncRequest()`
- preserve generic 401 behavior for both auth and bad-param rejection
- call `replaySince()`
- touch `last_seen` only after successful replay fetch
- shape replay response, including `last_seen_id`

What is already good
- real auth logic lives in `lib/peerTrust.ts`
- replay loading lives in `lib/syncFeed`
- the route is short and comments clearly encode the attack-model reasoning
- error-shape discipline is explicit and intentional

Why this route is protected
- it is the read trust boundary for cross-host sync
- request-shape ordering prevents auth/param oracle leakage
- checkpoint correctness depends on the returned `last_seen_id`
- `last_seen` audit semantics are intentionally delayed until success

Thickness assessment
- physically short, logically dense
- almost every line is a protected behavior line

What should stay in the route
- HTTP header/query extraction
- the exact sequencing of params check vs auth response shape
- the final response contract

What could move safely later
- `parseFromOp` / `parseLimit` into a tiny sync-route helper
- request parsing into a pure `parseSyncSinceRequest()` helper returning `{ paramsOk, peerId, fromOp, limit }`

What would be dangerous to move casually
- generic 401 behavior
- auth-vs-param ordering
- `last_seen` timing
- `last_seen_id` response field

Recommendation
- audit/document heavily, but do not pick this for the first protected-lane extraction PR
- this route is deceptively small but semantically loaded

---

### 3. `app/api/cloud-bridge/dead-letters/route.js`
Approx size: 43 lines

Responsibilities currently in route
- require PIN
- derive caller location
- list dead letters scoped to location
- return queue depth + DLQ depth + configured flag

What is already good
- queue logic is delegated to `lib/cloudBridgeQueue.ts`
- location derivation is delegated to `lib/location`
- bridge-config status comes from `lib/cloudBridge`
- route is simple and readable

Why this route is protected
- dead-letter visibility is a management recovery surface
- location scoping must remain intact
- queue depth / DLQ depth are operator signals

Thickness assessment
- thin enough

What should stay in the route
- PIN gate
- request-to-location binding
- final JSON shaping

Recommendation
- no extraction needed first

---

### 4. `app/api/cloud-bridge/status/route.js`
Approx size: 37 lines

Responsibilities currently in route
- require PIN
- instantiate bridge
- fetch status
- surface configured + stub flags

What is already good
- very small
- almost no accidental complexity

Why this route is protected
- it fronts pairing/transport status for a cross-site system
- PIN gate matters even if implementation is stubbed today

Thickness assessment
- already thin

Recommendation
- leave alone for now

---

### 5. `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
Approx size: 101 lines

Responsibilities currently in route
- wrap handler in `withIdempotency`
- require PIN
- parse route id
- snapshot existing dead-letter row
- enforce cross-location IDOR protection
- invoke `requeueDeadLetter()`
- handle race where row becomes alive between snapshot and mutation
- write management-action audit row
- shape success/error response

What is already good
- queue mutation semantics remain in `lib/cloudBridgeQueue.ts`
- idempotency wrapper is already extracted
- comments clearly explain race and IDOR reasoning

Why this route is protected
- mutates DLQ recovery state
- must not allow cross-location action by guessed numeric id
- audit trail is operationally important
- requeue semantics are part of recovery guarantees

Thickness assessment
- moderate thickness
- most complexity is duplicated policy orchestration rather than unique domain logic

Likely extraction seams
- `parseId` can be shared
- snapshot + location-scope validation can be shared
- common 404-on-cross-location / 404-on-alive-race pattern can be shared
- audit payload construction could be moved to a helper if kept transparent

What should probably stay in the route
- HTTP method handler
- response status shaping
- explicit action naming for audit entry

Recommendation
- strong candidate for first isolated extraction PR

---

### 6. `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`
Approx size: 102 lines

Responsibilities currently in route
- wrap handler in `withIdempotency`
- require PIN
- parse route id
- snapshot existing dead-letter row
- enforce cross-location IDOR protection
- invoke `dropDeadLetter()`
- handle race-to-miss case
- write management-action audit row, including row payload
- shape success/error response

What is already good
- drop semantics remain in `lib/cloudBridgeQueue.ts`
- route comments explain why payload capture is safe
- logic tracks requeue route closely

Why this route is protected
- destructive DLQ mutation
- audit record is the only retained payload after drop
- same location/IDOR policy must hold as requeue

Thickness assessment
- moderate thickness
- very similar orchestration to the requeue route

Likely extraction seams
- same as requeue
- strongest shared seam is “load + validate dead-letter action target”

What should probably stay in the route
- explicit audit action name
- drop-specific audit payload shape
- final response shape

Recommendation
- pair with requeue for a shared helper extraction, but keep mutation-specific audit details separate

---

## Cross-Route Observations

### Safest current route shapes
- `app/api/peers/route.js`
- `app/api/cloud-bridge/dead-letters/route.js`
- `app/api/cloud-bridge/status/route.js`

These are already reasonably thin and should not be refactored just to chase purity.

### Highest semantic density per line
- `app/api/peers/sync-since/route.js`

This route is small but not “easy.” It carries trust-boundary sequencing that can be broken by an apparently harmless cleanup.

### Highest duplication pressure
- `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

These two routes repeat the same protected scaffolding:
- id parsing
- PIN gate
- dead-letter snapshot lookup
- cross-location 404 guard
- race-aware not-found fallback
- action audit on success

This is the best extraction seam in the lane.

---

## Recommended First Extraction PR in This Lane

### Best candidate
Extract a shared helper for dead-letter mutation preconditions used by both requeue and drop.

### Good extraction target shape
Possible helper responsibility:
- parse numeric id
- fetch dead-letter snapshot
- enforce caller location scope
- return a normalized action target or an HTTP response to short-circuit

Example conceptual shape:
- `lib/cloudBridgeRouteGuards.ts`
- function like `loadScopedDeadLetterTarget(req, rawId)`

Return shape could be something like:
- `{ ok: true, id, before }`
- `{ ok: false, response }`

### Why this is the safest first cut
- removes duplicated route scaffolding without changing queue semantics
- leaves `requeueDeadLetter()` / `dropDeadLetter()` behavior untouched
- leaves audit action names and mutation-specific payloads explicit in each route
- reduces future risk of one route drifting from the other on IDOR / 404 behavior

### What not to include in that PR
- no changes to queue retry budgets
- no changes to allow-list behavior
- no changes to idempotency semantics
- no changes to route response shape
- no changes to audit payload content unless purely mechanical and test-pinned

---

## Tests That Must Stay Attached

For any sync/cloud route refactor in this lane, keep these targeted suites attached:

- `tests/js/test-peer-auth.mjs`
- `tests/js/test-peers-route.mjs`
- `tests/js/test-sync-scheduler.mjs`
- `tests/js/test-sync-scheduler-lifecycle.mjs`
- `tests/js/test-sync-client.mjs`
- `tests/js/test-cloud-bridge-dead-letters-api.mjs`
- `tests/js/test-cloud-bridge-drainer.mjs`
- `tests/js/test-cloud-bridge-queue-race-safety.mjs`

If the first extraction PR only touches dead-letter mutation routes, the minimum focused suite should still include:
- `tests/js/test-cloud-bridge-dead-letters-api.mjs`
- `tests/js/test-cloud-bridge-queue-race-safety.mjs`

---

## Bottom Line

The sync/cloud lane does not need broad thinning first.

It needs selective thinning where duplication is highest and semantic risk is lowest.

That means:
1. do not start with `/api/peers/sync-since`
2. do not refactor already-thin status/list routes just to make movement
3. start with shared dead-letter mutation guards for requeue/drop
