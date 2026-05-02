# Breaker Audit Finding

**Subsystem:** Location scoping (Section 3)

**Invariant:** Every route should derive `location_id` from either body or query, deterministically, using the canonical helpers. Source: `docs/PATTERNS.md §4`.

**Break attempt:** POST `/api/specials` with `body: { location_id: 'default', ... }` AND `?location=south-kitchen` in the URL (i.e., user explicitly tells the body to scope to the default location while their browser session is on south-kitchen).

**Observed result:** Three routes use the pattern:
```js
const locFromBody = locationFromBody(body);
const locFromReq  = locationFromRequest(req);
const locationId  = locFromBody !== 'default' ? locFromBody : locFromReq;
```

at `app/api/specials/route.js:84`, `app/api/specials/saved/route.js:61`, and `app/api/kitchen-assistant/route.js:103`.

The intent is "prefer the body but fall back to the query." But the implementation conflates "body said default" (a real, intentional value) with "body said nothing" (the helper's null fallback). For the operator above:

- `body.location_id = 'default'` is a real value
- query says `south-kitchen`
- `locationFromBody` returns `'default'` (because the body value is `'default'`)
- the ternary sees `locFromBody === 'default'`, falls through to `locFromReq = 'south-kitchen'`
- the special is written under `location_id='south-kitchen'`, NOT `'default'`

**Expected result:** When the body explicitly carries `location_id`, that value is honored exactly. The "fall through to query" path should only fire when the body did NOT carry a location at all.

The `locationFromBody` helper returns `DEFAULT_LOCATION_ID` for both "explicit default" and "missing" — so the ternary cannot distinguish. The fix is at the call site: detect missing-from-body explicitly:

```js
const locationId = (typeof body?.location_id === 'string' && body.location_id.trim())
  ? body.location_id.trim()
  : locationFromRequest(req);
```

Or hoist a new helper `locationFromBodyOrRequest(body, req)` to `lib/location.ts` so the three sites stay consistent.

**Risk:** Wrong-location writes when an operator legitimately sends `body.location_id='default'` and the URL has a different `?location=`. Probability: low (the LLM-action JSON paths in kitchen-assistant rarely include `location_id='default'` in the body; specials POSTs from the UI typically omit it). Impact: a special, kitchen-assistant action, or saved-special row landing under the wrong location, scoped invisibly to a different site's queries.

**Repro command:**
```bash
grep -n "locFromBody !== 'default'" app/api/specials/route.js \
  app/api/specials/saved/route.js \
  app/api/kitchen-assistant/route.js
```

**Likely files:**
- `app/api/specials/route.js:84`
- `app/api/specials/saved/route.js:61`
- `app/api/kitchen-assistant/route.js:103`
- Possibly: hoist a `locationFromBodyOrRequest` helper to `lib/location.ts`

**Fix class:** logic (or contract-hardening if the helper is hoisted)

**Priority:** **P2** — wrong-location writes under specific input shape; not currently triggered by any UI path on main but a backstop concern.

---

## Optional notes

- The cleanest fix is hoisting `locationFromBodyOrRequest(body, req)` to `lib/location.ts`. That's a `contract-hardening` refactor per `REFACTOR_GOVERNANCE.md` and would let the three sites collapse to one line. The helper would distinguish "key present, value 'default'" from "key absent" at the body-parsing layer where the distinction is still cheap.
- Adjacent thing noticed but NOT this finding: `/api/specials/saved/route.js:113` uses `searchParams.get('location') || 'default'` directly instead of `locationFromRequest`. Cosmetic — same behavior — but drift from the convention.
