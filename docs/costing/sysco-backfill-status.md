# Sysco order-email backfill — complete

Every Sysco order email in the mailbox has been read, parsed and reconciled.
**125 orders, 1,931 priced line items, $177,985.33**, May 2025 through July
2026. Every order ties to the total printed in its own email, every priced line is
classified food / beverage / non-food with nothing unresolved, and the
classification is cross-validated against Sysco's own product taxonomy
(`sysco-food-vs-nonfood.md`). Nothing was dropped and nothing is unattributed.

Data: `data/cache/sysco/backfill_orders.csv` (per order),
`backfill_lines.csv` (per line), `backfill_classified.csv` (per line, bucketed),
`inline_order_lines.csv` (the 21 orders whose detail was read from the API
response rather than a spooled file).
Scripts: `parse_sysco_emails.py`, `classify_sysco_lines.py`.

## The trailing twelve months

**Aug 2025 – Jul 2026: $150,620.33 of Sysco purchases, averaging $12,551.69 a
month.**

| Bucket | Amount | Share |
| --- | --- | --- |
| **Food** | **$136,717.37** | **90.8%** |
| Beverage (non-alcoholic) | $3,211.34 | 2.1% |
| Non-food supplies | $10,511.09 | 7.0% |
| Shipping | $180.53 | 0.1% |
| **Total** | **$150,620.33** | |

The four buckets sum to the total exactly. **$136,717.37 is the verified Sysco
food numerator for the trailing twelve months**, measured rather than modeled.

**It may also be the whole food numerator.** An earlier version of this document
said it was not, because Shamrock is a second food vendor. That was wrong for
this window: every Shamrock order and delivery notice in the mailbox falls in
July 2025, and there is nothing after 28 July 2025 — so Shamrock does not
overlap Aug 2025 – Jul 2026 at all. See `shamrock-status.md`, which also records
the one open question against that conclusion.

### This revises $136,890.76, reported earlier

Two corrections, in opposite directions, netting **−$173.39**:

- **−$336.63.** Film PVC and aluminium foil rolls were being counted as food.
  The keyword `'foil roll'` never matched, because the real descriptions read
  *Foil Aluminum **Roll** Standard Weight*, and `roll` alone means bread. Found
  by cross-checking against Sysco's own category taxonomy, not by the rules.
- **+$163.24.** Two orders had a verified total but no captured line detail —
  #04338463 (21 Jan, $36.90) and #04735930 (25 Jul, $260.77). Both have now
  been read. The earlier report folded their $297.67 into a "shipping" line of
  $466.75, which conflated freight with unexamined spend. Real trailing-twelve
  shipping is **$180.53**.

## Every month

| Month | Orders | Total | Per day | Food | Food % |
| --- | --- | --- | --- | --- | --- |
| Jul 2026 | 10 | $17,179.68 | $554.18 | $16,562.98 | 96.4% |
| Jun 2026 | 12 | $25,982.63 | $866.09 | $24,431.11 | 94.0% |
| May 2026 | 16 | $14,518.47 | $468.34 | $12,578.19 | 86.6% |
| Apr 2026 | 9 | $7,662.13 | $255.40 | $6,211.46 | 81.1% |
| Mar 2026 | 12 | $12,912.36 | $416.53 | $11,963.63 | 92.7% |
| Feb 2026 | 12 | $7,650.82 | $273.24 | $7,117.32 | 93.0% |
| Jan 2026 | 10 | $10,488.58 | $338.34 | $9,599.42 | 91.5% |
| Dec 2025 | 7 | $7,530.82 | $242.93 | $5,957.17 | 79.1% |
| Nov 2025 | 5 | $5,216.74 | $173.89 | $4,514.57 | 86.5% |
| Oct 2025 | 7 | $10,341.26 | $333.59 | $8,877.24 | 85.8% |
| Sep 2025 | 7 | $10,211.21 | $340.37 | $9,504.18 | 93.1% |
| Aug 2025 | 8 | $20,925.63 | $675.02 | $19,400.10 | 92.7% |
| *Jul 2025* | *9* | *$25,062.73* | *$808.48* | *$22,647.72* | *90.4%* |
| *May 2025* | *1* | *$2,302.27* | — | *$2,147.63* | *93.3%* |

Italic months sit outside the trailing twelve. Food % is food against the
month's full order total, so shipping sits in the denominator — the same basis
throughout.

## Two full summers, and they are not the same

The single most useful thing the full backfill adds is a **second summer** to
compare against. The read changed three times on partial data; here is what it
looks like complete.

- **Jul 2025: $808/day. Jul 2026: $554/day.** Last July ran 46% hotter than this
  July on Sysco alone — and **at least 64% hotter** once July 2025's verified
  Shamrock deliveries are added, which have no 2026 counterpart
  (`shamrock-status.md`). Every figure in the table below is Sysco only.
- **Jun 2026 ($866/day) is the highest month in the record**, but Jul 2025 is
  close behind, so June 2026 is a summer peak rather than a freak event. The
  earlier reading of June as an unexplained anomaly was an artifact of having
  only spring months to compare it against.
- **November 2025 is the true trough at $173.89/day** — lower than April 2026's
  $255. The seasonal swing across the full record is **5.0×**, not 3.4×.

Do not read Jul 2025 as a clean baseline. That month and August carry kitchen
outfitting — a blender container, a Robot Coupe blade, polycarbonate pans, a
grill scraper — items that appear nowhere in 2026. July 2025 non-food was
$2,391 against July 2026's $199.

## The gap between 21 May and 2 Jul 2025

One order on 21 May 2025, then nothing until 2 Jul 2025. Six weeks with no
Sysco order email at all. This is either the pre-opening period, a change in how
ordering was placed, or a genuine hole in the email record. It matters only for
periods before the trailing twelve months, but it is worth knowing which before
anyone builds a two-year comparison on this data.

## Non-food is lumpy, and that distorts any single month

Supplies are bought in batches, not in proportion to food volume. Across the
full record the non-food share of a month runs from **1.2% (Jul 2026) to 13.5%
(Apr 2026)** — an 11× spread. A food cost computed from one month uses a
numerator with either almost no supplies stripped out or an eighth of it, which
is a third independent reason not to compute food cost from a single month,
alongside the 5× seasonal swing and the unresolved event-revenue question.

An earlier draft put this range at 0.6%–20.7%. Both ends were wrong: the low end
predated the two recovered orders, and the high end (Dec 2025) had beverage
folded in with supplies. The corrected spread is narrower but the conclusion is
unchanged.

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
  a Sysco AR statement — see below for why one has not turned up.
- **Shamrock is a second food vendor**, but only in July 2025 — outside this
  window. `shamrock-status.md`.
- **No liquor or beer vendor data exists at all.**

## Why the Sysco AR statement has not turned up

It is not in this mailbox, and the three Drive files named "purchase history"
are not it either. All three — `SYSCO PURCHASE HISTORY.csv`,
`Shop_Purchase History_059_075356.csv` and `Sysco_Purchase_History_Raw_Data.csv`
— are **order-guide exports**: SUPC, pack, brand, description, category and
current case price for 410–441 products. They carry no dates, no invoice
numbers, no quantities and no amounts purchased. "Purchase History" is simply
what Sysco Shop calls that export. They are useless as a transaction record and
excellent as a product taxonomy, which is what they are now used for.

The likely reason is an **account split**: this mailbox is `sburdges@gmail.com`,
Sean's personal address, and the business address is `seanblariat@gmail.com`.
The only `toasttab.com` mail here is Sean's own takeout receipts from 2019–2023,
and searches for the major Colorado beverage wholesalers return nothing. Vendor
statements, Toast reports and liquor invoices are most likely all sitting in the
business mailbox, which no tool in this session can read.
