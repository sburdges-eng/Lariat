# Handoff — apply 4 review fixes on `feat/receiving-master-contract` (PR #268)

**For:** the session that owns `feat/receiving-master-contract` (checked out at
`Lariat-worktrees/codex-receiving-master-contract`).
**Why a handoff, not a direct edit:** that branch is live in a separate worktree;
editing it from another checkout would collide. Apply these there, as **separate
commits** (one per fix), then re-request review.

The reviewed files only have content on this branch (they're 0-byte placeholders
on `main`). Line numbers below are from the PR-#268 revision.

---

## Fix 1 — `app/prep/page.jsx`: await `searchParams` (Next 16 async)

**Issue (P2):** `searchParams` is a Promise in this Next 16 app-router setup. The
synchronous read makes `location` resolve `undefined`, so `/prep?location=bar`
silently falls back to `DEFAULT_LOCATION_ID` and renders the **wrong kitchen's**
board — and passes `locationId="default"` into client mutations.

**Change:** make the component `async` and await `searchParams` first.

```jsx
export default async function PrepPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  // …unchanged below…
```

---

## Fix 2 — `app/costing/price-shocks/page.jsx`: await `searchParams`

**Issue (P2):** same async-`searchParams` bug; `location`, `days`, `minPct` all
resolve from `undefined`, so the Window/Threshold links keep rendering the default
7-day / 5% report and non-default locations show default-location data.

**Change:**

```jsx
export default async function PriceShocksPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const days = clampInt(sp.days, 7, 1, 90);
  const minPct = clampNum(sp.minPct, 5, 0, 1000);
  // …unchanged below…
```

---

## Fix 3 — price-shock calc must include **live** vendor prices

**Issue (P2):** `listPriceShocks` (in `lib/vendorPricesRepo.ts`) reads
`vendor_prices_history` only. The costing ingest snapshots the *old* row into
`vendor_prices_history` **before** deleting/reinserting the new current price into
`vendor_prices`. So immediately after an ingest the latest price exists only in
`vendor_prices` — a real move is invisible (or one ingest behind) until the next
ingest snapshots it.

**Change:** in `listPriceShocks`, compare the window baseline (from
`vendor_prices_history`) against the **current** `vendor_prices` row for each SKU
(or snapshot the current row into the comparison set) so the latest move is
counted. Add a unit test that ingests a price change and asserts the shock is
visible *before* the next history snapshot. Touch the shock query only — leave the
dish/recipe join in the page unchanged.

---

## Fix 4 — `app/prep/PrepBoard.jsx`: `Suggested.addAsTask` swallows fetch errors

**Issue (medium):** `addAsTask` (~line 289) does `await fetch('/api/prep-tasks', …)`
without capturing or checking the response, then runs `setBusyKey(null)` +
`router.refresh()` as if it succeeded. On a non-2xx the suggested item reappears on
refresh and the cook gets no feedback — inconsistent with `patch()` (lines 64–82)
and `AddTaskForm.submit()`, which both check `res.ok` and `setErr(...)`.

**Change:** capture the response, check `res.ok`, surface an error, and skip the
refresh on failure. `Suggested` has no `setErr` today — add local error state (or
accept a setter prop) and render it, mirroring the parent's error display.

```jsx
function Suggested({ rows, stations, cookId, date, locationId }) {
  const [busyKey, setBusyKey] = useState(null);
  const [err, setErr] = useState('');
  // …
  const addAsTask = async (row) => {
    const ingredient = row.ingredient;
    setBusyKey(ingredient);
    setErr('');
    try {
      // …build body…
      const res = await fetch('/api/prep-tasks', { method: 'POST', /* … */ });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Could not add task — try again.');
        setBusyKey(null);
        return;
      }
      setBusyKey(null);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusyKey(null);
    }
  };
  // render {err && <…error banner…>} near the suggested list
}
```

(Cursor Bugbot prepared an autofix for this one — `@cursor push 0649d38006` /
"Create PR" — which can be used instead of hand-editing if preferred.)

---

## Suggested commit sequence (on `feat/receiving-master-contract`)

1. `fix(prep): await searchParams in /prep server page (#268)`
2. `fix(costing): await searchParams in /costing/price-shocks (#268)`
3. `fix(costing): include live vendor_prices in price-shock calc (#268)` + test
4. `fix(prep): surface server errors in Suggested.addAsTask (#268)`

Run `npm run verify` before re-requesting review.
