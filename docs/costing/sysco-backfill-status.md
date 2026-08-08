# Sysco order-email backfill — coverage and findings

Working backwards from July 2026. A month is listed as **complete** only when
every order email in that month has been read and reconciled; partial months are
not usable, because sampling a subset of orders is what produced the withdrawn
28% estimate.

Data: `data/cache/sysco/backfill_orders.csv` (per order),
`data/cache/sysco/backfill_lines.csv` (per line item).
Parser: `scripts/parse_sysco_emails.py`.

## Coverage

| Month | Status | Orders | Total | Note |
| --- | --- | --- | --- | --- |
| Jul 2026 | **complete** | 10 | $17,179.68 | |
| Jun 2026 | **complete** | 12 | $25,982.63 | includes $13.91 shipping |
| May 2026 | partial | 4 of ~15 threads | $6,107.61 | **do not use** |
| Apr 2026 and earlier | not started | | | |

## June is 51% heavier than July

This is the most significant thing the backfill has turned up so far, and it
runs opposite to the direction the earlier analysis was pointing.

- June 2026: $25,982.63 over 30 days = **$866.09/day**
- July 2026: $17,179.68 over 31 days = **$554.18/day**
- Feb 26 – Mar 26 (invoice PDFs): $10,811.61 over 28 days = $386.13/day

July is not the peak. June is, by a wide margin — and June is 124% above the
February–March run rate on a per-day basis, where July is 43% above it.

Do not read this as a trend from three points. Two things could produce it that
have nothing to do with kitchen performance:

1. **Events.** If June carried more or larger events than July, the food rides
   on these same invoices. This is exactly why the Toast export has to answer
   where event revenue sits before any percentage is computed.
2. **Basis.** The invoice-PDF figure excludes shipping and includes tax; the
   order-email figures exclude tax and include shipping. The three numbers are
   not on one basis and the February–March comparison in particular should be
   treated as indicative, not measured.

## Two order-attribution facts worth carrying forward

**Multi-order emails are common, and they defeat the obvious reconciliation
check.** The 21 Jun and 28 Jun emails each cover two orders under a single
printed grand total. A parser that stamps every line with the email's first
order number still ties to the printed total exactly — the error is invisible at
the check. The `.item-seller` heading is the real per-order delimiter, and it
carries both the number and the seller:
`Order #04675097 (Sysco Standard Delivery)`,
`Order #14380632 (Sold and Shipped by DON)`. Four of eighteen orders parsed so
far came out of multi-order emails.

**Marketplace orders are mixed into ordinary Sysco emails.** Order #14380632
inside the 21 Jun email is "Sold and Shipped by DON" — $77.26 of compostable
clamshells, not food, and it carries the $13.91 shipping charge. Marketplace
order numbers run 8 digits starting `14`, or an `M`-prefixed hash; Sysco
Standard Delivery orders run `046…`/`047…`.

## Known coverage gaps

- **Order-only emails.** The thread query filters to Confirmation / Allocated /
  Modified. A marketplace order that only ever produced a "Shipped" notice would
  be missed. Several `M`-prefixed shipments in July have no matching
  confirmation in the filtered set.
- **Deliveries with no order email at all.** Still the open question, and still
  answerable only by a Sysco AR statement or invoice history by date range.
- **Food vs non-food is not yet classified.** The line items are captured but
  not categorized. The 94.8% food figure in circulation was measured on a
  117-line subset and should not be applied to these months as-is.
