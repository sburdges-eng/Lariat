# Shamrock — the second food vendor, and when it stopped

**Shamrock does not overlap the trailing twelve months.** Every Shamrock order,
delivery and cancellation notice in the mailbox falls in **July 2025**. There is
nothing after 28 July 2025.

That matters because `sysco-backfill-status.md` previously said the Sysco figure
"is not the whole food numerator — Shamrock is a second food vendor and is not
in this figure." On the evidence below, for **Aug 2025 – Jul 2026 there is
nothing of Shamrock's to add.**

## The evidence

| Date | Event | Detail |
| --- | --- | --- |
| 1 Jul 2025 | "Welcome to Shamrock Foods!" | Account #20001866, The Lariat |
| 3 Jul 2025 | Order arrived | 15 CS — **no line detail, no amounts** |
| 10 Jul 2025 | Order #8755532 cancelled | — |
| 11 Jul 2025 | Order arrived | 27 CS — **no line detail, no amounts** |
| 17 Jul 2025 | Order #8775342 delivered | 18 priced lines, $1,259.10 |
| 24 Jul 2025 | Order #8803185 delivered | 17 priced lines, $799.37 |
| 28 Jul 2025 | Order #8816293 delivered | 22 priced lines, $978.23 |
| Aug 2025 → | *(nothing)* | marketing email only |

Searching the mailbox for any Shamrock order, delivery, dispatch or invoice
notice after 1 Aug 2025 returns **zero results**. What does arrive after that
date is product marketing (Feb–Jun 2026) and two password-reset codes (18 Jan
2026, 9 Mar 2026) — someone logging in to the portal, not ordering through it.

**The absence is meaningful, not an artifact of the wrong mailbox.** The
Shamrock account is registered to `sburdges@gmail.com`: the welcome email, every
delivery notice and both password resets arrive here. This *is* the Shamrock
notification address. If orders were being placed, the notices would land here.

## What July 2025 was worth

**$3,036.70 verified** across the three deliveries that carry line detail.

Two of the five deliveries — 3 Jul (15 CS) and 11 Jul (27 CS) — arrived through
a different notification template that states only the case count. At the
roughly $50/case the priced orders run, those two plausibly add **$2,000–2,500**,
which would put July 2025 Shamrock near **$5,000–5,500**. *That last figure is
modeled, not measured.* Do not use it as a numerator.

### It widens the July-over-July gap

`sysco-backfill-status.md` reports July 2025 at $808/day against July 2026's
$554/day, on Sysco alone. Adding only the **verified** Shamrock lines:

| | Sysco | Shamrock | Total | Per day |
| --- | --- | --- | --- | --- |
| Jul 2025 | $25,062.73 | $3,036.70 | $28,099.43 | **$906.43** |
| Jul 2026 | $17,179.68 | — | $17,179.68 | **$554.18** |

Last July ran **64% hotter** than this July, not 46%. And that understates it,
because two Shamrock deliveries are still unpriced.

## Why this data is better than Sysco's, and still not final

Shamrock's delivery emails are stronger evidence than Sysco's order emails:
they print **Ordered / Invoiced / Received** per line, so the
ordered ≠ allocated ≠ billed trap is visible on the face of the email rather
than hidden. Order #8816293 shows it plainly — 21 items ordered, 20 invoiced;
2 CS of 1% milk ordered, 0 invoiced, 0 received, $0.00.

But each one carries the footer *"Pricing is subject to change until the final
invoice is issued."* These are delivery confirmations, not invoices. Treat
$3,036.70 as verified-as-delivered, not verified-as-billed.

## Open question worth resolving

Sean's note said "no sham after march", which implies Shamrock activity running
into 2026. The mailbox says ordering stopped at the end of July 2025. Two
separate artefacts also point past July 2025:

- `the-lariat-purchase-history-past-455.pdf` — a Shamrock purchase history dated
  11 Jan 2026, covering 15 months.
- A Shamrock invoice table in this repo (`scripts/backfill-shamrock-invoice-skus.mjs`,
  115 SKUs).

These are not reconciled against each other here. Either Shamrock deliveries
continued and produced no email at all, or the relationship genuinely ended in
July 2025 and those artefacts describe it retrospectively. **Until that is
settled, treat "Sysco is the only food vendor in the trailing twelve months" as
well-evidenced but not proven.**

## Not found: any liquor or beer vendor

Searched by wholesaler domain (RNDC, Southern Glazer's, Breakthru, High Country
Beverage, Elite Brands, SGWS) and by subject. **Nothing.** No distributor mail
of any kind reaches this address.

The photos are a dead end too. The 15 `IMG_53xx` files in Drive from 29 Jun 2026
are all **zero bytes** — including a `.mov` — and return empty content. The two
promising self-sent emails, subjects `sysco` (5.75 MB) and `shamrock` (587 KB),
turned out to be bundles of forwarded `.eml` notification emails rather than
photographs of receipts. The Sysco bundle holds ten order emails already in the
backfill; the Shamrock bundle is the source for the July 2025 figures above.

**Liquor is 35.6% of net sales and there is still no vendor data for it.**
