# data/costing — measured vendor purchase records

Verified purchase data, kept because it is **expensive to reproduce**, not
because it is convenient to have here.

This is deliberately *not* `data/cache/`. That directory is documented in
`.gitignore` as "Ingest cache (regenerable from source)" — delete it and a
script rebuilds it. These files are not like that. Rebuilding
`sysco/backfill_*.csv` means re-reading roughly 200 Gmail threads through a
connector that a future session may not have, and every figure in
`docs/costing/` traces back to them.

## sysco/

| File | What it is |
| --- | --- |
| `backfill_orders.csv` | One row per order, 127 of them. Carries the total printed in the email, the parsed line sum, and the residual, so every order can be re-checked against its own source. A multi-order email gets one row per order: `line_sum` is that order's own lines, while `email_*` describe the shared email, so the email-level fields repeat across its rows. |
| `backfill_lines.csv` | One row per line item, as parsed. The unclassified source of truth. |
| `backfill_classified.csv` | The two line files above plus a `bucket` column (food / beverage / non_food). Regenerable — but **only by passing both line files**; see below. |
| `inline_order_lines.csv` | Lines for the orders whose detail came back inline from the API rather than in a spooled file, and so were transcribed by hand. The `note` column records the provenance of each. |
| `july_2026_orders.csv` | The first verified month, kept as the worked example the method was built on. |

**Keep `backfill_lines.csv` even though it looks redundant.** It is ~95% the
same bytes as `backfill_classified.csv`, but holding the pre-classification
source is what lets the classifier be re-run and audited independently. If the
food numerator is ever challenged, that file is what you re-derive from.

## Regenerating the classified file — pass both line files

The line detail lives in two files, so the classifier takes both:

```
python scripts/classify_sysco_lines.py \
    data/costing/sysco/backfill_lines.csv \
    data/costing/sysco/inline_order_lines.csv \
    -o data/costing/sysco/backfill_classified.csv
```

**Passing only `backfill_lines.csv` silently drops 32 lines worth $2,487.89** and
writes a 1,899-line file that classifies cleanly and looks complete — the
numerator is just quietly too small. The run prints its input counts to stderr
for exactly this reason; the priced-line total must read **1,931**.

Coverage, provenance, the parsing traps and the known gaps are all in
`docs/costing/sysco-backfill-status.md`.
