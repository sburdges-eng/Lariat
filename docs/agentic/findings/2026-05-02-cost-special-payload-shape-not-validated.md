# Breaker Audit Finding

**Subsystem:** Kitchen Assistant / Specials LLM-action JSON (Section 6)

**Invariant:** `docs/PATTERNS.md §10` ("LLM action JSON"): "Always guard `payload.*` field types before they flow into compute code." The doctrine exists because a model can emit a payload that parses as JSON but has the wrong type for any sub-field — and the compute helpers do not always defend against every shape downstream.

**Break attempt:**
LLM emits the following well-formed JSON for the `cost_special` action in `/api/specials`:

````json
{
  "action": "cost_special",
  "ingredients": [
    { "item": null,            "qty": 1, "unit": "lb" },
    { "item": "tomato",        "qty": 1, "unit": ["tbsp"] },
    { "item": ["red onion"],   "qty": 0.5, "unit": "cup" }
  ]
}
````

`Array.isArray(payload.ingredients)` passes, so the route at `app/api/specials/route.js:111-114` flows into `computeSandboxCost(locationId, payload.ingredients)`.

**Observed result:** `lib/computeEngine/sandboxCosting.ts:50` (`computeSandboxCost`):
- Validates `qty` defensively (line 73-78: `Number.isFinite(qty) && qty > 0`).
- Does NOT validate `ing.item` is a string. With `item: null`, line 80 calls `vendorStmt.get(locationId, \`%${ing.item}%\`)` — JS interpolates as the literal string `"%null%"` and runs the LIKE query, returning whatever vendor row matches. The breakdown row carries `item: null` into the response.
- Does NOT validate `ing.unit` is a string. With `unit: ["tbsp"]`, `normalizeUnit(ing.unit)` is called with an Array. Depending on `normalizeUnit`'s internals, this either coerces to `"tbsp"` (Array.toString), throws (if it does string ops on a non-string), or returns null and the row falls back to `'ea'` — none of which is what the LLM intended.
- For `item: ["red onion"]`, similar: the LIKE pattern becomes `"%red onion%"` (Array.toString) which happens to work but is purely incidental.

The route's `catch (err)` at line 132 catches a thrown error and emits a "Could not compute deterministic cost" warning. Quiet failure for the user; bad-shape audit trail in the markdown response.

**Expected result:** Validate the shape at the route boundary BEFORE handing off. Drop ingredients whose `item` isn't a non-empty string or whose `unit` isn't a string; surface a "skipped" note to the user. Don't let bad-shape rows reach SQL.

```js
const cleaned = payload.ingredients.filter(
  (i) => i && typeof i.item === 'string' && i.item.trim()
           && typeof i.unit === 'string' && Number.isFinite(Number(i.qty)),
);
```

**Risk:** P3 — soft type-shape gap on the LLM-action boundary. Doesn't crash today; the LIKE pattern incidentally tolerates non-string `item`. But this is exactly the regression class PATTERNS.md §10 names as the reason the rule exists ("past dynamic-import bugs silently swallowed module errors" — same class of "silently process unexpected shape" bugs). The kitchen-assistant route's matching `scale_recipe` / `log_haccp_receiving` / `update_order_guide` actions DO validate field types (`String(payload.recipe)`, `Number(payload.multiplier)`, `typeof payload.package_ok === 'boolean'`); only `cost_special` skips the per-field guard.

**Repro command:**
```bash
# Confirm the gap:
sed -n '110,135p' app/api/specials/route.js
# vs the kitchen-assistant scale_recipe shape:
grep -A5 "action === 'scale_recipe'" app/api/kitchen-assistant/route.js | head -10
```

**Likely files:**
- `app/api/specials/route.js:110-136` — add per-field guard before calling `computeSandboxCost`
- New: `tests/js/test-specials-cost-action-shape.mjs` — pin the contract: bad-shape ingredients are dropped/rejected without reaching SQL

**Fix class:** logic + test

**Priority:** **P3** — defense-in-depth on an LLM-driven boundary; not currently triggered by any UI path because the chef speaks English and the LLM speaks JSON, but the doctrine exists and the other LLM actions all follow it.

---

## Optional notes

- Adjacent thing noticed but NOT this finding: `computeSandboxCost` accepts `ingredients: SandboxIngredient[]` typed parameter — TypeScript doesn't run at the route boundary because `route.js` is JS. A clean fix would be a runtime validator in `lib/computeEngine/sandboxCosting.ts` exporting `validateSandboxIngredient(x): SandboxIngredient | null` so both the route and any future callers (e.g. a backfill script) compose correctly.
- Verified-correct in this audit: every other section-6 LLM action (scale_recipe, log_haccp_receiving, update_order_guide, generate_prep, beo_add_prep) DOES validate per-field types at the route boundary before flowing into compute code. `cost_special` is the lone outlier.
