# Sysco order-email backfill — coverage and findings

Working backwards from July 2026. A month is listed as **complete** only when
every order email in that month has been read and reconciled; partial months are
not usable, because sampling a subset of orders is what produced the withdrawn
28% estimate.

Data: `data/cache/sysco/backfill_orders.csv` (per order),
`data/cache/sysco/backfill_lines.csv` (655 line items).
Parser: `scripts/parse_sysco_emails.py`. Every order ties to the total printed in
its own email; none were dropped.

## Coverage

| Month | Status | Orders | Line items | Shipping | Total | Per day |
| --- | --- | --- | --- | --- | --- | --- |
| Jul 2026 | **complete** | 10 | $17,179.68 | $0.00 | **$17,179.68** | $554.18 |
| Jun 2026 | **complete** | 12 | $25,968.72 | $13.91 | **$25,982.63** | $866.09 |
| May 2026 | **complete** | 16 | $14,485.10 | $33.37 | **$14,518.47** | $468.34 |
| **3 months** | | **38** | | | **$57,680.78** | **$626.97** |
| Apr 2026 and earlier | not started | | | | | |

## June is the outlier, not July

The earlier read of this data was that July was running hot. With three complete
months, that is wrong. **June is the peak, by a wide margin**, and July is much
closer to normal:

- June is **85% above May** and **56% above July** on a per-day basis.
- May, at $468/day, is only 21% above the Feb–Mar invoice run rate of $386/day.
- July at $554/day is 43% above it. June at $866/day is **124% above it**.

A single month at nearly double the neighbouring months is a signal about
*something*, but three points is not a trend and the cause is not in this data.
Two candidates, neither of which is kitchen performance:

1. **Events.** Event food rides on these same invoices. If June carried the
   heavier event load, that alone could account for it — and the revenue side of
   those events partly sits in service fees rather than food sales, which is
   precisely why the Toast export has to answer where event revenue lands before
   any percentage is computed.
2. **Basis.** Order-email totals exclude tax and include shipping; the invoice
   PDFs are the reverse. The comparison against Feb–Mar is indicative only.

**Do not annualize any of these months.** $626.97/day across the three is a
better planning figure than any single month, and even that is one quarter of a
seasonal business in a mountain town.

## Order attribution — two facts worth carrying forward

**Multi-order emails are common and they defeat the obvious reconciliation
check.** The 21 Jun and 28 Jun emails each cover two orders under a single
printed grand total. A parser that stamps every line with the email's first
order number *still ties to the printed total exactly* — the error is invisible
at the check. The `.item-seller` heading is the real per-order delimiter and
carries both number and seller: `Order #04675097 (Sysco Standard Delivery)`,
`Order #14380632 (Sold and Shipped by DON)`. **Nine of 38 orders came out of
multi-order emails.**

**Marketplace orders are mixed into ordinary Sysco emails** and are not food.
Across three months they total only $456.33:

| Order | Month | Amount |
| --- | --- | --- |
| M6c504942d4db | May | $95.11 |
| 14350664 | May | $283.96 |
| 14380632 | Jun | $77.26 |

Sysco Standard Delivery order numbers run `045…`–`047…`; marketplace runs 8
digits starting `14`, or an `M`-prefixed hash.

## Known coverage gaps

- **Order-only emails.** The thread query filters to Confirmation / Allocated /
  Modified. A marketplace order that only ever produced a "Shipped" notice would
  be missed. Several `M`-prefixed shipments in July have no matching
  confirmation in the filtered set. Given marketplace runs ~$150/month and is
  non-food, this does not affect the food numerator materially.
- **Deliveries with no order email at all.** Still the open question, and still
  answerable only by a Sysco AR statement or invoice history by date range.
- **Food vs non-food is not yet classified.** The 655 line items are captured
  with SUPC, description, brand and extended price, but not categorized. The
  94.8% food figure in circulation was measured on a 117-line subset and should
  not be applied to these months as-is. Classifying the 655 lines is now a
  desk job with no further fetching required.
