# Sysco order-email backfill — coverage and findings

Working backwards from July 2026. A month is **complete** only when every order
email in that month has been read and reconciled. Partial months are marked
do-not-use, because sampling a subset of orders is what produced the withdrawn
28% estimate.

Data: `data/cache/sysco/backfill_orders.csv` (per order),
`data/cache/sysco/backfill_lines.csv` (1,041 line items).
Parser: `scripts/parse_sysco_emails.py`. Every order ties to the total printed in
its own email; none were dropped.

## Coverage

| Month | Status | Orders | Total | Per day |
| --- | --- | --- | --- | --- |
| Jul 2026 | **complete** | 10 | $17,179.68 | $554.18 |
| Jun 2026 | **complete** | 12 | $25,982.63 | $866.09 |
| May 2026 | **complete** | 16 | $14,518.47 | $468.34 |
| Apr 2026 | **complete** | 9 | $7,662.13 | $255.40 |
| Mar 2026 | **complete** | 12 | $12,912.36 | $416.53 |
| Feb 2026 | **complete** | 12 | $7,650.82 | $273.24 |
| **Feb–Jul 2026** | **6 months** | **71** | **$85,906.09** | **$474.62** |
| Jan 2026 | partial (3 of 9 threads) | 3 | $2,626.58 | **do not use** |
| Dec 2025 and earlier | not started | | | |

## The shape is seasonal, and it is steep

Six months in, the read has changed twice. July looked hot against a single
winter baseline; then June looked like the outlier. With half a year:

- **April is the trough at $255/day** — *below* February. Mud season in Buena
  Vista, and it shows in the purchase record.
- **June is the peak at $866/day** — 3.4× April, 56% above July.
- The Feb–Jul average is **$474.62/day**.

June is still anomalous even allowing for seasonality: May ($468) and July
($554) sit either side of it, so June is not simply "summer." Something specific
happened in June. Event load remains the obvious candidate and is still
unproven — event food rides on these same invoices, which is why the Toast
export has to establish where event revenue sits before any percentage is
computed.

**Do not annualize any single month.** The spread runs 3.4× from trough to peak.

## A cross-check that partly answers the AR-statement question

The verified invoice-PDF figure for 26 Feb – 26 Mar 2026 is **$10,811.61**. The
order emails give $7,650.82 for all of February and $12,912.36 for all of March
— so that window lands in the same ballpark as the invoice total.

This is reassuring but not conclusive: the two sources are on different bases
(order emails exclude tax and include shipping; the PDFs are the reverse) and
the windows do not align. It is evidence *against* a large volume of deliveries
with no order email at all, in that window. It is not proof, and it does not
replace the Sysco AR statement.

## Order attribution — carry these forward

**Multi-order emails are common and they defeat the obvious reconciliation
check.** Several emails cover two or three orders under a single printed grand
total. A parser that stamps every line with the email's first order number
*still ties to the printed total exactly* — the error is invisible at the check.
The `.item-seller` heading is the real per-order delimiter and carries both
number and seller: `Order #04675097 (Sysco Standard Delivery)`,
`Order #14380632 (Sold and Shipped by DON)`. **22 of 63 parsed orders came out
of multi-order emails.**

**Two email templates exist.** Emails before roughly March 2026 use an older
template (CRLF markup, order number in the `<title>` rather than the header).
The same selectors work on both — verified on order 04420381, 1 Mar, 1 line,
$94.22, exact.

**Marketplace orders are mixed into ordinary Sysco emails** and are not food:
`M`-prefixed hashes or 8 digits starting `14`, against `043…`–`047…` for Sysco
Standard Delivery. They are small — a few hundred dollars a month at most.

## Known gaps

- **Order-only emails.** The thread query filters to Confirmation / Allocated /
  Modified. A marketplace order that only produced a "Shipped" notice is missed.
  Non-food and immaterial to the food numerator.
- **Deliveries with no order email at all.** Partly addressed by the Feb–Mar
  cross-check above; still properly answered only by a Sysco AR statement.
- ~~Food vs non-food is not classified.~~ **Done** — see
  `docs/costing/sysco-food-vs-nonfood.md`. Measured across 1,020 priced lines:
  food 91.9%, beverage 1.7%, non-food 6.0%. That corrects the circulating
  94.8/2.9/2.3 split taken off a 117-line subset; **non-food supplies are 2.6×
  higher than assumed**, so the food numerator is smaller than it looked.
