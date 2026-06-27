# BEO scoping + strict cascade conversions + on-hand wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two High location-scoping bugs, make the BEO cascade reconcile same-dimension units (with a chef-declarable pack-size table) while staying strict/fail-loud, and subtract on-hand stock from the order guide.

**Architecture:** Track A is two `WHERE` clauses on existing POST handlers. Track B adds a deterministic unit-conversion layer + a `pack_size` column + an explicit `(sub-recipe=slug)` pin to the single canonical walker `scripts/lib/bom_expand.py`, leaving `expand_recipe`'s public contract intact. Track C reads the latest inventory count in `app/api/beo/cascade/route.js` and passes it through the engine's existing `inventory` param, surfacing unmatched stock.

**Tech Stack:** Next.js route handlers (JS, `@ts-nocheck`), better-sqlite3, Python 3 (stdlib only) cascade CLI, `node:test` + `pytest`.

## Global Constraints (verbatim from spec; apply to every task)

- **Strict / fail-loud engine** — no resilient skip-and-continue. Cross-dimension units fail loud.
- **Never invent a quantity.** Missing conversions fail loud (B) or don't subtract (C).
- **No silent drops** (AGENTS.md #4): unmapped, `on_hand_unapplied`, `manifest_warnings` all surfaced.
- **On-hand match is strict** `(ingredient_lower, unit_lower)`; `to_order = max(0, total_needed − on_hand)`.
- **`expand_recipe` public signature + error semantics unchanged.**
- **Parameterized SQL only; every BEO mutation `location_id`-scoped; audit writes stay in-transaction.**
- **No DB schema change / no `SCHEMA_VERSION` bump.**
- **Commits:** prepare one commit per task (prefix `T#:`) but only run `git commit` when the user authorizes (project rule "do not commit unless explicitly instructed"). Run gates regardless.
- **Pre-edit:** run GitNexus `impact({target, direction:"upstream"})` on each symbol before modifying it; `detect_changes({scope:"compare", base_ref:"main"})` before each commit.

---

### Task 1 (Track A): `location_id` scoping on `delete_event` + `prep_done`

**Files:**
- Modify: `app/api/beo/route.js:375` (`prep_done` UPDATE) and `:393` (`delete_event` DELETE)
- Test: `tests/js/test-beo-event-location-scope.mjs` (create)

**Interfaces:**
- Consumes: existing `loc` (`body.location_id || DEFAULT_LOCATION_ID`) already in scope in `beoPostHandler`.
- Produces: nothing downstream; behavior-only change.

- [ ] **Step 1 — Write failing tests.** New file mirroring the `test-beo-cascade-api.mjs` harness (`setDbPathForTest(':memory:')`, import `app/api/beo/route.js`):

```js
// seed an event+task in location 'A'; act as location 'B'
it('delete_event does not cross locations', async () => {
  const id = seedEvent({ location: 'A' });               // helper inserts beo_events
  const res = await route.POST(makePost({ action: 'delete_event', id, location_id: 'B' }));
  assert.equal((await res.json()).ok, true);             // no existence oracle
  const still = conn.prepare('SELECT id FROM beo_events WHERE id = ?').get(id);
  assert.ok(still, 'event in location A must survive a location-B delete');
});

it('prep_done does not cross locations', async () => {
  const ev = seedEvent({ location: 'A' });
  const t = conn.prepare(`INSERT INTO beo_prep_tasks (event_id, task, done, location_id)
                          VALUES (?, 'prep x', 0, 'A')`).run(ev).lastInsertRowid;
  await route.POST(makePost({ action: 'prep_done', id: Number(t), done: 1, location_id: 'B' }));
  const row = conn.prepare('SELECT done FROM beo_prep_tasks WHERE id = ?').get(Number(t));
  assert.equal(row.done, 0, 'task in location A must stay undone after a location-B prep_done');
});
```
`makePost(body)` = `new Request('http://localhost/api/beo', { method:'POST', body: JSON.stringify(body), headers:{'content-type':'application/json'} })`. If `pinRequiredForPic()` is on in the test DB, set the PIN cookie the existing BEO POST tests use (copy from `tests/js/test-beo-update-event-partial-patch.mjs`).

- [ ] **Step 2 — Run, confirm both FAIL** (the survive/stay-undone assertions fail because the mutation currently crosses locations).
  Run: `node --experimental-strip-types --test tests/js/test-beo-event-location-scope.mjs`

- [ ] **Step 3 — Implement.** In `app/api/beo/route.js`:
  - `prep_done` (`:375`): `UPDATE beo_prep_tasks SET done = ? WHERE id = ? AND location_id = ?` → `.run(body.done ? 1 : 0, id, loc)`.
  - `delete_event` (`:393`): `DELETE FROM beo_events WHERE id = ? AND location_id = ?` → `.run(id, loc)`.
  (Audit `postAuditEvent` calls and the `db.transaction` wrapper stay exactly as they are.)

- [ ] **Step 4 — Run, confirm PASS**, and run the existing BEO POST suites to prove no regression:
  `node --experimental-strip-types --test tests/js/test-beo-*.mjs`

- [ ] **Step 5 — Stage for commit** `T1: scope delete_event + prep_done by location_id` (await authorization).

---

### Task 2 (Track B): same-dimension unit conversion at the sub-recipe boundary

**Files:**
- Modify: `scripts/lib/bom_expand.py` (add `_convert`; call it at `:224`)
- Test: `tests/python/test_bom_expand.py`

**Interfaces:**
- Produces: `_convert(qty: float, from_unit: str, to_unit: str) -> float | None` — returns converted qty when `from_unit`/`to_unit` share a dimension, else `None`. Pure; no manifest access.

- [ ] **Step 1 — Failing tests:**
```python
def test_convert_volume_exact():
    assert _convert(2, "cup", "qt") == 0.5      # 4 cup = 1 qt
    assert _convert(1, "gal", "qt") == 4.0
def test_convert_mass_exact():
    assert _convert(1000, "g", "kg") == 1.0
    assert _convert(16, "oz", "lb") == 1.0
def test_convert_cross_dimension_is_none():
    assert _convert(5, "g", "cup") is None      # mass↔volume not convertible
    assert _convert(1, "bag", "qt") is None      # non-dimensional unit
def test_mexi_slaw_sub_recipe_unit_now_converts():
    # mexi_slaw BOM: chipotle aioli, 2, cup ; chipotle_aioli yields qt
    manifest = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)
    leaves = expand_recipe(manifest, "mexi_slaw", manifest["mexi_slaw"].yield_qty, manifest["mexi_slaw"].yield_unit)
    assert leaves, "mexi_slaw must expand without UnitMismatchError"
```
- [ ] **Step 2 — Run, confirm FAIL** (`_convert` undefined; mexi_slaw still raises). `python3 -m pytest tests/python/test_bom_expand.py -k "convert or mexi_slaw" -v`
- [ ] **Step 3 — Implement.** Add near the top of `bom_expand.py`:
```python
# Canonical same-dimension conversion factors → base unit (qt for volume, g for mass).
_VOLUME = {"tsp": 1/192, "tbsp": 1/64, "fl_oz": 1/32, "cup": 1/4,
           "pint": 1/2, "qt": 1.0, "gal": 4.0}
_MASS = {"g": 1.0, "kg": 1000.0, "oz": 28.349523125, "lb": 453.59237}

def _u(unit: str) -> str:
    return unit.strip().lower().replace(" ", "_")

def _convert(qty: float, from_unit: str, to_unit: str) -> float | None:
    f, t = _u(from_unit), _u(to_unit)
    if f == t:
        return float(qty)
    for table in (_VOLUME, _MASS):
        if f in table and t in table:
            return float(qty) * table[f] / table[t]
    return None
```
Then in `_expand_into`, replace the hard raise at `:224-229` with a convert-first guard:
```python
if row_unit != sub_m.yield_unit:
    converted = _convert(row_qty, row_unit, sub_m.yield_unit)
    if converted is None:
        raise UnitMismatchError(
            f"recipe {slug!r} BOM references sub-recipe {sub_slug!r} with unit "
            f"{row_unit!r}, but {sub_slug!r} yields in {sub_m.yield_unit!r}"
        )    # Task 3 extends this message to mention pack_size
    row_qty, row_unit = converted, sub_m.yield_unit
_expand_into(manifest, sub_slug, row_qty * scale, sub_m.yield_unit, out, visited + [slug])
```
- [ ] **Step 4 — Run, confirm PASS** + full file green: `python3 -m pytest tests/python/test_bom_expand.py -v` (CANARY `queso→green_chile` stays green — `bag` is non-dimensional).
- [ ] **Step 5 — Stage** `T2: same-dimension unit conversion in cascade walker`.

---

### Task 3 (Track B): `pack_size` column + chef-declarable cross-dimension conversion + better error

**Files:**
- Modify: `scripts/lib/bom_expand.py` (Manifest field, `_load_recipe_index`, `_convert` call site)
- Modify: `recipes/recipe_index.csv` (append `pack_size` header column)
- Test: `tests/python/test_bom_expand.py`

**Interfaces:**
- Produces: `Manifest.pack_conversions: dict[str, tuple[float, str]]` — `{from_unit_lower: (factor, to_unit_lower)}` parsed from a `pack_size` cell formatted `unit:factor:yield_unit` (`;`-separated for multiple).

- [ ] **Step 1 — Failing tests:**
```python
def test_pack_size_parsed():
    m = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)  # green_chile has empty pack_size today
    assert m["green_chile"].pack_conversions == {}
def test_pack_size_resolves_cross_dimension(tmp_path):
    # synthetic index row green_chile pack_size = "bag:3:qt"; parent BOM references it in 'bag'
    manifest = _manifest_with_pack(tmp_path, child="green_chile", pack="bag:3:qt")
    leaves = expand_recipe(manifest, "queso_test", 1, "qt")
    assert leaves  # 1 bag → 3 qt of green_chile, expands, no raise
def test_unconvertible_error_names_pack_size():
    with pytest.raises(UnitMismatchError, match="pack_size"):
        expand_recipe(_manifest_with_pack(tmp_path, child="green_chile", pack=""), "queso_test", 1, "qt")
```
- [ ] **Step 2 — Run, confirm FAIL.** `python3 -m pytest tests/python/test_bom_expand.py -k pack_size -v`
- [ ] **Step 3 — Implement.**
  - `Manifest`: add `pack_conversions: dict = field(default_factory=dict)`.
  - `_load_recipe_index`: after building `subs`, parse the cell:
```python
pack_conversions = {}
for spec in (row.get("pack_size") or "").split(";"):
    parts = [p.strip().lower() for p in spec.split(":")]
    if len(parts) == 3 and parts[0] and parts[2]:
        try: pack_conversions[parts[0]] = (float(parts[1]), parts[2])
        except ValueError: pass
manifest[slug] = Manifest(..., sub_recipe_slugs=subs, pack_conversions=pack_conversions)
```
  - In `_expand_into`, extend the Task-2 guard: when `_convert` returns `None`, try the child's pack table before raising:
```python
if converted is None:
    pc = sub_m.pack_conversions.get(_u(row_unit))
    if pc and _u(pc[1]) == _u(sub_m.yield_unit):
        converted = float(row_qty) * pc[0]
if converted is None:
    raise UnitMismatchError(
        f"recipe {slug!r} references {sub_slug!r} in {row_unit!r} but it yields "
        f"{sub_m.yield_unit!r}; declare a pack_size (e.g. '{_u(row_unit)}:N:{_u(sub_m.yield_unit)}') "
        f"on {sub_slug!r} in recipe_index.csv"
    )
```
  - `recipes/recipe_index.csv`: append `,pack_size` to the header line only. `csv.DictReader` returns `None`/empty for rows lacking the field (`restval`), so existing rows are unaffected. First grep for positional readers: `grep -rn "recipe_index" scripts lib --include=*.py --include=*.ts` — all current readers use `DictReader`/named columns; confirm before committing.
- [ ] **Step 4 — Run, confirm PASS** + whole file. `python3 -m pytest tests/python/test_bom_expand.py -v`
- [ ] **Step 5 — Stage** `T3: pack_size column for chef-declared cross-dimension conversions`.

---

### Task 4 (Track B): explicit `(sub-recipe=slug)` pin + wider match + manifest_warnings + birria pin

**Files:**
- Modify: `scripts/lib/bom_expand.py` (both loaders, `_could_be_sub`, `_expand_into` gate, new `find_manifest_warnings`)
- Modify: `scripts/beo_cascade_cli.py` (surface `manifest_warnings` in `build_cascade` output)
- Modify: `recipes/normalized/birria.csv:3` (notes `+= " (sub-recipe=qb_seasoning)"`)
- Test: `tests/python/test_bom_expand.py`, `tests/python/test_beo_cascade_cli.py`

**Interfaces:**
- Produces: bom-row key `"sub_slug": str | None`; `find_manifest_warnings(manifest) -> list[dict]` → `[{"recipe","issue"}]`; `build_cascade(...)` result dict gains `"manifest_warnings"`.

- [ ] **Step 1 — Failing tests:**
```python
def test_explicit_sub_pin_binds_nonmatching_name():
    # ingredient 'birria seasoning' pinned to slug 'qb_seasoning' (names don't token-match)
    manifest = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)
    row = next(r for r in manifest["birria"].bom if "seasoning" in r["ingredient"].lower())
    assert row["sub_slug"] == "qb_seasoning"
def test_birria_now_fails_loud_on_g_to_cup():
    manifest = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)
    with pytest.raises(UnitMismatchError, match="pack_size"):
        expand_recipe(manifest, "birria", manifest["birria"].yield_qty, "qt")
def test_unreferenced_declared_sub_warned():
    manifest = build_manifest_from_normalized(REAL_INDEX, REAL_NORMALIZED)
    warns = {w["recipe"]: w["issue"] for w in find_manifest_warnings(manifest)}
    assert "beer_batter" in warns and "beer_flour" in warns["beer_batter"]
```
- [ ] **Step 2 — Run, confirm FAIL.** `python3 -m pytest tests/python/test_bom_expand.py -k "pin or birria or unreferenced" -v`
- [ ] **Step 3 — Implement.**
  - Both loaders: parse an explicit pin from notes and store `sub_slug`:
```python
import re
_PIN = re.compile(r"\(sub-recipe=([a-z0-9_]+)\)")
# inside the bom.append(...) dict in BOTH build_manifest and build_manifest_from_normalized:
m_pin = _PIN.search(notes)
"is_sub_recipe": ("(sub-recipe)" in notes) or bool(m_pin),
"sub_slug": (m_pin.group(1) if m_pin else None),
```
  - `_could_be_sub(manifest, parent, ingredient)`: add `manifest` param; also match display-name tokens:
```python
def _could_be_sub(manifest, parent, ingredient):
    toks = _tokens(ingredient)
    if not toks: return False
    for slug in parent.sub_recipe_slugs:
        names = (_tokens(slug), _tokens(manifest[slug].display_name) if slug in manifest else set())
        if any(toks == n or toks <= n for n in names if n):
            return True
    return False
```
  - `_expand_into` gate (`:216-220`): prefer the explicit pin:
```python
sub_slug = row.get("sub_slug")
if sub_slug is None and (row.get("is_sub_recipe") or _could_be_sub(manifest, m, ingredient)):
    sub_slug = _resolve_sub_slug(manifest, m, ingredient)
if sub_slug is not None and sub_slug not in manifest:
    raise UnknownRecipeError(f"recipe {slug!r} pins sub-recipe {sub_slug!r} which is not in the manifest")
```
  - New `find_manifest_warnings(manifest)`: a declared `sub_recipe_slug` with no bom row whose `sub_slug==slug` or that `_resolve_sub_slug`-resolves to it → warn `"declares sub-recipe 'X' but no BOM row references it"`.
  - `scripts/beo_cascade_cli.py::build_cascade`: add `"manifest_warnings": find_manifest_warnings(manifest)` to the returned dict; `main()` already dumps the dict.
  - `recipes/normalized/birria.csv` row 3 notes: append ` (sub-recipe=qb_seasoning)`.
- [ ] **Step 4 — Run, confirm PASS** + `python3 -m pytest tests/python/test_bom_expand.py tests/python/test_beo_cascade_cli.py -v`. Then run the live blast-radius check and record it in the commit body: `for it in "Carnitas taco" "Quesa Birria Tacos" "Barbacoa Taco"; do echo "{\"line_items\":[{\"item_name\":\"$it\",\"quantity\":1}],\"qty_in_yield_units\":true}" | python3 scripts/beo_cascade_cli.py; done` (expect the `pack_size`-naming error for each until `qb_seasoning` density is declared — intended).
- [ ] **Step 5 — Stage** `T4: explicit sub-recipe pin + manifest_warnings + birria pin (strict)`.

---

### Task 5 (Track C): wire latest-count on-hand into the cascade + surface unapplied

**Files:**
- Modify: `scripts/beo_cascade_cli.py::build_cascade` (compute `on_hand_unapplied`)
- Modify: `lib/beoCascade.ts` (types + parse `on_hand_unapplied`, `manifest_warnings`)
- Modify: `app/api/beo/cascade/route.js` (load latest count, pass `inventory`, return new fields)
- Test: `tests/python/test_beo_cascade_cli.py`, `tests/js/test-beo-cascade-api.mjs`

**Interfaces:**
- Consumes: engine `inventory` (already supported) keyed by build_cascade from `payload["inventory"]`.
- Produces: result fields `on_hand_unapplied: [{ingredient,unit,on_hand,reason}]`, `manifest_warnings` (from T4); TS `CascadeResult.onHandUnapplied`, `.manifestWarnings`.

- [ ] **Step 1 — Failing tests.**
  Python: feed a matching + a non-matching inventory entry; assert one order line shows `on_hand`/reduced `to_order` and the non-matching entry appears in `on_hand_unapplied`.
  JS (`test-beo-cascade-api.mjs`): seed an event+line, seed an `inventory_counts` row + `inventory_count_lines` with a known leaf ingredient/unit; assert `order_guide` row's `to_order == total_needed - on_hand`; seed a junk count line and assert it appears in `on_hand_unapplied`.
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.**
  - `build_cascade`: after `order_lines`, compute:
```python
matched = {(ol.ingredient.strip().lower(), ol.unit.strip().lower()) for ol in order_lines}
on_hand_unapplied = [
    {"ingredient": ing, "unit": unit, "on_hand": oh,
     "reason": "no matching order-guide leaf (ingredient/unit)"}
    for (ing, unit), oh in (inventory or {}).items() if (ing, unit) not in matched
]
# add to returned dict: "on_hand_unapplied": on_hand_unapplied
```
  - `lib/beoCascade.ts`: add `onHandUnapplied: Array<{ingredient;unit;on_hand;reason}>` and `manifestWarnings: Array<{recipe;issue}>` to `CascadeResult`; map them in `parseCascadeResponse` (default `[]` when absent).
  - `app/api/beo/cascade/route.js`: after location-verifying the event, load on-hand:
```js
const inv = db.prepare(
  `SELECT ingredient, unit, on_hand_qty AS on_hand
     FROM inventory_count_lines
    WHERE on_hand_qty IS NOT NULL
      AND count_id = (SELECT id FROM inventory_counts
                       WHERE location_id = ? ORDER BY count_date DESC, id DESC LIMIT 1)`
).all(location);
result = await cascadeFromLineItems(lineItems, { qtyInYieldUnits: true, inventory: inv });
```
   Return `on_hand_unapplied: result.onHandUnapplied` and `manifest_warnings: result.manifestWarnings` alongside the existing fields (and in the `CascadeError` catch branch, return them as `[]`).
- [ ] **Step 4 — Run, confirm PASS** + `node --experimental-strip-types --test tests/js/test-beo-cascade*.mjs` + `python3 -m pytest tests/python/test_beo_cascade_cli.py -v`.
- [ ] **Step 5 — Stage** `T5: subtract latest-count on-hand in cascade; surface on_hand_unapplied`.

---

### Task 6 (Track C/UI): surface `on_hand_unapplied` + `manifest_warnings` in the panels

**Files:**
- Modify: `app/beo/_components/UnmappedCallout.jsx` (two new optional props)
- Modify: `app/beo/_components/EventOrderGuidePanel.jsx`, `EventPrepPanel.jsx` (pass the new fields)
- Test: `app/__tests__/` RTL test (mirror existing panel test) or extend `tests/js/test-beo-cascade-api.mjs` shape assertions

**Interfaces:**
- Consumes: cascade response `on_hand_unapplied`, `manifest_warnings` (T5).

- [ ] **Step 1 — Failing test:** render `UnmappedCallout` with `onHandUnapplied=[{ingredient:'sysco flour',unit:'case',on_hand:4}]` and `manifestWarnings=[{recipe:'beer_batter',issue:'…'}]`; assert both render (the band shows even with empty `unmapped`/no `error`).
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.** Extend `UnmappedCallout` signature to `({ unmapped = [], error, onHandUnapplied = [], manifestWarnings = [] })`; widen the null-guard to also render when either new array is non-empty; add a "Stock not applied" list and a "Recipe warnings" list below the existing sections. Wire both panels to pass `onHandUnapplied={data.on_hand_unapplied}` and `manifestWarnings={data.manifest_warnings}`.
- [ ] **Step 4 — Run, confirm PASS** + the BEO jest/RTL suite (`npm test -- BeoBoard` or the panel test path).
- [ ] **Step 5 — Stage** `T6: surface on_hand_unapplied + manifest_warnings in cascade panels`.

---

## Final verification (after T6)
Run the full gate set and capture output before any "done" claim:
`npm run typecheck` · `npm run lint` · `node --experimental-strip-types --test tests/js/test-beo-*.mjs` · `python3 -m pytest tests/python/test_bom_expand.py tests/python/test_beo_pull.py tests/python/test_beo_cascade_cli.py` · `npm run verify`.

## Self-review notes
- **Spec coverage:** A→T1; B1(conversion)→T2; B2(pack_size)→T3; B3(pin/warnings/birria)→T4; C(on-hand+unapplied)→T5; C/UI surfacing→T6. All spec sections mapped.
- **Type consistency:** `on_hand_unapplied`/`manifest_warnings` (snake, API) ↔ `onHandUnapplied`/`manifestWarnings` (camel, TS) — mapped once in `parseCascadeResponse`.
- **CANARY safety:** `queso→green_chile` stays raising (non-dimensional `bag`, no declared pack_size) — untouched, not weakened.
