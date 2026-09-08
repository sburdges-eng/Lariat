# BEO recipe-map — outstanding unknowns

Items referenced on past BEOs that still need a recipe or a whole-buy
vendor mapping. Until they land here, `scripts/beo_order_pull.py` will
surface them in its `unmapped` counter and the order pull will
undercount them (AGENTS.md rule #4 — silence is not an option).

## Open

What the 2026-09-03 sweep could not settle from a source. Each needs an
operator decision, not a data entry:

- **`Braised Chicken,2` and `Carnitas,2` mean two pans of filling per one
  buffet pan.** The event-10 note pins one BEO count to one hotel pan on the
  line, so these only reconcile if prep pans outnumber service pans. Confirm
  which the `per_count` is counting.
- **No BEO in the DB has ever carried `Baja Fish Taco`, `Battered Fish Taco`,
  `Pig Wings` or `Carnitas`.** Those map rows have never been exercised in
  production, which is worth knowing before trusting their `per_count`s.
- **Rope Caesar Salad Buffet is missing the grilled onions** that winter menu
  MI-SA01 names. No recipe exists for them and no source gives a quantity.
- **`Pig Wings` sauce rows carry no `per_count` — quantified 2026-09-08.**
  A 50-piece order resolves `Alabama White Sauce` to **50 gallons** (the route
  reads a missing `per_count` as 50 yield-units; the bare CLI reads it as
  50 batches = 75 gal) and `Lariat Rub` to **50 cups**. No BEO currently
  carries a Pig Wings line, so this is a landmine rather than a live
  over-order. Left unfixed because nothing in the recipe book, the winter menu
  or `DATA.purchase` gives a sauce-per-wing figure — the numbers would be pure
  invention. Original note follows.
- **`Pig Wings` sauce rows carry no `per_count`.** `Pig Wings` is priced per
  piece ($5.00), so a 50-piece line resolves to 50 yield-units of Alabama
  White Sauce. The pork shank landed 2026-09-03 with an explicit `per_count`;
  the two sauce rows still need theirs.
- **`baja_fish_tacos.csv` names its fish `catfish fillet`.** Winter menu MI-M07
  says catfish, but the vendor guide's only white-fish fillet is Portico
  pangasius, which is what the map now orders. Reconcile the wording so the
  plate BOM and the purchase line stop disagreeing.
- **The `baja_fish_tacos` plate BOM is bypassed by the map**, which lists its
  six sub-recipes directly. The fish and the tortillas now agree with the plate
  (`Fish Fillet,0.025` = 6 oz, `Flour Tortillas,3`), but the six SAUCE rows
  still carry per-taco counts — e.g. `Fish Brine,0.05` against the plate's
  0.25 qt. So one `Baja Fish Tacos` line now orders a plate of fish and
  tortillas with a taco's worth of sauce. Settle what one unit of that $16
  menu item is, then bring the sauce rows onto it or map the plate recipe.

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

## Resolved 2026-09-06

- **Every taco line allocated tortillas for one taco instead of one plate.**
  The map bills taco lines per PLATE — `Fish Fillet,0.025` of a 15 lb case is
  6 oz, exactly `baja_fish_tacos.csv`'s fish line — but the tortilla counts
  were written per taco, so every taco item ordered a third of the tortillas
  and cotija it needed. Same off-by-3 review caught on the Baja rows; it was on
  all nine of the others too. Four independent checks agreed:
  - the plate BOM builds 6 oz to 3 tortillas (2 oz per taco); the old counts
    implied 4.8-6.0 oz per tortilla across all four taco buffets;
  - `Fish Taco Buffet` priced out at **$17.50 a taco against $5.33 a la carte**
    ($16.00 plate / 3). At plate counts it is $5.83 — just over menu, with the
    three buffets ranking correctly by protein cost;
  - birria, whose quantities come from the book and whose `per_count`s predate
    all of this, gave 4.5 oz a taco at the old count and 1.5 oz at the new;
  - event 10 carries 126 lb of raw protein for 150 guests — about 10% food cost
    on $3,650 of taco buffets. Cutting protein instead would leave 4.5 oz raw a
    guest (one taco each) at ~3% food cost, so the protein was right.

  Event 10: corn tortillas **272 -> 816** (5.4 a guest, matching the protein),
  cotija **200 -> 472 oz**. Cotija is not a flat 3x because elote's 64 oz does
  not scale. `tests/js/test-beo-buffet-protein-starch.mjs` now reads the
  tortillas-per-plate figure out of `baja_fish_tacos.csv` and checks every taco
  line against it, so the two cannot drift again.

  Confirmed while working on this, from `beo_line_items` in the seeded DB: one
  BEO count is one hotel pan on the line (event 10's note, "14 hotel pans",
  matches its 14 buffet counts exactly), and Elote salad's $200 is now read
  directly rather than inferred by subtraction.

- **The fish taco sauces are allocated 2.5-10x under the plate BOM.** The
  a-la-carte rows are exactly `Fish Taco Buffet` divided by 20 on all eight
  components, so the buffet is 20 orders and the two sets agree with each
  other. They do not agree with `baja_fish_tacos.csv`, which is the
  authoritative plate BOM for winter menu MI-M07:

  | per order | map | plate BOM | plate/map |
  |---|---|---|---|
  | fish brine | 0.05 qt | 0.25 qt | 5.0x |
  | beer batter | 7.5 g | 75 g | 10.0x |
  | chipotle aioli | 0.0375 qt | 0.1 qt | 2.7x |
  | mexi slaw | 0.1 lb | 0.25 lb | 2.5x |
  | pico de gallo | 0.025 qt | 0.125 qt | 5.0x |
  | aji verde | 0.1 qt | 0.05 qt | 0.5x |
  | fish fillet | 6 oz | 6 oz | 1.0x |
  | tortillas | 3 ea | 3 ea | 1.0x |

  The fish and the tortillas agree exactly, so the portion size is not in
  dispute — one line item is one 6 oz, 3-taco order either way. Two of the
  disagreements are not judgement calls: 0.05 qt of brine cannot submerge a
  6 oz fillet for the 7-minute soak, and 7.5 g of wet batter cannot coat one
  (that is one 600 g batch across **80** orders, against the plate's 8).

  Not fixed here, because the batter cannot be settled from the data. The
  `beer_batter` wet mix (600 g) and the `beer_flour` dry mix (18 cup) are
  separate preps combined at service, and **nothing records the ratio**. The
  plate's 75 g of wet scales to 2.25 cup of dry per order, which is as
  implausible as the map's 1 tbsp. Reconcile the wet:dry pairing first, then
  the whole column can be rebuilt from the plate.

## Resolved 2026-09-05

The first two came out of review on PR #678; the third is an operator call:

- **The braised taco line was pulling the frenched-leg confit.** `Braised
  Chicken Taco` and `Braised Chicken Taco Buffet` mapped through
  `chicken_confit`, which is the whole-leg confit for Roast Chicken Dinner
  (MASTER p27). Once p27's protein line was restored, that mapping started
  ordering **6 cases of frenched chicken legs and 12 gallons of EVOO** for
  event 10's three taco buffets — a costlier wrong answer than the missing
  protein it replaced. `DATA.purchase` names the cut: boneless skinless
  chicken thigh. New `braised_chicken` recipe (thigh + white onion + garlic,
  8 lb per pan mirroring `carnitas`); both taco rows repointed at it with
  their `per_count`s unchanged. `chicken_confit` keeps Roast Chicken Dinner.
  The 8 lb/pan weight and the aromatics were **chef_approved 2026-09-05
  sburdges** — no longer pending review.
  Event 10: `chicken legs 6 case` → `chicken thigh 48 lb`, and the confit's
  EVOO, green salt and herb sprigs drop out entirely (72 → 64 rows).
- **The Battered Avocado buffet lost its filling when the tortillas moved.**
  `b5efea94` moved every taco line to 3 tortillas per order without carrying
  the avocado through, leaving `Avocado,0.4167` (10 ea) against 60 tortillas —
  one avocado per six tacos, ~0.8 oz of flesh, where every sibling plates
  2.0-2.7 oz. Live on event 7 (GOODE), which ordered 30 avocados for 180
  tacos. Now `1.25` (half a Hass, ~2.5 oz, per taco) and pinned by a test that
  fails outside a 0.4-0.75 band.
- **`Baja Fish Taco(s)` allocated one flour tortilla against a full plate of
  fish.** Those rows bill per plate — their `Fish Fillet,0.025` is 6 oz,
  exactly the plate BOM's catfish line — so the tortilla count has to come off
  the same plate. Now `Flour Tortillas,3`, asserted against
  `baja_fish_tacos.csv` so the two cannot drift.

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
- **`corndog_batter`** — added the baking powder the book lists (p9); the recipe
  was subsequently deleted 2026-09-05, see above. See
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
