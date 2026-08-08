# Sysco purchases, July 2026 — verified month

Every order below was read line by line from its Sysco order email and ties to
the total printed in that email. Nothing here is modeled.

**Source:** `shop-noreply@sysco.com` → `sburdges@gmail.com`, parsed with
`scripts/parse_sysco_emails.py`. Line detail for the five small orders is in
`data/cache/sysco/july_2026_orders.csv`.

## Orders

| Order | Date | Total | Basis |
| --- | --- | --- | --- |
| #04690479 | 5 Jul | $2,524.01 | 33 lines, reconciled to the penny |
| #04697231 | 8 Jul | $8.99 | 1 line |
| #04698081 | 8 Jul | $75.47 | 3 lines |
| #04705867 | 12 Jul | $6,205.64 | 67 lines |
| #04713228 | 15 Jul | $4,960.76 | 50 lines |
| #04720527 | 19 Jul | $2,958.80 | 46 CS |
| #04735930 | 25 Jul | $260.77 | |
| #04745437 | 29 Jul | $111.50 | 1 line, 2 CS peach nectar |
| #04745359 | 29 Jul | $48.95 | 1 line, heirloom cherry tomato |
| #04745480 | 29 Jul | $24.79 | 1 line, pomegranate juice |
| **Total** | | **$17,179.68** | |

All four large orders were re-read independently through
`scripts/parse_sysco_emails.py` and reproduce their stated totals exactly. The
$17,179.70 first reported here was two cents high — it carried the rounded
$16,910.00 subtotal forward. The precise figure is **$17,179.68**.

## What changed, and what it means

The five orders previously unread were expected to be a material gap. They are
not — they total **$269.70**, or 1.6% of the month. The July figure was already
substantially complete at $16,910.00.

That is worth stating plainly because it cuts the other way too: **finishing the
order emails does not close the remaining uncertainty.** The open question is no
longer "which orders were missed" but "do the order emails capture every
delivery." Only a Sysco AR statement or invoice history by date range can answer
that, because an order placed by phone or adjusted by the rep at the truck may
never produce an order email at all.

## Not included

- **The 25 Jul 10:02 PM confirmation** carries no order number and shows the
  marketplace notice. It is the Everyday Supply Co order that later shipped as
  `M435294ea7ee0` — third-party supplies, not food, and not Sysco Standard
  Delivery. Counting it here would mix two different purchase bases.
- **Tax.** Sysco order totals are printed excluding tax and including shipping,
  a different basis from the invoice PDFs. Do not compare the two directly
  without adjusting.

## Composition

The dollar-weighted split measured across 117 parsed line items ($11,166.40) was
food 94.8%, bar and beverage 2.9%, non-food supplies 2.3%. Applied to the full
month that implies roughly $16,286 of food, but **that is an extrapolation, not
a measurement** — the split was taken from a subset. It should be recomputed
across all ten orders before it is used in a food cost calculation.

Two of the new lines are judgment calls rather than obvious food: peach nectar
(GOYA, 2 CS, $111.50) and pomegranate juice (POM Wonderful, $24.79) are both
plausibly bar mixers rather than kitchen ingredients. At $136.29 combined they
do not move the month, but they are the kind of line that has to be classified
consistently once liquor and beer invoices arrive.

## Still open for July

- Whether the order emails capture every delivery (Sysco AR statement).
- No liquor or beer vendor data exists at all, despite liquor being 35.6% of net
  sales.
