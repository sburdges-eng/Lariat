# First Protected-Lane Extraction PR: Cloud-Bridge Dead-Letter Route Guards

Status: draft
Suggested branch: `app/cloud-bridge-dead-letter-route-guards`
Suggested PR title: `refactor: extract shared dead-letter route guards for cloud bridge`

## Goal

Make one small structural improvement inside a protected lane without changing semantics.

This PR should reduce duplication between the dead-letter mutation routes while preserving:
- PIN gating
- id parsing behavior
- cross-location 404 behavior
- alive-vs-dead-letter race handling
- audit action emission
- response shape
- queue semantics

## Why this is the right first extraction PR

This is the safest protected-lane cut because:
- the duplication is obvious
- the queue semantics already live below the route layer
- the protected behavior is mostly precondition scaffolding, not mutation math
- the two routes already want the same guard behavior
- tests already pin the most important external behavior

This PR should prove that protected-surface refactors can tighten structure without changing operational truth.

## Current duplicated scaffolding

Routes:
- `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Repeated behaviors in both:
- `withIdempotency(...)` wrapper
- `requirePin(req)`
- `parseId(params?.id)`
- snapshot current dead-letter row with `getDeadLetter(id)`
- return `404` when row is missing / alive
- enforce cross-location IDOR protection with `locationFromRequest(req)`
- return `404` instead of `403` on cross-location access
- perform mutation and translate race-to-miss into `404`
- emit management-action audit on success
- return `{ ok: true, batch_id, table, location_id }`

## Proposed extraction seam

Create a helper dedicated to route-side preconditions only.

Suggested file:
- `lib/cloudBridgeRouteGuards.ts`

Suggested responsibilities:
1. parse route `id`
2. fetch current dead-letter row
3. enforce caller location scoping
4. return either:
   - a normalized target object for mutation routes, or
   - a ready `Response` for bad id / not found / cross-location denial

Suggested non-responsibilities:
- do not perform the actual requeue/drop mutation
- do not write audit entries
- do not decide success response payload
- do not own idempotency wrapping
- do not change queue semantics from `lib/cloudBridgeQueue.ts`

## Possible helper shape

Conceptual API only — keep naming simple:

- `parseDeadLetterId(raw): number | null`
- `loadScopedDeadLetterTarget(req, rawId): { ok: true, id, before } | { ok: false, response }`

Alternative if keeping helpers smaller is preferred:
- `parseDeadLetterId(raw)`
- `validateDeadLetterLocation(req, before)`
- route keeps orchestration

Preferred direction:
- one small loader/guard helper returning a discriminated result
- keeps route code shorter without hiding the protected policy

## Scope boundaries

### In scope
- create one shared helper module for dead-letter route preconditions
- update requeue route to use it
- update drop route to use it
- keep audit payload creation explicit inside each route
- keep route response payload unchanged

### Explicitly out of scope
- changes to `lib/cloudBridgeQueue.ts`
- changes to retry budgets or DLQ thresholds
- changes to `withIdempotency`
- changes to audit action names or payload schema
- changes to route URLs
- changes to response status codes
- changes to `locationFromRequest()` behavior
- changes to PIN behavior
- changes to dead-letter list or status routes
- any sync/peer route changes

## Files expected to change

Create:
- `lib/cloudBridgeRouteGuards.ts`

Modify:
- `app/api/cloud-bridge/dead-letters/[id]/requeue/route.js`
- `app/api/cloud-bridge/dead-letters/[id]/drop/route.js`

Possible test touch only if necessary:
- `tests/js/test-cloud-bridge-dead-letters-api.mjs`

## Invariants that must remain unchanged

### Requeue route
- non-numeric id still returns `400`
- unknown id still returns `404`
- alive row still returns `404`
- cross-location guessed id still returns `404`, not `403`
- successful requeue still returns `200` with existing payload shape
- audit action remains `cloud_bridge_dead_letter_requeued`

### Drop route
- non-numeric id still returns `400`
- unknown id still returns `404`
- alive row still returns `404`
- cross-location guessed id still returns `404`, not `403`
- successful drop still returns `200` with existing payload shape
- audit action remains `cloud_bridge_dead_letter_dropped`
- dropped payload audit retention remains intact

### Shared
- `withIdempotency` remains on both POST routes
- `requirePin` still gates both routes
- mutation semantics still come from `lib/cloudBridgeQueue.ts`
- race where row changes between snapshot and mutation still translates to `404`

## Why this helper must stay narrow

If the helper grows into a generic “do dead-letter mutation” abstraction, it becomes harder to review:
- mutation semantics get hidden
- audit differences get blurred
- route-specific action names get abstracted away
- protected behavior becomes less visible during review

The helper should unify preconditions, not erase the route’s policy readability.

## Test plan

Minimum required targeted suite:

```bash
node --experimental-strip-types --test \
  tests/js/test-cloud-bridge-dead-letters-api.mjs \
  tests/js/test-cloud-bridge-queue-race-safety.mjs
```

Recommended additional focused run if any queue helper import shape changes unexpectedly:

```bash
node --experimental-strip-types --test tests/js/test-cloud-bridge-drainer.mjs
```

## Reviewer checklist for this PR

- [ ] helper only extracts duplicated route preconditions
- [ ] queue behavior remains in `lib/cloudBridgeQueue.ts`
- [ ] both routes still return `404` on cross-location guessed ids
- [ ] audit action names and payload shapes remain explicit in each route
- [ ] response shapes are unchanged
- [ ] no unrelated cleanup mixed into the routes
- [ ] targeted cloud-bridge tests were run

## Expected payoff

Biggest benefit:
- future changes to dead-letter route policy will have one guarded precondition path instead of two drifting copies

Practical payoff:
- lower chance that one route keeps the IDOR / not-found policy while the other accidentally diverges
- better proof that protected-surface refactors can be structural, narrow, and safe

## Follow-on work explicitly deferred

- typed migration of these routes
- extracting audit builders
- extracting shared success-response builders
- any work on `/api/peers/sync-since`
- any queue semantics changes
- any cloud-bridge UI changes
