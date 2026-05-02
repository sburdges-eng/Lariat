# Breaker Audit Finding

**Subsystem:** UI copy (Section 7)

**Invariant:** `docs/UI_COPY_RULES.md` is binding for every user-facing surface. The §AVOID list explicitly bans the phrases `error occurred` and `validation failed`. The §USE KITCHEN TERMS list says "kitchen-native wording … Sound like a kitchen manager talking clearly, not a software company." Raw error messages from HTTP libraries and SQL drivers are software-company language by definition.

**Break attempt:** Trigger a network failure on each of these surfaces (e.g., disconnect the iPad mid-save). What does the user see?

| Surface | Source | Result |
|---|---|---|
| `app/recipes/[slug]/edit/RecipeEditForm.jsx:82` | `setError(err.message \|\| 'An error occurred while saving')` | Either the raw HTTP error OR the **literally banned phrase** "An error occurred while saving" |
| `app/management/audit-log/page.jsx:61` | `setError(err.message)` | Raw error, e.g. "NetworkError when attempting to fetch resource." |
| `app/shows/[id]/settlement/_components/DealEditor.jsx:107` | `setError(err.message)` | Raw error |
| `app/shows/[id]/box-office/BoxOfficeBoard.jsx:85,104` | `setError(err.message)` | Raw error |
| `app/shows/[id]/stage/StageBoard.jsx:80` | `setSaveState({ status: 'error', error: err.message })` | Raw error |
| `app/shows/[id]/sound/SoundBoard.jsx:112` | `setSaveState({ status: 'error', error: err.message, savedAt: null })` | Raw error |

**Observed result:** Seven user-facing surfaces render whatever string the network/SQL/runtime layer produces. Concrete examples a cook on the line could see:
- "NetworkError when attempting to fetch resource."
- "TypeError: Failed to fetch"
- "An error occurred while saving" (banned phrase, line 82 of RecipeEditForm — the only one with a fallback string, and the fallback uses an explicitly forbidden phrase)
- "TypeError: Cannot read properties of undefined (reading 'forEach')"

**Expected result:** Kitchen-language fallback ("Lost connection. Try again." or "Did not save. Try again.") with the raw message available to console.error for debug. Pattern from `app/gold-stars/GoldStarBoard.tsx:147` ("Lost connection. Try again.") is the right reference.

**Risk:** P3. Cooks see software-company language at the worst possible moment (mid-shift, mid-error). Doesn't lose data, doesn't break workflow — just degrades trust and breaks the doctrine UI_COPY_RULES.md was written to enforce.

**Repro command:**
```bash
# Surfaces showing raw err.message:
grep -rn "setError(err\.message\|setSaveState.*err\.message" app/ --include="*.jsx" --include="*.tsx"
# The banned-phrase fallback:
grep -rn "An error occurred" app/ --include="*.jsx" --include="*.tsx"
```

**Likely files:**
- All 7 surfaces listed above.
- Optionally: a `lib/userError.ts` exporting `humanize(err)` that maps `TypeError`/`NetworkError`/etc. to kitchen-language strings, with the original error logged via `console.error`.

**Fix class:** UI

**Priority:** **P3** — copy-rule drift; not data-loss; not blocking.

---

## Optional notes

- `app/gold-stars/GoldStarBoard.tsx:147` is the reference pattern — it catches network failure separately and shows "Lost connection. Try again." instead of `err.message`. Cookify the seven outliers to match.
- Pairs naturally with the §7 P2 finding (no canonical money formatter): both are "drift away from a doctrine that was correctly written but unenforced".
- Adjacent thing noticed but NOT this finding: the gold-stars-error pattern uses `submitError` for the state name. UI_COPY_RULES.md §CODE RULE explicitly permits this ("Internal variable/class names may remain technical and structured"). The displayed text is the only constraint.
