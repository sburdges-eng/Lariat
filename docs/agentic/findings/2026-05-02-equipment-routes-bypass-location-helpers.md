# Breaker Audit Finding

**Subsystem:** Location scoping (Section 3)

**Invariant:** Every API route extracts location via `lib/location.ts` (`locationFromRequest` reads `?location=` or `?location_id=`; `locationFromBody` reads `body.location_id` or `body.location`). Source: `docs/PATTERNS.md §4` ("Do not derive location_id from cookie, header, or session" — and by extension, do not derive directly from `searchParams`/`body` either; the canonical helpers handle the alias + trim contract).

**Break attempt:** GET `/api/equipment?location=south-kitchen` and POST `/api/equipment` with `body: { location: "south-kitchen", ... }`. Compare to a peer route that uses `locationFromRequest`/`locationFromBody`.

**Observed result:** The four `/api/equipment/*` routes (`equipment/`, `equipment/schedule/`, `equipment/parts/`, `equipment/maintenance/`) all derive location via direct `searchParams.get('location_id')` (line 8/17/21/8) and `body?.location_id` (line 78/64/73/68). They do NOT use `locationFromRequest`/`locationFromBody`. Concrete behavior gap:

| Input | `locationFromRequest` | Equipment route |
|---|---|---|
| `?location=south` | `'south'` | falls through to `'default'` (route only checks `location_id`) |
| `?location_id=south` | `'south'` | `'south'` |
| `?location_id=  south  ` (whitespace) | `'south'` (trimmed) | `'  south  '` (untrimmed) |
| body: `{ location: 'south' }` | `'south'` | `'default'` (route only checks `body.location_id`) |
| body: `{ location_id: '  south  ' }` | `'south'` (trimmed) | `'  south  '` (untrimmed) |

A site that uses `?location=foo` (the canonical query alias) gets all equipment records silently scoped to `'default'`. Cross-location data leakage in the equipment surface in any multi-site deployment that sets the location via the canonical alias.

**Expected result:** All four routes import `locationFromRequest`/`locationFromBody` and call them, like every other route in the project. Equipment data carries the location the user requested, regardless of which query/body alias they used.

**Risk:** Cross-location operational-data leak / mis-scope. Equipment is operational, not financial — so this is P2 not P1. But the leak is silent: a site visit at `?location=south` shows the `'default'` location's repairs, parts, and maintenance schedules, with no error and no log line.

**Repro command:**
```bash
# Confirm the gap:
grep -E "(searchParams\.get\('location_id'\)|body.*location_id)\s*\|\|\s*'default'" \
  app/api/equipment/route.ts \
  app/api/equipment/schedule/route.ts \
  app/api/equipment/parts/route.ts \
  app/api/equipment/maintenance/route.ts
```

**Likely files:**
- `app/api/equipment/route.ts:8,78`
- `app/api/equipment/schedule/route.ts:17,64`
- `app/api/equipment/parts/route.ts:21,73`
- `app/api/equipment/maintenance/route.ts:8,68`

**Fix class:** logic (mechanical: replace 4 + 4 = 8 derivation lines)

**Priority:** **P2** — operational data leak in multi-site deployments using `?location=` query alias.

---

## Optional notes

- Same shape as the #96 CRITICAL ("location hardcoded to DEFAULT_LOCATION_ID"), one severity lower because the equipment routes accept SOME `location_id` input — they just refuse to honor the canonical alias.
- Recommended single PR replaces the 8 derivation sites with helper calls. No schema change. Existing tests should pass without modification — the helper returns the same `'default'` for an empty/missing input. Add a regression test that POSTs with `body: { location: 'X' }` and asserts the inserted row has `location_id='X'`, plus a GET with `?location=X` that asserts only X-scoped rows return.
- Adjacent thing noticed but NOT this finding: nine other routes (breaks, sick-worker, pest, sds, etc.) write `locationFromRequest(req) || DEFAULT_LOCATION_ID`. The fallback is dead code — `locationFromRequest` already returns `DEFAULT_LOCATION_ID` on missing/empty input. Cosmetic; no behavior bug.
