# BEO recipe-map — outstanding unknowns

Items referenced on past BEOs that still need a recipe or a whole-buy
vendor mapping. Until they land here, `scripts/beo_order_pull.py` will
surface them in its `unmapped` counter and the order pull will
undercount them (AGENTS.md rule #4 — silence is not an option).

## Open

What the 2026-09-03 sweep could not settle from a source. Each needs an
operator decision, not a data entry:

- **`corndog_batter` quantities are suspect.** Its `ap flour,17,cup` and
  `baking soda,0.333,cup` rows are byte-identical to `beer_flour`, and its
  `salt,3,cup` is 32× the book's 1½ Tbsp (MASTER p9) at the same 8 qt yield.
  The CSV looks cross-contaminated at ingest. The missing baking powder landed
  2026-09-03 (matched to the soda row, since the book gives both 20 g), but
  **the quantities were deliberately NOT rewritten** — this recipe is costed,
  and re-deriving it needs the book's own yield reconciled first (its gram
  figures total ≈2.2 qt against a stated 8 qt yield).
- **Rope Caesar Salad Buffet is missing the grilled onions** that winter menu
  MI-SA01 names. No recipe exists for them and no source gives a quantity.
- **`Pig Wings` sauce rows carry no `per_count`.** `Pig Wings` is priced per
  piece ($5.00), so a 50-piece line resolves to 50 yield-units of Alabama
  White Sauce. The pork shank landed 2026-09-03 with an explicit `per_count`;
  the two sauce rows still need theirs.
- **`baja_fish_tacos.csv` names its fish `catfish fillet`.** Winter menu MI-M07
  says catfish, but the vendor guide's only white-fish fillet is Portico
  pangasius, which is what the map now orders. Reconcile the wording so the
  plate BOM and the purchase line stop disagreeing.
- **The `baja_fish_tacos` plate BOM is bypassed by the map**, which lists its
  six sub-recipes directly with per-taco `per_count`s. The plate says 3 flour
  tortillas and 6 oz fish per `1 ea`; the map's counts say one taco. Mapping
  the plate recipe instead would over-order roughly 5×, so it was left alone —
  but the two should agree on what one unit is.

## Pending chef review (USDA-default templates in place)

The items below each got a starter ingredient list so the BEO order pull
no longer loses them to the unmapped counter — the first four on the Phase 1
sweep (2026-04-28), Elote salad and Cob Salad Buffet on the buffet-BOM sweep
(2026-09-03). Provenance is recorded per-row in the `notes`
column of each CSV (`SOURCE: usda_myplate`, `SOURCE: chef_template`,
`SOURCE: in-house`). Quantities are restaurant-scale defaults derived
from the canonical USDA MyPlate publications (public domain) plus
classical vichyssoise-tradition additions where USDA had no direct
match. **Every row tagged `CHEF REVIEW` needs operator confirmation
before the next costing ingest treats these as authoritative.**

| BEO item | Source | Review focus |
|---|---|---|
| Gazpacho | USDA MyPlate (`whatscooking.fns.usda.gov/recipes/myplate-cnpp/gazpacho`) — combined classic + Farmers Market variants | Confirm yield (currently 4 qt), bread-vs-no-bread, cumin level |
| Chilled Corn Leek | USDA MyPlate Corn Soup (`myplate.gov/recipes/corn-soup`) base + vichyssoise template (cream + leek + potato — no direct .gov match) | Confirm cream ratio, potato quantity, garnish (chives default) |
| Italian Dinner | Composite — wires `baked_ziti` + `caprese_skewers` + `artisanal_board` sub-recipes; USDA does not publish multi-course menu plans | Confirm bread vendor + count, decide whether salad is its own sub-recipe |
| Elote salad | `chef_template` — street-corn standard; the BEO Studio blob has no `DATA.purchase` entry and the recipe book has no page for it | Confirm yield (currently 1 hotel pan), corn form (fire-roasted kernels assumed), cotija and mayo levels |
| Cob Salad Buffet | Composition from winter menu MI-SA02 (bacon + bleu cheese + avocado + tomato + egg); BEO Studio records "NEED — no recipe on file", so only the per-pan quantities are templated | Confirm quantities per pan and whether avocado is plated or sliced to order. Chicken is deliberately absent — MI-SA02 sells it as a $6.00 add-on |
| Mexican Dinner | Composite — wires `birria` + `mexi_slaw` + `pico_de_gallo` + `tomatillo_salsa` + `mini_rellenos` sub-recipes | Confirm rice/beans recipes (currently UNMAPPED — need their own CSV+row), tortilla counts per cover |

**Resolution path** for the remaining open item: decide whether
"Beef tenderloin crostini" is (a) made in-house → expand the STUB's
`.csv` with real ingredients + update the `ingredient_count` column
on `recipe_index.csv`; OR (b) bought whole → point the single
ingredient at a vendor SKU (see `mini_rellenos.csv`, `churros.csv`,
`chocolate_cake.csv` for the whole-buy pattern).

Close an item here with the PR that expands the recipe.

## Resolved 2026-09-03

The buffet mappings listed under "Resolved 2026-04-24" below were sauce-only:
they named every brine, batter and aioli and none of the food. The order guide
for a 150-cover buyout (event 10) came back with 60 rows and no chicken, fish,
tortillas, cotija, chips or corn in any of them. Vendor products are from
`docs/Lariat_BEO_Studio_5.html` → `DATA.purchase`.

- **Chicken Confit** — `recipes/normalized/chicken_confit.csv` was missing
  `1 case chicken legs, frenched` and the green salt, both of which the recipe
  book opens the page with (MASTER p27). Every board that expanded it ordered
  EVOO and herbs for a chicken dish with no chicken.
- **Green Chilli** — was missing the roux (1 lb AP flour + 1 lb bacon fat) the
  book calls for on p16 and the index note already described.
- **Fish Taco Buffet** → + `Fish Fillet` (Portico pangasius) + `Taco Setup`.
- **Braised Chicken / Barbacoa / Carnitas Taco Buffets** → + `Taco Setup`
  (corn tortillas + cotija).
- **Battered Avocado Taco Buffet** → + `Avocado` + `Corn Tortillas`. No cotija:
  BEO Studio lists its allergens as "wheat, egg" with no milk.
- **Trio Dips** → + `Tortilla Chips`.
- **Green Chile Mac Buffet** → + `Mac Pasta` (cavatappi + panko). It had the
  cheese sauce and no pasta.
- **Rope Caesar Salad Buffet** → + `Salad Greens` + `Jalapeño Cheddar
  Cornbread` (croutons). It had the dressing and no salad.
- **Cob Salad Buffet** → + `Salad Greens` + `Cobb Salad Setup` (CHEF REVIEW).
- **Elote salad** — had no row at all, so it landed in the cascade's `unmapped`
  list. Now mapped to `Elote Salad` (CHEF REVIEW).

Second pass, same day — the per-taco rows and the shareables had the identical
defect, and the winter menu (`menus/lariat_winter_menu.csv`) turned out to be a
better source than the chef template for both salads:

- **Battered Fish Taco** → + `Fish Fillet` + `Taco Setup`. BEO Studio *does*
  carry a BOM under the singular key `battered fish taco` (pangasius + corn
  tortilla + cotija) — the first pass only checked the `…buffet` key, which
  reads "— no BOM on file —".
- **Baja Fish Taco / Baja Fish Tacos** → + `Fish Fillet` + `Flour Tortillas`.
  Winter menu MI-M07 plates Baja on flour, and puts no cotija on it. Not a
  conflict with the corn on the buffets — they are different dishes.
- **Barbacoa Taco / Braised Chicken Taco / Carnitas taco** → + `Taco Setup`.
  Eight of the map's eleven taco line items resolved to no tortilla at all.
- **Pig Wings** → + `Pig Wings` (Sysco ham shank pig wing, 36 pieces a case).
  Winter menu MI-S03. The map had the sauce and the rub and no pig.
- **Rope Caesar Salad Buffet** → + `Cotija` + `Black Bean & Corn Succotash`,
  both named by winter menu MI-SA01.
- **Cob Salad Buffet** — `cobb_salad_setup` **lost its chicken**. MI-SA02 is
  bacon + bleu cheese + avocado + tomato + egg; chicken is a $6.00 add-on, so
  ordering it for every pan was an over-order.
- **`corndog_batter`** — added the baking powder the book lists (p9). See
  "Open" above for why its quantities were left alone.
- **`baja_fish_tacos`** — `flour tortilla` → `flour tortillas` so it stops
  splitting that row on the order guide against `mexican_dinner`.

`tests/js/test-beo-buffet-protein-starch.mjs` now fails the gate if any buffet
line item resolves to sauces alone, if any taco line item resolves to no
tortilla or no filling, or if chicken reappears in the Cobb.

## Resolved 2026-04-28

- **Beef tenderloin crostini** — house recipe; see `recipes/normalized/beef_tenderloin_crostini.csv` (seared tenderloin + crostini + horseradish cream + arugula; 50 ea per batch).
- **Spanish rice** — USDA MyPlate canonical (`spanish_rice.csv`, 3 qt yield); referenced as sub-recipe by `mexican_dinner`.
- **Refried black beans** — USDA MyPlate canonical (`refried_black_beans.csv`, 3 qt yield); referenced as sub-recipe by `mexican_dinner`.
- **Tomato confit** — house recipe; 6"-deep 1/3 hotel pan filled with cherry tomatoes + 1 sprig thyme + 100g garlic + EVOO to cover.

## Resolved 2026-04-24

- **Churros** — Sysco whole-buy.
- **Philo Bites** — Sysco whole-buy.
- **Chocolate Cake** — Shamrock `CAKE CHOC FUDGY WUDGY 14SLI` + Sysco `Fudgy Wudgy 14ct`.
- **Cupcakes** — authoritative: `scripts/beo_order_pull.py DEFAULT_WHOLE_BUY_EXACT`.
- **Prime Rib** (Dinner + Sliders) — authoritative: `DEFAULT_WHOLE_BUY_EXACT`.
- **Tiramisu** — vendor whole-buy frozen dessert.
- **Banana Cream Pudding** — Shamrock `PUDDING VANILLA 112Z CAN` base + bananas + vanilla wafers + whipped cream.
- **Crab Cake Remoulade** — vendor whole-buy crab cakes + house remoulade.
- **Tex mex egg rolls** — vendor whole-buy frozen + chipotle_aioli.
- **Corn Dogs** — `corndog_batter` + `honey_mustard` (both in-house).
- **Artisanal Boards** (French / Italian / Spanish) — shared `artisanal_board` recipe; curate per regional style at service.
- **Pig Wings** → Alabama White Sauce + Lariat Rub.
- **Green Chile Mac Buffet** → Queso/Mac Sauce + Green Chile.
- **Fish Taco Buffet** → Fish Brine + Beer Batter + Chipotle Aioli + Mexi Slaw + Pico de Gallo.
- **Battered Avocado Taco Buffet** → Beer Batter + Beer Flour + Chipotle Aioli + Mexi Slaw.
- **Barbacoa Taco(/Buffet)** → Birria.
- **Braised Chicken Taco(/Buffet)** → Chicken Confit + Aji Verde.
- **Rope Burger slider** → Bacon Jam + Rope Pickle + Special Sauce + Coleslaw.
- **Nashville Slider** → Buttermilk Brine + Chicken Flour + Beer Batter + Nashville Hot Rub + Nashville Oil + Special Sauce + Coleslaw.
- **Cob Salad Buffet** → Cobb Dressing + Roasted Pepitas.
- **Roast Chicken Dinner** → Chicken Confit + Chicken Jus.
- **Deviled Eggs** — Sysco pre-hardboiled eggs + house seasoning (mayo/mustard/paprika/salt/pepper — refine to house formula).
- **Pork Belly Bao Bun** — house-braised pork belly + hoisin + sesame oil + sesame seed + Sysco bao buns.
- **Carnitas taco / Carnitas Tacos Buffet** — mapped to existing `birria` recipe (same kitchen preparation as Quesa Birria per user).
- **Low Country Boil** — shrimp + corn on the cob + red russet potatoes + Old Bay.
