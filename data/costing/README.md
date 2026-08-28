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
| `backfill_orders.csv` | One row per order. Carries the total printed in the email, the parsed line sum, and the residual, so every order can be re-checked against its own source. |
| `backfill_lines.csv` | One row per line item, as parsed. The unclassified source of truth. |
| `backfill_classified.csv` | `backfill_lines.csv` plus a `bucket` column (food / beverage / non_food). Regenerable from the line file by `scripts/classify_sysco_lines.py`. |
| `inline_order_lines.csv` | Lines for the orders whose detail came back inline from the API rather than in a spooled file, and so were transcribed by hand. The `note` column records the provenance of each. |
| `july_2026_orders.csv` | The first verified month, kept as the worked example the method was built on. |

**Keep `backfill_lines.csv` even though it looks redundant.** It is ~95% the
same bytes as `backfill_classified.csv`, but holding the pre-classification
source is what lets the classifier be re-run and audited independently. If the
food numerator is ever challenged, that file is what you re-derive from.

Coverage, provenance, the parsing traps and the known gaps are all in
`docs/costing/sysco-backfill-status.md`.
