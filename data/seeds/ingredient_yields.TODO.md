# TODO — ingredient yields missing from the live BOM

**This is a worklist, not seed data.** Nothing reads this file. Every seeder in
`scripts/` names its CSV exactly (`seed_ingredient_yields.py` reads
`data/seeds/ingredient_yields.csv` and nothing else), so a row left half-filled
here cannot leak into costing. `tests/python/test_seed_coverage.py` asserts the
two files never list the same ingredient, so a name has to leave this file when
it lands in the seed.

## What this is

`tests/python/test_seed_coverage.py` checks that every raw ingredient in the
live `bom_lines` has a yield row. It is currently red: **235 keys, 151 covered,
84 uncovered (64.3%).** Those 84 split two ways, and the split matters because
only one half needs measuring.

The gap has moved 111 → 93 → 84, and none of that came from measuring
anything. Sub-recipes left the denominator (their yield is batch output in
`recipe_costs`, not a trim percentage), non-food left it too, and eight
whole-buy items were confirmed as `1.0`. What remains is the part that needs
real numbers.

## The rule

**Do not guess a number to make the test go green.** `yield_pct` feeds
`runCostingPostPass`, which feeds order quantities and margins. A plausible
wrong value is worse than a red test, because it is silent. Leave a row blank
until someone knows it. Sources, in order of preference: a Lariat measurement,
then The Book of Yields.

`yield_pct` is the usable fraction of what you buy, `0..1`. `loss_factor` is
cook loss where it applies. An item bought ready to use is `1.0` — that is a
real value, not a placeholder.

## Decisions taken — 2026-07-29

Nine rows closed without measuring anything, on two operator calls.

**Non-food is excluded by category, not given a yield.** `bamboo skewers 6in`
has no usable fraction; recording `1.0` would have looked like a measurement
that was never taken. It lives in `NON_FOOD_KEYS` in
`tests/python/test_seed_coverage.py`, which also fails if an entry stops
appearing in the BOM, so the exclusion cannot outlive the thing it excludes.

**Vendor whole-buy and prepped items are `1.0`, confirmed.** Eight rows —
`assorted cheeses vendor whole buy`, `assorted cured meats vendor whole buy`,
`bao buns sysco`, `crab cakes frozen vendor whole buy`, `hardboiled eggs sysco`,
`pudding vanilla base shamrock sysco`, `roasted root veg sysco`,
`tex mex egg rolls vendor whole buy` — arrive ready and take no trim. They are
in the seed with `source=seed` and a note recording the confirmation and date,
matching the 137 rows already carrying `1.0` for the same reason.

## Part 1 — 72 ingredients with no yield row

Sorted by how many BOM lines use each, so the top of the table is where the
costing error is largest today.

| ingredient_name | lines | yield_pct | loss_factor | source | notes |
| --- | ---: | --- | --- | --- | --- |
| `basil fresh` | 3 |  |  |  |  |
| `extra virgin olive oil` | 3 |  |  |  |  |
| `unsalted butter` | 3 |  |  |  |  |
| `cherry tomatoes` | 2 |  |  |  |  |
| `parmesan reggiano` | 2 |  |  |  |  |
| `tomato sauce` | 2 |  |  |  |  |
| `achiote` | 1 |  |  |  |  |
| `adobo seasoning` | 1 |  |  |  |  |
| `arugula` | 1 |  |  |  |  |
| `baguette` | 1 |  |  |  |  |
| `bananas` | 1 |  |  |  |  |
| `bay leaf` | 1 |  |  |  |  |
| `beef tenderloin` | 1 |  |  |  |  |
| `birria seasoning` | 1 |  |  |  |  |
| `breakfast burrito` | 1 |  |  |  |  |
| `canned black beans` | 1 |  |  |  |  |
| `canned diced tomatoes` | 1 |  |  |  |  |
| `catfish fillet` | 1 |  |  |  |  |
| `chipotle in adobo` | 1 |  |  |  |  |
| `chives` | 1 |  |  |  |  |
| `ciabatta loaf` | 1 |  |  |  |  |
| `colby jack shredded` | 1 |  |  |  |  |
| `corn on the cob` | 1 |  |  |  |  |
| `corn tortillas` | 1 |  |  |  |  |
| `crackers or baguette` | 1 |  |  |  |  |
| `crushed tomatoes` | 1 |  |  |  |  |
| `day old bread` | 1 |  |  |  |  |
| `ditalini noodles` | 1 |  |  |  |  |
| `flour tortilla` | 1 |  |  |  |  |
| `flour tortillas` | 1 |  |  |  |  |
| `fresh chives` | 1 |  |  |  |  |
| `fruit or preserve` | 1 |  |  |  |  |
| `garlic puree` | 1 |  |  |  |  |
| `granulated sugar` | 1 |  |  |  |  |
| `guinness` | 1 |  |  |  |  |
| `hatch chile with juice` | 1 |  |  |  |  |
| `hatch green chile` | 1 |  |  |  |  |
| `hoisin sauce` | 1 |  |  |  |  |
| `horseradish` | 1 |  |  |  |  |
| `hot dogs` | 1 |  |  |  |  |
| `leeks` | 1 |  |  |  |  |
| `lime wedges` | 1 |  |  |  |  |
| `long grain white rice` | 1 |  |  |  |  |
| `mayo` | 1 |  |  |  |  |
| `miso` | 1 |  |  |  |  |
| `mixed greens` | 1 |  |  |  |  |
| `modelo especial` | 1 |  |  |  |  |
| `mozzarella ciliegine` | 1 |  |  |  |  |
| `mozzarella shredded` | 1 |  |  |  |  |
| `old bay seasoning` | 1 |  |  |  |  |
| `olives or pickle` | 1 |  |  |  |  |
| `panko bread crumbs` | 1 |  |  |  |  |
| `parmesan grated` | 1 |  |  |  |  |
| `pepper jack` | 1 |  |  |  |  |
| `pork belly` | 1 |  |  |  |  |
| `prepared granola` | 1 |  |  |  |  |
| `prosciutto` | 1 |  |  |  |  |
| `red bell pepper` | 1 |  |  |  |  |
| `red russet potatoes` | 1 |  |  |  |  |
| `redbird chicken legs` | 1 |  |  |  |  |
| `remoulade sauce` | 1 |  |  |  |  |
| `ricotta cheese` | 1 |  |  |  |  |
| `salted butter` | 1 |  |  |  |  |
| `sesame seed` | 1 |  |  |  |  |
| `sharp cheddar` | 1 |  |  |  |  |
| `sliced peaches drained thawed` | 1 |  |  |  |  |
| `vanilla extract` | 1 |  |  |  |  |
| `vanilla wafers` | 1 |  |  |  |  |
| `whipped cream` | 1 |  |  |  |  |
| `yellow cake mix` | 1 |  |  |  |  |
| `yukon gold potato` | 1 |  |  |  |  |
| `ziti noodles` | 1 |  |  |  |  |
## Part 2 — 12 that may already be covered under another name

Each of these has a near-match already in the seed. They are **not** collapsed
automatically: whether `chopped garlic` shares garlic's yield depends on whether
it arrives peeled, and if it does not, copying the number under-orders. One
answer per row closes it — either "same, alias it" or "different, measure it".

| bom key | already covered as | lines | same purchase form? |
| --- | --- | ---: | --- |
| `fresh thyme` | `thyme` | 3 |  |
| `ground cinnamon` | `cinnamon` | 2 |  |
| `thyme fresh` | `thyme` | 2 |  |
| `butter diced or melted` | `melted butter` | 1 |  |
| `butter melted` | `melted butter` | 1 |  |
| `chopped garlic` | `garlic` | 1 |  |
| `fresh cilantro` | `chopped cilantro` | 1 |  |
| `ground nutmeg` | `nutmeg` | 1 |  |
| `picked rosemary` | `rosemary` | 1 |  |
| `picked tarragon` | `tarragon` | 1 |  |
| `picked thyme` | `thyme` | 1 |  |
| `white onion` | `diced white onions` | 1 |  |
## Closing a row

1. Put the value in `data/seeds/ingredient_yields.csv`, with a `source`.
2. Delete the row from this file.
3. `python scripts/seed_ingredient_yields.py` (idempotent upsert).
4. `LARIAT_LIVE_DB=<path> python -m pytest tests/python/test_seed_coverage.py`
   — the uncovered count drops by one.

When the last row goes, delete this file and the test goes green on its own.
