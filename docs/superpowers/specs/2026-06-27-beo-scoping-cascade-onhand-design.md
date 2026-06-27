# Spec — BEO location-scoping fixes + strict cascade conversions + on-hand wiring

Date: 2026-06-27
Branch: `feat/beo-scoping-cascade-onhand`
Status: draft (awaiting review)

## Goal

Close three confirmed defects in the BEO subsystem surfaced by the 2026-06-27 analysis:
(A) two High-severity location-scoping holes that let a request mutate another location's
data; (B) cascade unit-mismatch and silent sub-recipe defects that today either abort a whole
event's order guide (`mexi_slaw → chipotle_aioli`, `cup`≠`qt`) or silently under-order
(`birria → qb_seasoning` never expands); and (C) the order guide never subtracting on-hand
stock because `/api/beo/cascade` passes no inventory. The cascade engine keeps its
**strict, fail-loud** contract — deterministic same-dimension conversions and a chef-supplied
pack-size table resolve what they can; everything else fails loud with a clear, actionable
message. No quantities are ever invented.

## Non-goals (out of scope this round)

- Resilient/partial cascade (skip-and-continue on an un-resolvable row). Explicitly rejected:
  the engine stays strict/fail-loud.
- Merging same-ingredient/different-unit leaf order lines (e.g. lime juice in `cup` + `tbsp`).
- Ingredient-key parity normalization between inventory counts and recipe leaves (would raise
  the on-hand match rate — flagged as a follow-up).
- Supplying actual chef pack-size numbers (`1 bag green_chile = ? qt`, `qb_seasoning` g→cup
  density). The *mechanism* ships; the data rows ship empty.
- The other two security findings: PIN-to-location binding (#7) and a share-token revoke
  endpoint (#6). Separate follow-ups.
- Any DB schema change / `SCHEMA_VERSION` bump (Track C reads existing tables only).

## User-facing surface

### Track A — POST /api/beo (`delete_event`, `prep_done`)
Behavior change only; request/response shapes unchanged. A `delete_event`/`prep_done` whose
`id` belongs to a different `location_id` becomes a no-op (0 rows affected) and still returns
`{ ok: true }` (no existence oracle across locations), matching how `update_event` already
behaves.

### Track B — cascade engine (`scripts/lib/bom_expand.py`, `recipes/recipe_index.csv`)
- **Same-dimension conversion** at the sub-recipe boundary. Volume (`tsp,tbsp,cup,pint,qt,gal`)
  and mass (`g,kg,oz,lb`) convert exactly. Example: `mexi_slaw` row `chipotle aioli,2,cup` with
  child `chipotle_aioli` yielding `qt` → `0.5 qt` automatically. **`Battered Fish Taco` and
  `Fish Taco Buffet` produce a full order guide + prep board again.**
- **`pack_size` column** (new, optional) on `recipe_index.csv`, declared on the *child* recipe:
  format `<unit>:<factor>:<yield_unit>`, e.g. `bag:3:qt` means "1 bag = 3 qt". Empty by default.
- **Explicit sub-recipe pin** — a BOM row's `notes` may contain `(sub-recipe=<slug>)` to bind a
  child deterministically when names don't token-match. The bare `(sub-recipe)` marker and
  token resolution still work. `_could_be_sub` is widened to also consider display-name tokens.
- **Improved fail-loud message**: an un-resolvable unit mismatch now names the missing pack-size,
  e.g. `recipe 'queso_mac_sauce' references 'green_chile' in 'bag' but it yields 'qt'; declare a
  pack_size (e.g. 'bag:N:qt') on green_chile`.
- **Declared-but-unreferenced sub** (e.g. `beer_batter` declares `beer_flour` with no BOM row):
  loader emits a `manifest_warnings[]` entry surfaced in the CLI output — not a silent drop, not
  a hard abort (it is not a unit mismatch).

### Track C — GET /api/beo/cascade
Same query (`?event_id=N&location=…`). The route loads the **latest inventory count** for the
location (`inventory_counts` ordered `count_date DESC, id DESC`) and passes its non-null
on-hand lines to the engine. Response gains two additive arrays:
```jsonc
{
  "event_id": 12,
  "order_guide":  [{ "ingredient": "guajillo peppers", "unit": "g",
                     "total_needed": 3200, "on_hand": 500, "to_order": 2700 }],
  "prep_demands": [ … ],
  "unmapped":     [ … ],
  "on_hand_unapplied": [{ "ingredient": "sysco flour", "unit": "case", "on_hand": 4,
                          "reason": "no matching order-guide leaf (ingredient/unit)" }],
  "manifest_warnings": [{ "recipe": "beer_batter", "issue": "declares sub-recipe 'beer_flour' but no BOM row references it" }]
}
```
`on_hand_unapplied` and `manifest_warnings` render in the existing `UnmappedCallout`.

## Data model deltas

- **`recipes/recipe_index.csv`**: one new trailing column `pack_size` (after `notes`). Loader
  reads by column name (`csv.DictReader`), so the added column is backward-compatible and absent
  values parse as empty. No other CSV reshape.
- **`recipes/normalized/birria.csv`**: row 3 `notes` gains `(sub-recipe=qb_seasoning)` (data pin).
- **No SQLite schema change.** Track C reads `inventory_counts` + `inventory_count_lines` as-is.

## Invariants

1. **Conversions are exact and reversible** within a dimension; cross-dimension (`g↔cup`,
   `bag↔qt`) is never auto-converted — only a declared `pack_size` resolves it.
2. **Never invent a quantity.** Missing conversions fail loud (Track B) or simply don't subtract
   (Track C) — never a guessed number.
3. **No silent drops** (AGENTS.md #4): unmapped items, unapplied on-hand, and manifest warnings
   are all surfaced.
4. **On-hand match is strict** `(ingredient_lower, unit_lower)` — the unit-agnostic fallback is
   not used from this route, so a miss → no subtraction (safe over-order), never a wrong one.
   `to_order = max(0, total_needed − on_hand)`.
5. **`expand_recipe` (recipe-calculator path) is unchanged** — its strict error semantics and
   public signature stay identical; conversions are additive at the boundary check.
6. **Audit writes stay atomic** with their mutation (Track A leaves the transaction wrapper
   intact); **every BEO mutation stays `location_id`-scoped**.

## Consequences to flag

- **Pinning birria (B3 data) makes birria-family events fail loud** on `qb_seasoning`'s
  `g→cup` until a `pack_size` is declared for it. Affects every menu item mapping `birria`
  (Carnitas, Quesa Birria, Barbacoa, Braised-Chicken-via-birria, etc.). This is the intended
  strict-mode outcome (loud > silently under-ordering seasoning), but it is an availability
  change — see Open question 1.
- `queso`/`green_chile` and anything else referencing a non-dimensional unit **already** fails
  loud today; this work only improves the message. The `test_bom_expand.py` CANARY stays green
  untouched.

## Open questions (proposed defaults)

1. **Apply the birria pin now, or ship the mechanism and defer the pin?** Proposed: apply now +
   document the affected items (strict-fail-loud was the chosen philosophy; the alternative keeps
   a known silent under-order). Reversible by declaring `qb_seasoning` `pack_size` once the chef
   provides density.
2. **"Latest count" = most recent by `count_date` regardless of open/closed.** Proposed: yes
   (cooks want the freshest numbers even mid-count).
3. **`pack_size` location:** a `recipe_index.csv` column (proposed) vs a separate file. Column
   keeps it next to `yield`/`yield_unit` where it's read.

## Task preview (full plan in `docs/superpowers/plans/…`)

- **T1** (A) `delete_event` + `prep_done` `location_id` scoping + cross-location no-op tests.
- **T2** (B) same-dimension unit-conversion helper + boundary integration + pytest.
- **T3** (B) `pack_size` column parse + use + improved fail-loud message + pytest.
- **T4** (B) explicit `(sub-recipe=slug)` pin + wider `_could_be_sub` + `manifest_warnings` +
  birria data pin + pytest.
- **T5** (C) on-hand query + thread `inventory` through `beoCascade.ts`/CLI + `on_hand_unapplied`
  + cascade-api test.
- **T6** (C/UI) surface `on_hand_unapplied` + `manifest_warnings` in `UnmappedCallout` + component test.
