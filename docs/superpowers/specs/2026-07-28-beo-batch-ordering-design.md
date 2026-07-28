# BEO ordering in whole batches

Date: 2026-07-28
Status: design — not implemented. Stop here for review.

## Problem

A BEO orders and preps in batches, because that is what a kitchen can actually make. The
cascade does not know what a batch is. It scales a recipe linearly and hands back a
fraction, and where a mapping has no `per_count` it does something worse.

Two failures, both live today:

**A batch multiplied by a piece count.** A mapping with no `per_count` falls back to "one
full batch per line-item count". For a buffet line, where one count is one tray, that is
roughly right. For a per-piece line it is nonsense — 50 Nashville Sliders currently pull:

```
chicken_flour      1100.00 qt      (50 x the 22 qt dredge bin)
nashville_hot_rub   100.00 cup     (50 x the 2 cup batch)
nashville_oil       100.00 qt      (50 x the 2 qt batch)
```

A dredge bin is not consumed per sandwich, and nobody makes fifty of them.

**Fractions nobody can make.** Where a `per_count` does exist, the result is honest about
consumption but useless as an instruction: 50 sliders eat 3.12 qt of coleslaw, which is
0.26 of a 12 qt batch. You cannot make a quarter of a batch of coleslaw.

## The rule

Three numbers per recipe per event, not one.

| | what it means | how it is computed |
|---|---|---|
| **consumption** | what the event actually eats | `qty x per_count`, in the recipe's yield unit — unchanged from today |
| **order** | what to buy | whole batches, rounded **up**, never fewer than **one** |
| **prep** | what to make | half-batch granularity, rounded **up** |

Owner's decisions behind this:

- The floor applies to **ordering**. A BEO buys at least one full batch of every recipe it
  touches.
- Rounding is **up**, both places. Prep at 0.5 granularity rounding down would make 2 qt of
  special sauce for an event that eats 3.1.
- Small events are **not** special-cased. A six-guest private event still buys full
  batches; the premium for that is priced into the event, not engineered around.
- A batch is **never multiplied by a piece count**. One batch minimum means one batch for
  the event, not one per slider.

Worked, for 50 Nashville Sliders:

| recipe | eats | batches | order | prep |
|---|---|---|---|---|
| Buttermilk Brine | 12.0 qt | 1.00 | 1 batch — 12 qt | 1.0 batch — 12 qt |
| Special Sauce | 3.1 qt | 0.78 | 1 batch — 4 qt | 1.0 batch — 4 qt |
| Coleslaw | 3.1 qt | 0.26 | 1 batch — 12 qt | 0.5 batch — 6 qt |

Coleslaw is the case that earns the distinction: buy ingredients for 12 qt, make 6.

## Where it goes

`_accumulate_recipe_demand` in `scripts/lib/bom_expand.py` scales a recipe's BOM by
`scale = qty / m.yield_qty` and walks its sub-recipes. That single scale factor is the seam.

Ordering wants `order_scale = max(1, ceil(qty / yield_qty))`; prep wants
`ceil(qty / yield_qty * 2) / 2`; consumption keeps today's raw `qty / yield_qty`.

The three must travel together to the surfaces, because a cook reads prep and a manager
reads order:

```
scripts/beo_cascade_cli.py   ->  lib/beoCascade.ts  ->  app/api/beo/*  ->  BEO panels
                             \-> LariatNative BeoCascadeClient (shells to the same CLI)
```

Native shells out to the CLI rather than reimplementing the walker, so it inherits this
for free — no Swift port, consistent with how `manifest_warnings` was surfaced.

## The floor cascades

**Owner's call: floor everywhere.** A sub-recipe is a batch too — you cannot make a third
of a batch of seasoning any more than a third of a batch of birria.

So the walk floors at every level. A sub-recipe's demand derives from its parent's
**floored** figure, and is then floored itself:

```
birria           eats 8.5 qt of a 16 qt batch  ->  order 1 batch
  qb_seasoning   demand derived from 1 whole batch of birria, then floored to 1 batch
```

The consequence is deliberate and worth stating plainly: a small BEO buys a full batch of
every leaf in the tree. That is what the kitchen actually does, and the premium for a small
private event is priced into the event rather than engineered around.

Consumption is **not** floored at any level — it stays the honest linear figure, because it
answers a different question ("what did this event eat") and is what a food-cost number has
to be built from.

## Not in scope

- `per_count` values for chicken flour, Nashville hot rub and Nashville oil. Once ordering
  floors at a batch these stop being urgent, and they should be set against the new
  behaviour rather than guessed at now.
- Changing what a missing `per_count` means for **buffet** lines, where one count is one
  tray and a whole batch is often right.

## Verification

- Unit tests in `tests/python/test_bom_expand.py` for the three quantities, including the
  0.78 → 1.0 prep case and the 0.26 → 0.5 case.
- A regression test pinning that 50 Nashville Sliders order **one** batch of dredge flour,
  not fifty.
- `test_beo_cascade_cli.py` for the output shape, since the CLI contract is what native
  and the web edge both read.
- `npm run test:beo`, `npm run test:recipe-bom-audit`.
