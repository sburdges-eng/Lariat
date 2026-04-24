# BEO recipe-map — outstanding unknowns

Items referenced on past BEOs that still need a recipe or a whole-buy
vendor mapping. Until they land here, `scripts/beo_order_pull.py` will
surface them in its `unmapped` counter and the order pull will
undercount them (AGENTS.md rule #4 — silence is not an option).

## Open

| BEO item | Category | Status / what's needed |
|---|---|---|
| Beef tenderloin crostini | Passed Apps | Needs ingredient list — house recipe (seared tenderloin + crostini + aioli) or vendor whole-buy? |
| Gazpacho | Passed Apps | STUB recipe in place; ingredient list pending. Update `recipes/normalized/gazpacho.csv` when ready. |
| Chilled Corn Leek | Passed Apps | STUB recipe in place; ingredient list pending. Update `recipes/normalized/chilled_corn_leek.csv` when ready. |
| Italian Dinner | Dinners | STUB menu in place; component recipes pending (entrée + sides). Update `recipes/normalized/italian_dinner.csv` + add `sub_recipes` on `recipe_index.csv` row. |
| Mexican Dinner | Dinners | STUB menu in place; component recipes pending. Update `recipes/normalized/mexican_dinner.csv` + add `sub_recipes`. |

The four STUB items above have minimal recipe files so the beo order
pull doesn't lose them to the unmapped counter, but they report as
1 placeholder ingredient until filled in. Search for `STUB` in
`recipes/normalized/` to find them.

**Resolution path** for each: decide whether the item is (a) made
in-house → expand the STUB's `.csv` with real ingredients + update the
`ingredient_count` column on `recipe_index.csv`; OR (b) bought whole →
point the single ingredient at a vendor SKU (see `mini_rellenos.csv`,
`churros.csv`, `chocolate_cake.csv` for the whole-buy pattern).

Close an item here with the PR that expands the recipe.

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
