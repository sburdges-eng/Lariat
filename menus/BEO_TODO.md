# BEO recipe-map — outstanding unknowns

Items referenced on past BEOs that still need a recipe or a whole-buy
vendor mapping. Until they land here, `scripts/beo_order_pull.py` will
surface them in its `unmapped` counter and the order pull will
undercount them (AGENTS.md rule #4 — silence is not an option).

## Open

(none — see "Pending chef review" and the "Resolved" lists below)

## Pending chef review (USDA-default templates in place)

The four items below moved out of STUB on the Phase 1 sweep — each got
a starter ingredient list so the BEO order pull no longer loses them to
the unmapped counter. Provenance is recorded per-row in the `notes`
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
| Mexican Dinner | Composite — wires `birria` + `mexi_slaw` + `pico_de_gallo` + `tomatillo_salsa` + `mini_rellenos` sub-recipes | Confirm rice/beans recipes (currently UNMAPPED — need their own CSV+row), tortilla counts per cover |

**Resolution path** for the remaining open item: decide whether
"Beef tenderloin crostini" is (a) made in-house → expand the STUB's
`.csv` with real ingredients + update the `ingredient_count` column
on `recipe_index.csv`; OR (b) bought whole → point the single
ingredient at a vendor SKU (see `mini_rellenos.csv`, `churros.csv`,
`chocolate_cake.csv` for the whole-buy pattern).

Close an item here with the PR that expands the recipe.

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
