# TODO — ingredient yields missing from the live BOM

**This is a worklist, not seed data.** Nothing reads this file. Every seeder in
`scripts/` names its CSV exactly (`seed_ingredient_yields.py` reads
`data/seeds/ingredient_yields.csv` and nothing else), so a row left half-filled
here cannot leak into costing. `tests/python/test_seed_coverage.py` asserts the
two files never list the same ingredient, so a name has to leave this file when
it lands in the seed.

## What this is

`tests/python/test_seed_coverage.py` checks that every raw ingredient in the
live `bom_lines` has a yield row. It is currently red: **235 keys, 231 covered,
4 uncovered (98.3%).**

The gap has moved 111 → 93 → 84 → 80 → 76 → 72 → 4. Sub-recipes and non-food
left the denominator, twenty-one rows closed on operator answers about how
items arrive, and sixty-eight took values: forty-nine that cannot have a trim
step at all, four that are `1.0` because this kitchen buys them prepped, and
eleven real trim yields from the standard reference.

The four still listed are the only ones left, and they are not a measurement
problem — see below.

## The rule

**Do not guess a number to make the test go green.** `yield_pct` feeds
`runCostingPostPass`, which feeds order quantities and margins. A plausible
wrong value is worse than a red test, because it is silent. Leave a row blank
until someone knows it. Sources, in order of preference: a Lariat measurement,
then The Book of Yields.

The `source` column is how a later reader tells them apart. `seed` means no
trim step exists for that item in any purchase form. `book_of_yields` means a
standard reference figure, **not something weighed here** — the eleven rows
carrying it are worth a spot-check against a real case, and the three proteins
among them say so in their own notes.

`yield_pct` is the usable fraction of what you buy, `0..1`. `loss_factor` is
cook loss where it applies. An item bought ready to use is `1.0` — that is a
real value, not a placeholder.

## Decisions taken — 2026-07-29

Twenty-one rows closed without measuring anything, on five operator calls.
Every alias question is now answered; what is left needs numbers.

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

**Chopped garlic arrives peeled, so it is `1.0` — not an alias of `garlic`.**
This is the one that would have gone wrong quietly. `garlic` is `0.87`, and its
note says why: that is the yield of peeling a whole head. Aliasing pre-peeled
garlic to it would have applied peel loss to something already peeled,
understating usable product and over-ordering it on every event. Same shape as
`chopped cilantro` and `diced white onions`, both already `1.0` with
"purchased pre-chopped; no further trim".

**The thyme variants are the same buy as `thyme`, so they take its `1.0`.**
`fresh thyme`, `thyme fresh` and `picked thyme` are three spellings of one
ingredient. Safe to alias precisely because `thyme` carries no trim loss —
had it carried stem loss, giving it to already-picked thyme would have
double-counted. Separate seed rows rather than a normalizer change, matching
how `kosher salt` / `kosher salt diamond crystal` / `kosher salt morton`
are already handled.

**Ground spices and butter are `1.0` in every form.** `ground cinnamon`,
`ground nutmeg`, `butter melted` and `butter diced or melted`. These are not
purchase-form questions at all — a ground spice has no trim however it is
bought, and butter has none whether it arrives diced, melted or in a block, so
there is no version of the answer where the base row's value is wrong for the
variant.

**The last four arrive prepped too, so they are `1.0`.** `fresh cilantro`,
`picked rosemary`, `picked tarragon` and `white onion`. These were held back
longest and deserved to be: each had a base row sitting at `1.0` *because of a
prep step the variant might not have had*, which is precisely the shape that
made chopped garlic wrong. The herbs are not picked from bunches here and the
white onion is not bought whole — both arrive ready — so the prep step has
already happened and the base value is right after all.

Worth keeping in mind if this list ever grows again: the thyme variants, the
garlic and these four all looked identical in a table, and the answer was only
knowable by asking how the item comes through the door. Three said alias, one
said the opposite, and the difference was never visible in the ingredient name.

## The 4 that are left, and why a yield will not fix them

These are not missing measurements. All four carry `map_status = UNMAPPED` in
`bom_lines` — the costing engine already saying the row does not resolve to a
real ingredient. An unmapped row has no vendor, no price and no pack size, so a
yield on it changes no cost and orders nothing.

| bom key | qty | unit | what it actually is |
| --- | --- | --- | --- |
| `fruit or preserve` | 1.0 | cup | a choice, not an ingredient |
| `crackers or baguette` | 1.0 | loaf | a choice, not an ingredient |
| `olives or pickle` | 1.0 | cup | a choice, not an ingredient |
| `breakfast burrito` | 1.0 | each | a composed dish standing in as an ingredient |

The first three are garnish choices written into the BOM as one line with
"or" in the name. The fourth is a finished dish that should be a sub-recipe,
which would also take it out of this check entirely — sub-recipes are already
excluded.

Giving these four a number would turn this test green while leaving them
exactly as uncosted as they are today. That is the failure this file exists to
prevent, so they stay listed until the BOM rows are split or remapped.

## Closing a row

1. Put the value in `data/seeds/ingredient_yields.csv`, with a `source`.
2. Delete the row from this file.
3. `python scripts/seed_ingredient_yields.py` (idempotent upsert).
4. `LARIAT_LIVE_DB=<path> python -m pytest tests/python/test_seed_coverage.py`
   — the uncovered count drops by one.

When the last row goes, delete this file and the test goes green on its own.
