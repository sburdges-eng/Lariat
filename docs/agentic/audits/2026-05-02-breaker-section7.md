# Breaker Audit — 2026-05-02 — Section 7

**Section covered:** 7 — UI copy + money formatting.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** stale at session start; not blocking for grep-driven UI audit.

---

## Method

Applied the doc-vs-code drift prong against `docs/UI_COPY_RULES.md` first:

1. Extracted every banned word + phrase from §AVOID SOFTWARE TERMS.
2. Extracted the canonical replacements from §PREFERRED REPLACEMENTS.
3. Extracted the implicit money-formatter doctrine from `BREAKER_AUDIT.md §2` Section 7 row.

Then grep-walked every `.jsx` / `.tsx` under `app/` for:
- visible-text uses of banned words (excluding HTML `type="submit"` attributes and internal handler names per §CODE RULE)
- inline `.toFixed(...)` patterns
- raw `err.message` rendered to the user
- canonical formatter helper presence (`formatMoney`/`formatCents`/`formatCurrency`)

---

## Doc-vs-code drift verification

| Doc claim | Verified? |
|---|---|
| Banned words ("submit", "dashboard", "configure", etc.) absent from visible JSX text | ✓ All hits are internal handler names or HTML `type="submit"` attributes — both explicitly permitted per §CODE RULE. The one comment hit (`app/costing/page.jsx:196`: "every queue is one click from the dashboard") is a code comment, not user-facing. |
| Cents always shown via the same formatter | ✗ — **no canonical helper exists**; 8+ inline patterns across 6+ surfaces with 2/4 decimal-count drift. (Finding #1.) |
| No raw error JSON shown to users | ✗ — 7 surfaces render `err.message` directly; one falls back to the banned phrase "An error occurred while saving". (Finding #2.) |
| Replacement words (dashboard→home, submit→save, inventory→stock) used in visible labels | ✓ Spot checks of nav copy, button labels, alert text all use the kitchen-language replacements. The doctrine has been honored on the user-facing surface; the drift is in helper-function discipline (finding #1) and error-handling discipline (finding #2). |

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P2** | No canonical money formatter — 8+ inline `.toFixed(2)` / `.toFixed(4)` patterns across 6+ surfaces; decimal-count drift (2 vs 4); negative formatting `$-12.34` instead of `-$12.34`; one surface (`SpecialDetailClient.jsx:140`) skips `Number()` coerce → runtime crash on a string-typed value. [Full record](findings/2026-05-02-no-canonical-money-formatter.md). |
| 2 | **P3** | Seven user-facing surfaces render raw `err.message`; one (`RecipeEditForm.jsx:82`) falls back to the literally banned phrase "An error occurred while saving" from `docs/UI_COPY_RULES.md §AVOID`. [Full record](findings/2026-05-02-raw-error-messages-violate-ui-copy-rules.md). |

No P0 or P1 findings this pass.

---

## Verified-correct surfaces

- **Visible JSX text** — no banned words from `UI_COPY_RULES.md §AVOID` appear in visible text (modal headings, button labels, alert copy, page titles). The doctrine has been honored on the user-facing string surface.
- **`app/gold-stars/GoldStarBoard.tsx:147`** — catches network failure separately and shows "Lost connection. Try again." This is the reference pattern the seven outliers in finding #2 should match.
- **Internal handler / state names** (`submit`, `setSubmitError`, `submitSave`, `submitExport`, etc.) are explicitly permitted per `UI_COPY_RULES.md §CODE RULE` ("Internal variable/class names may remain technical and structured"). The §AVOID list is for visible copy only. None of the internal-name hits is a violation.
- **`type="submit"` HTML attribute** — not user-visible; skipped from the audit.
- **PR #96 management rollup tile** post-merge — verified the UI-copy fixes (subtitle replacement, tile label rewrites) actually landed; no leftover "rollup" / "dashboard" jargon visible.

---

## Test gaps surfaced

- **No `tests/js/test-format-money.mjs`** because the helper doesn't exist. Pair with finding #1's fix.
- **No `tests/js/test-ui-copy-rules.mjs`** that greps the visible JSX corpus for banned words. Would close the loop on the doctrine — when a future surface accidentally writes a `<button>Submit</button>`, the test fails. Cheap to add; high leverage for a static-text rule.
- The `humanize(err)` helper proposed for finding #2 doesn't have a test seam either — would need to be its own pair.

---

## Recommended next moves

1. **Fix finding #1** — single PR adds `lib/formatMoney.ts` + `tests/js/test-format-money.mjs` + replaces the 8+ inline call sites. ~80 lines total. The 4-decimal surfaces should keep their precision via an opt-in `{ decimals: 4 }` flag on the helper.
2. **Fix finding #2** — single PR adds `lib/userError.ts::humanize(err)` + replaces the 7 inline `err.message` renders + paired test. The `gold-stars/GoldStarBoard.tsx:147` "Lost connection. Try again." is the reference string.
3. **Section 8 (offline / PWA / e2e)** — last section. Mostly verifies test-suite coverage of the regulated invariants the prior 7 sections found. Lower expected finding density; high leverage as a closing sweep.
4. **Optional: a `tests/js/test-ui-copy-rules.mjs`** that greps the visible JSX corpus for `UI_COPY_RULES.md §AVOID` words. Would prevent regression as new surfaces ship.

---

## Stop conditions hit

None.

---

## Workflow notes

- The "doc-vs-code drift" prong fired again — UI_COPY_RULES.md is unusually rich (preferred-replacements table, banned-words list, design rules), which made the drift verification fast: just walk the lists. Same shape that worked for §6 (KA / Data Pack docs).
- §6 + §7 had the SAME audit posture: doctrine correctly written; drift is in helper-function discipline (no canonical formatter, no `humanize(err)` helper) rather than in the surfaces themselves. That's a structural signal — Lariat has the right rules, but the rules aren't enforced by code (eslint rule, paired test, grep-driven CI). The next workflow tweak might be a lint-rule prong: "Does the doctrine have automated enforcement, or only README enforcement?"
