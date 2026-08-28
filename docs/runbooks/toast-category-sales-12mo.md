# Runbook — pull 12 months of sales by category from Toast

**Why:** the food cost percentage has a measured numerator and a guessed
denominator. Food sales for the trailing 12 months are currently **modeled at
$388,177**, derived by applying a three-year average food share (35.49%) to
verified net sales of $1,093,748.36. That share is almost certainly stale: the
events business grew about 40%, event food rides on the same vendor invoices,
and event revenue lands partly in service fees rather than food sales.

Until this export replaces the modeled number, **no food cost percentage should
be quoted.** Two of the three previous estimates were wrong, and both were wrong
on the denominator side.

**Blocked on:** a human with Toast Web access. There are no Toast credentials in
the analysis environment and Toast sends no report emails to the account.

## Where the Toast data is not

Searched and ruled out, so nobody repeats it:

- **`sburdges@gmail.com`.** The only `toasttab.com` mail in this mailbox is
  Sean's own personal takeout receipts from other restaurants — Moonlight Pizza
  (2023), Stoner's Pizza (2020), HomeSlice (2019). Nothing from The Lariat's own
  Toast account, in any direction, ever.
- **Google Drive.** The only Toast artefact is
  `TOAST_POS_INTEGRATION_GUIDE.md` — a document about integrating, not any
  exported data. No sales export, no category summary, no report.

**The likely reason is an account split.** The business address is
`seanblariat@gmail.com`; this session is authenticated to Sean's personal
`sburdges@gmail.com`. Only three files are shared between the two accounts and
none is sales data. Toast reports, if any are emailed at all, are most likely in
the business mailbox — which no tool in this session can read.

**So the fastest unblock is probably not any of the options below.** It is either
signing in to Toast Web directly (Option A) or checking `seanblariat@gmail.com`
for a Toast report subscription that already exists.

---

## Option A — Toast Web export (fastest)

Toast Web → **Reports → Sales → Sales Category Summary**.

1. Set the date range to the trailing 12 months (a full 12 calendar months
   ending with the last *complete* month — do not include a partial month).
2. Set **Group by: Month**.
3. Export to CSV.

The report must break out, at minimum, these categories separately:

- **Food**
- **Liquor**
- **Beer**
- **Wine**
- **Non-alcoholic beverage** (N/A Bev)
- **Retail / merchandise**, if any

If the export lumps all alcohol into one "Bar" line, that is still usable —
liquor/beer/wine split is a nice-to-have, food-vs-everything-else is the
requirement.

### Columns needed

```
Month,Category,Net Sales
```

- **Month** — `YYYY-MM`.
- **Category** — the Toast sales category name, verbatim. Do not rename.
- **Net Sales** — dollars, no `$`, no thousands separators.

Save it as `data/originals/toast_category_sales_12mo.csv`.

---

## Option B — Toast AI assistant (if the report is hard to find)

> I need **net sales broken out by sales category, by month, for the last 12
> complete calendar months**. One row per category per month. Please give me a
> single CSV with exactly these three columns in this order:
>
> ```
> Month,Category,Net Sales
> ```
>
> - **Month** — the calendar month as `YYYY-MM`.
> - **Category** — the sales category name exactly as it appears in Toast.
> - **Net Sales** — net sales dollars for that category in that month, number
>   only, no dollar sign or commas.
>
> Use **net** sales, not gross. Do not include tax, tips, or gratuity as
> categories. Do not include a grand-total row or per-month subtotal rows. If a
> category had no sales in a month, omit the row rather than sending a zero.
>
> Separately, tell me how **event service charges** are recorded — whether they
> appear as a sales category, as a service charge outside category sales, or
> both. I need to know whether event revenue is inside or outside these numbers.

---

## Option C — Toast API (already scaffolded)

`scripts/toast_api/` holds a working client. It needs four values in
`.env.local` (gitignored):

```
TOAST_API_HOST=ws-api.toasttab.com
TOAST_CLIENT_ID=<client id>
TOAST_CLIENT_SECRET=<client secret>
TOAST_RESTAURANT_GUID=<restaurant GUID>
```

Credentials come from Toast Web → Integrations → API access. See
`scripts/toast_api/README.md`. This is the durable path — it makes the pull
repeatable instead of a once-a-quarter manual chore — but it is the slowest to
set up, so do not let it block Option A.

---

## The one question the export must also answer

**Where does event revenue sit?**

This matters more than the category split itself. Current standards are a 20%
service fee, 8.15% tax on food plus fee, and an $8,000 event minimum (Rodeo
exempt). If the service fee is booked outside food sales, then event food is
inflating the vendor invoices (the numerator) while its revenue is partly
missing from food sales (the denominator) — which pushes the computed food cost
percentage up for a reason that has nothing to do with kitchen performance.

Get this answered before computing anything. If events turn out to be material
and mis-sided, food cost has to be computed twice: once for the restaurant and
once including events, because they are different businesses with different
cost structures.

---

## After the file lands

1. Confirm the 12 monthly totals sum to something close to the verified
   $1,093,748.36 net sales figure. They will not match exactly — that figure is
   the 12 months to 1 Apr 2026 and this export ends on a different month — but
   an unexplained gap over a few percent means the export is measuring something
   other than net sales.
2. Replace the modeled $388,177 with the summed **Food** rows.
3. Only then compute food cost, and label it verified, citing this file.
