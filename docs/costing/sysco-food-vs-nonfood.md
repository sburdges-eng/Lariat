# Sysco spend — food vs beverage vs non-food

Classification of every priced line item in the verified backfill.
Script: `scripts/classify_sysco_lines.py`.
Output: `data/cache/sysco/backfill_classified.csv`.

## Result — six complete months, Feb–Jul 2026

| Bucket | Amount | Share |
| --- | --- | --- |
| **Food** | **$78,962.63** | **91.9%** |
| Beverage (non-alcoholic) | $1,426.47 | 1.7% |
| Non-food (paper, chemicals, disposables) | $5,168.68 | 6.0% |
| Shipping | $87.54 | 0.1% |
| Unclassified | $260.77 | 0.3% |
| **Total Sysco** | **$85,906.09** | |

Feb–Jun reconcile to the penny against the order totals. July is 98.5%
classified — order #04735930 ($260.77) is counted in the month total but its
line detail was never captured, so it is reported as unclassified rather than
assumed to be food.

## This corrects the figure in circulation

The working split was **food 94.8% · bar and beverage 2.9% · non-food 2.3%**,
measured on 117 line items. Measured across **1,020 priced lines**:

| | Prior (117 lines) | Measured (1,020 lines) | Change |
| --- | --- | --- | --- |
| Food | 94.8% | **91.9%** | −2.9 pts |
| Beverage | 2.9% | 1.7% | −1.2 pts |
| Non-food | 2.3% | **6.0%** | **2.6× higher** |

**Non-food supplies are nearly three times what the subset suggested.** The food
numerator is correspondingly smaller. Holding sales constant, this *lowers* the
eventual food cost percentage — the opposite direction from where the earlier
revisions were heading.

## Non-food is lumpy, which distorts any single month

Supplies are bought in batches, not in proportion to food volume:

| Month | Total | Food | Non-food | Non-food share |
| --- | --- | --- | --- | --- |
| Feb | $7,631.92 | $7,117.32 | $402.29 | 5.3% |
| Mar | $12,912.36 | $12,045.82 | $680.54 | 5.3% |
| Apr | $7,640.77 | $6,233.31 | $1,013.51 | **13.3%** |
| May | $14,485.10 | $12,665.99 | $1,633.11 | 11.3% |
| Jun | $25,968.72 | $24,463.55 | $1,341.25 | 5.2% |
| Jul | $17,179.68 | $16,436.64 | $97.98 | **0.6%** |

April and May carry heavy supply orders; July carries almost none. So a food
cost computed from July alone would use a numerator with essentially no supplies
stripped out of it, while April's would have 13% stripped. **This is a third
independent reason not to compute food cost from a single month**, on top of the
3.4× seasonal swing and the unresolved event-revenue question.

## Why beverage is reported separately, not merged

Sysco delivers no liquor, so this bucket is soda, juice, energy drink and
coffee. Whether that belongs inside food cost depends on how Toast books
non-alcoholic beverage sales — which is not yet known. Both figures are
available so the numerator can be matched to whatever convention the sales
export turns out to use:

- Food only: **$78,962.63**
- Food + non-alcoholic beverage: **$80,389.10**

## How the classifier avoids the failure it was built to prevent

Keyword classifiers on product descriptions fail on substring collisions, and a
first-match-wins rule list resolves them silently in whatever order the rules
happen to be written. That error is invisible in the total.

So every description is tested against **all** three rule sets. Anything
matching more than one is a CONFLICT and anything matching none is
UNCLASSIFIED; both must be resolved by an explicit entry in `OVERRIDES` before
they count. Nothing is defaulted into food — food is the numerator, and quietly
defaulting to it inflates the number being measured.

That check caught real errors on the first run, including:

- **`Cake Chocolate Fudge 10 Inch`** — "cho**cola**te" contains *cola*. At
  $1,029.50 this was the single largest misclassification risk in the set, and
  it would have been filed as beverage.
- **`Tissue Toilet ...`** — "t**oil**et" contains *oil*.
- **`Flour All Purpose ... Bleached`** — "**bleach**ed" contains *bleach*.
- **`Cleaner Fryer Boil Out`** — "**fry**er" contains *fry*.
- **`Label Roll` / `Towel Roll`** — *roll* as in bread.
- **`Onions White Jumbo Bag`** — caught before the rules were written; *bag* was
  deliberately excluded from the non-food list for this reason.

23 descriptions needed an explicit decision. All are recorded in `OVERRIDES`
with the reasoning, so the judgment lives in the repo rather than in rule order.

## Judgment calls, flagged as such

Two are genuinely ambiguous rather than factual, and both are immaterial:

- `Juice Lime Lightly Pasteurized` ($54.27) — bar mixer or kitchen acid. Called
  beverage.
- `Nectar Peach` ($111.50) — GOYA 33.8oz. Called beverage.

Frying oil (`Fry On Shortening Frying Liquid`, $4,424.49) is called **food** — it
is a cooking ingredient, not a supply, despite having no edible identity on its
own. That one is material and worth disagreeing with if you see it differently.
