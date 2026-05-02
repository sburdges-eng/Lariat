# Breaker Audit Finding

**Subsystem:** UI / money formatting (Section 7)

**Invariant:** `BREAKER_AUDIT.md §2` Section 7 row: "cents always shown via the same formatter; never `Math.round(x*100)/100`-style float drift". The doc claim implies (a) one canonical formatter, used (b) consistently across surfaces, (c) handling negatives + nulls + currency symbol uniformly.

**Break attempt:** Open the dollars-displaying pages side-by-side and compare formatting:

| Surface | Pattern | Decimals | Sign on negatives |
|---|---|---|---|
| `app/playbook/tabs/TicketsTab.jsx:7` | `$${Number(show.price).toFixed(2)}` | 2 | `$-12.34` |
| `app/costing/page.jsx:181` | `$${v.variance_amount.toFixed(2)} vs $${v.theoretical_cogs.toFixed(2)}` | 2 | `$-12.34` |
| `app/costing/depletion-exceptions/page.jsx:27` | `$${Number(n).toFixed(2)}` | 2 | `$-12.34` |
| `app/costing/pack-changes/page.jsx:29` | `$${Number(n).toFixed(2)}` | 2 | `$-12.34` |
| `app/purchasing/page.jsx:49` | `$${Number(r.unit_price).toFixed(2)}` | 2 | `$-12.34` |
| `app/specials/saved/[id]/SpecialDetailClient.jsx:140` | `$${special.cost_total.toFixed(2)}` | 2 | `$-12.34` (and **no `Number()` coerce** — throws if value is a string) |
| `app/costing/prices/[vendor]/[sku]/page.jsx:21` | `$${Number(n).toFixed(4)}` | **4** | inconsistent with the 2-decimal pages |
| `app/costing/price-shocks/page.jsx:39` | `$${Number(n).toFixed(4)}` | **4** | inconsistent |

**Observed result:**
- **No canonical helper.** `grep "formatMoney\|formatCents\|formatCurrency" lib/` returns zero matches; same in `app/`.
- **8+ inline patterns** across 6+ surfaces. Each page hand-rolls its own.
- **Inconsistent decimal precision** — 6 surfaces use 2 decimals, 2 surfaces use 4. A manager comparing costing tile (2 dp) vs price-shocks page (4 dp) sees the same vendor row priced differently.
- **Inconsistent currency-symbol-on-negative behavior** — every surface produces `$-12.34` (symbol before sign), which is unreadable. Plain English convention is `-$12.34`.
- **One surface skips the `Number()` coerce** — `SpecialDetailClient.jsx:140` calls `.toFixed(2)` directly on `special.cost_total`. If a future API change returns the value as a string (`"12.34"`), `.toFixed` is undefined on strings and the render throws.
- **Null handling is each-surface's job** — some pages do `n == null ? '—' : ...`, others rely on the value never being null. The fallback character varies (`'—'`, `'-'`, blank string).

**Expected result:** A single `lib/formatMoney.ts` exporting:

```ts
/** Format integer cents into "$1,234.56" / "-$1,234.56" / "—" for null. */
export function formatMoney(cents: number | null | undefined, opts?: { decimals?: 2 | 4; nullDisplay?: string }): string;
```

Used everywhere a dollar sign is rendered. Forced through prettier/eslint rule (or a one-line grep test) so future inline `.toFixed(2)` regressions can't sneak in.

**Risk:** P2. User-facing inconsistency on a regulated number. A manager reading "variance $12.34" on `/costing` and "variance $12.3456" on `/costing/price-shocks` for the same vendor row gets confused. The `cost_total.toFixed(2)` crash path on a string-typed value is a runtime hazard with no test coverage.

**Repro command:**
```bash
# 1. Confirm zero canonical helper:
grep -rn "formatMoney\|formatCents\|formatCurrency" lib/ app/
# 2. Catalogue the inline patterns:
grep -rn "\\\$\\\$\\{[^}]*toFixed" app/ --include="*.jsx" --include="*.tsx"
```

**Likely files:**
- New: `lib/formatMoney.ts` — canonical helper.
- All 8+ inline call sites listed above.
- New: `tests/js/test-format-money.mjs` — pin negative formatting + null fallback + integer cents → display contract.

**Fix class:** logic + new helper module + test (a `dedupe` refactor per `REFACTOR_GOVERNANCE.md` once the helper exists)

**Priority:** **P2** — user-visible inconsistency on regulated numbers, plus one runtime crash path on string-typed values.

---

## Optional notes

- The 4-decimal surfaces (`prices/[vendor]/[sku]` and `price-shocks`) are the ones most likely to be intentional — vendor unit-price often needs sub-cent precision (e.g. $0.0234 per gram). The fix should preserve that with an opt-in `{ decimals: 4 }` flag, not force everything to 2.
- Adjacent thing noticed but NOT this finding: `app/costing/price-shocks/page.jsx:34` and `app/costing/_components/VarianceTrend.jsx:9` both have their own pct-formatter (`+1.2%` / `-1.2%`) with custom sign handling. Same `dedupe` shape; could share a `formatPct(n, decimals)` helper.
- Adjacent #2: 7 JSX surfaces render raw `err.message` from network errors directly to the user (e.g., `setError(err.message)` in `app/management/audit-log/page.jsx:61`, settlement DealEditor, BoxOfficeBoard, StageBoard, SoundBoard, RecipeEditForm). The backend message ("Failed to load …") may pass; the network message ("NetworkError when attempting to fetch resource") fails the kitchen-language rule. `RecipeEditForm.jsx:82` falls back to "An error occurred while saving" — exactly the phrase UI_COPY_RULES.md §AVOID lists. Worth a separate P3 finding eventually.
