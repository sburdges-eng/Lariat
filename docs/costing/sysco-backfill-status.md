# Sysco order-email backfill — complete

Every Sysco order email in the mailbox has been read, parsed and reconciled.
**125 orders, 1,951 line items, $177,985.33**, May 2025 through July 2026. Every
order ties to the total printed in its own email. None were dropped, and every
priced line is classified food / beverage / non-food with nothing unresolved.

Data: `data/cache/sysco/backfill_orders.csv` (per order),
`backfill_lines.csv` (per line), `backfill_classified.csv` (per line, bucketed),
`inline_order_lines.csv` (the 19 orders whose detail was read from the API
response rather than a spooled file).
Scripts: `parse_sysco_emails.py`, `classify_sysco_lines.py`.

## The trailing twelve months

**Aug 2025 – Jul 2026: $150,620.33 of Sysco purchases, averaging $12,551.69 a
month.**

| Bucket | Amount | Share |
| --- | --- | --- |
| **Food** | **$136,890.76** | **90.9%** |
| Beverage (non-alcoholic) | $3,189.49 | 2.1% |
| Non-food supplies | $10,073.33 | 6.7% |
| Shipping | $466.75 | 0.3% |

**$136,890.76 is the verified Sysco food numerator for the trailing twelve
months.** It is not the whole food numerator — Shamrock is a second food vendor
and is not in this figure — but it is measured, not modeled, and it is the first
time this number has existed.

## Every month

| Month | Orders | Total | Per day | Food | Food % |
| --- | --- | --- | --- | --- | --- |
| Jul 2026 | 10 | $17,179.68 | $554.18 | $16,436.64 | 97.1% |
| Jun 2026 | 12 | $25,982.63 | $866.09 | $24,463.55 | 94.2% |
| May 2026 | 16 | $14,518.47 | $468.34 | $12,665.99 | 87.4% |
| Apr 2026 | 9 | $7,662.13 | $255.40 | $6,233.31 | 81.6% |
| Mar 2026 | 12 | $12,912.36 | $416.53 | $12,045.82 | 93.3% |
| Feb 2026 | 12 | $7,650.82 | $273.24 | $7,117.32 | 93.3% |
| Jan 2026 | 10 | $10,488.58 | $338.34 | $9,562.52 | 91.6% |
| Dec 2025 | 7 | $7,530.82 | $242.93 | $5,957.17 | 79.3% |
| Nov 2025 | 5 | $5,216.74 | $173.89 | $4,514.57 | 87.2% |
| Oct 2025 | 7 | $10,341.26 | $333.59 | $8,902.43 | 86.1% |
| Sep 2025 | 7 | $10,211.21 | $340.37 | $9,591.34 | 93.9% |
| Aug 2025 | 8 | $20,925.63 | $675.02 | $19,400.10 | 92.8% |
| *Jul 2025* | *9* | *$25,062.73* | *$808.48* | *$22,647.72* | *90.5%* |
| *May 2025* | *1* | *$2,302.27* | — | *$2,147.63* | *93.3%* |

Italic months sit outside the trailing twelve.

## Two full summers, and they are not the same

The single most useful thing the full backfill adds is a **second summer** to
compare against. The read changed three times on partial data; here is what it
looks like complete.

- **Jul 2025: $808/day. Jul 2026: $554/day.** Last July ran 46% hotter than this
  July.
- **Jun 2026 ($866/day) is the highest month in the record**, but Jul 2025 is
  close behind, so June 2026 is a summer peak rather than a freak event. The
  earlier reading of June as an unexplained anomaly was an artifact of having
  only spring months to compare it against.
- **November 2025 is the true trough at $173.89/day** — lower than April 2026's
  $255. The seasonal swing across the full record is **5.0×**, not 3.4×.

Do not read Jul 2025 as a clean baseline. That month and August carry kitchen
outfitting — a blender container, a Robot Coupe blade, polycarbonate pans, a
grill scraper — items that appear nowhere in 2026. July 2025 non-food was
$2,391 against July 2026's $98.

## The gap between 21 May and 2 Jul 2025

One order on 21 May 2025, then nothing until 2 Jul 2025. Six weeks with no
Sysco order email at all. This is either the pre-opening period, a change in how
ordering was placed, or a genuine hole in the email record. It matters only for
periods before the trailing twelve months, but it is worth knowing which before
anyone builds a two-year comparison on this data.

## Non-food is lumpy, and that distorts any single month

Supplies are bought in batches, not in proportion to food volume. Across the
full record the non-food share of a month runs from **0.6% (Jul 2026) to 20.7%
(Dec 2025)**. A food cost computed from one month uses a numerator with either
almost no supplies stripped out or a fifth of it — which is a third independent
reason not to compute food cost from a single month, alongside the 5× seasonal
swing and the unresolved event-revenue question.

## Order attribution — the facts that made this reliable

**Multi-order emails are common and they defeat the obvious reconciliation
check.** Many emails cover two or three orders under one printed grand total. A
parser that stamps every line with the email's first order number *still ties to
the printed total exactly* — the error is invisible at the check. The
`.item-seller` heading is the real per-order delimiter and carries both number
and seller: `Order #04675097 (Sysco Standard Delivery)`. **31 of 106 spooled
orders came out of multi-order emails.**

**Two email templates exist.** Emails before roughly March 2026 use an older one
(CRLF markup, order number in the `<title>` rather than the header). The same
selectors work on both — verified on order 04420381, 1 Mar, 1 line, $94.22.

**Marketplace orders are mixed into ordinary Sysco emails** and are not food:
`M`-prefixed hashes or 8 digits starting `14`, against `039…`–`047…` for Sysco
Standard Delivery.

## Remaining gaps

- **Order-only emails.** The thread query filters to Confirmation / Allocated /
  Modified. A marketplace order that only produced a "Shipped" notice is missed.
  Non-food and immaterial to the food numerator.
- **Deliveries with no order email at all.** The Feb–Mar cross-check against the
  invoice PDFs ($10,811.61 for 26 Feb – 26 Mar, against $7,650.82 for February
  and $12,912.36 for March) lands in the same ballpark, which is evidence
  against a large volume of missing deliveries. Still properly answered only by
  a Sysco AR statement.
- **Shamrock is a second food vendor** and is not in any figure here.
- **No liquor or beer vendor data exists at all.**
