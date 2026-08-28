# Sysco spend — food vs beverage vs non-food

Classification of every priced line item in the verified backfill.
Script: `scripts/classify_sysco_lines.py`.
Output: `data/costing/sysco/backfill_classified.csv`.

## Result — the full record, May 2025 – Jul 2026

| Bucket | Amount | Share |
| --- | --- | --- |
| **Food** | **$161,512.72** | **90.7%** |
| Beverage (non-alcoholic) | $3,211.34 | 1.8% |
| Non-food (paper, chemicals, disposables) | $13,056.81 | 7.3% |
| Shipping | $204.46 | 0.1% |
| **Total Sysco** | **$177,985.33** | |

Nothing is unclassified. Every order reconciles to the total printed in its own
email, and the four buckets sum to that total exactly.

For the trailing twelve months (Aug 2025 – Jul 2026), which is the window that
matters for a food cost percentage, food is **$136,717.37** of $150,620.33.
See `sysco-backfill-status.md`.

## This corrects the figure that was in circulation

The working split was **food 94.8% · bar and beverage 2.9% · non-food 2.3%**,
measured on 117 line items. Measured across all **1,931 priced lines**:

| | Prior (117 lines) | Measured (1,931 lines) | Change |
| --- | --- | --- | --- |
| Food | 94.8% | **90.7%** | −4.1 pts |
| Beverage | 2.9% | 1.8% | −1.1 pts |
| Non-food | 2.3% | **7.3%** | **3.2× higher** |

**Non-food supplies are more than three times what the subset suggested.** The
food numerator is correspondingly smaller. Holding sales constant, this *lowers*
the eventual food cost percentage — the opposite direction from where the
earlier revisions were heading.

## Cross-validated against Sysco's own taxonomy

The classifier is not trusted on its own say-so. Sysco's order-guide exports
assign every SUPC to a Sysco category (`Produce`, `Meats`, `Paper & Disposable`,
`Chemical & Janitorial`, and so on). Merging the two guides in Drive gives a
SUPC → category map for 466 products, which covers **1,790 of 1,931 priced
lines**. Mapping the four supply categories to non-food and `Dispenser Beverage`
to beverage gives an independent second opinion on each line.

**1,746 of 1,790 agree — 97.5%.** More importantly, **all 44 disagreements are
the two divergences documented below**, in six description variants. There is no
residue of unexplained mismatches.

| Disagreement | Lines | Amount | Sysco says | This says |
| --- | --- | --- | --- | --- |
| Red Bull (3 description variants) | 41 | $2,492.06 | Canned & Dry | beverage |
| Citrus juice (3 variants) | 3 | $131.22 | Produce | beverage |

Neither is an error. `Canned & Dry` is a warehouse banner describing where the
pallet sits, not a P&L category — energy drink is beverage in any restaurant's
books. Lemon and lime juice genuinely straddle bar mixer and kitchen acid, and
at $131.22 the choice moves nothing.

**The cross-check earned its keep.** It caught a real error the rules missed:
PVC film and aluminium foil rolls were being counted as **food**, worth $298.14.
The keyword `'foil roll'` never matched, because the descriptions read *Foil
Aluminum **Roll** Standard Weight 500 Feet* — not contiguous — and bare `roll`
means bread. No amount of re-reading the rule list would have surfaced that;
only an independent opinion did.

## How the classifier avoids the failure it was built to prevent

Keyword classifiers on product descriptions fail on substring collisions, and a
first-match-wins rule list resolves them silently in whatever order the rules
happen to be written. That error is invisible in the total.

So every description is tested against **all** three rule sets. Anything
matching more than one is a CONFLICT and anything matching none is
UNCLASSIFIED; both must be resolved by an explicit entry in `OVERRIDES` before
they count. Nothing is defaulted into food — food is the numerator, and quietly
defaulting to it inflates the number being measured.

That check caught real errors, including:

- **`Cake Chocolate Fudge 10 Inch`** — "cho**cola**te" contains *cola*. At
  $1,029.50 this was the single largest misclassification risk in the set, and
  it would have been filed as beverage.
- **`Tissue Toilet ...`** — "t**oil**et" contains *oil*.
- **`Flour All Purpose ... Bleached`** — "**bleach**ed" contains *bleach*.
- **`Cleaner Fryer Boil Out`** — "**fry**er" contains *fry*.
- **`Label Roll` / `Towel Roll`** — *roll* as in bread.
- **`Crayon Assorted Round Box`** — matched no rule at all, which is the correct
  outcome for a product the lists have never seen. It surfaced rather than
  defaulting into food.
- **`Onions White Jumbo Bag`** — caught before the rules were written; *bag* was
  deliberately excluded from the non-food list for this reason.

44 descriptions needed an explicit decision. All are recorded in `OVERRIDES`
with the reasoning, so the judgment lives in the repo rather than in rule order.

### One failure mode the collision detector could not see

An override is an exact string match, so a description that *looks* identical
but is not will silently fall through to the rules. `Film Pvc Chloride
Roll 12 X 2000 Feet` carries a non-breaking space where the eye sees a space —
Sysco's HTML emits `&nbsp;` inside some product names. The override was written
correctly and still missed.

Both the parser and the classifier now collapse whitespace before the
description is stored or matched. Only one line in 1,931 was affected, but the
failure is silent by construction, which is what makes it worth guarding.

## Judgment calls, flagged as such

- `Juice Lime Lightly Pasteurized` ($54.27), `Juice Lemon Pasteurized Ultra
  Premium` ($48.13), `Juice Lime Pasteurized Ultra Premium` ($28.82) — bar mixer
  or kitchen acid. All called beverage. Sysco calls them Produce.
- `Nectar Peach` ($111.50) — GOYA 33.8oz. Called beverage.
- `Water Bottled` (Aquafina, $21.85) — called beverage.

Frying oil (`Fry On Shortening Frying Liquid`, $4,424.49) is called **food** — it
is a cooking ingredient, not a supply, despite having no edible identity on its
own. That one is material and worth disagreeing with if you see it differently.

## Why beverage is reported separately, not merged

Sysco delivers no liquor, so this bucket is soda, juice, energy drink, bottled
water and coffee. Whether that belongs inside food cost depends on how Toast
books non-alcoholic beverage sales — which is not yet known. Both figures are
available so the numerator can be matched to whatever convention the sales
export turns out to use. For the trailing twelve months:

- Food only: **$136,717.37**
- Food + non-alcoholic beverage: **$139,928.71**
