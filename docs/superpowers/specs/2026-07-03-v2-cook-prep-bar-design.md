---
title: "feat: v2 cook migration — Prep + Bar boards"
date: 2026-07-03
status: draft
feature_slug: v2-cook-prep-bar
origin: /spec-plan-tdd — "migrate the next set of cook-tier routes to /v2"
roadmap: 2.11 (cook-tier v2 route migration)
---

# v2 cook migration — Prep + Bar

## Goal

Bring two more cook-reachable v1 boards — `/prep` (daily prep board) and `/bar`
(pour-cost dashboard) — into the `/v2` preview tree using the same thin-wrapper
pattern already shipped for `/v2/today`, `/v2/kds/punch`, `/v2/eighty-six`, and
`/v2/stations`. Each new route wraps the **unchanged** v1 page in the branded v2
shell (i18n hero + jump-nav) so a cook running the v2 preview can reach prep and
bar work without bouncing back to the v1 cockpit. v1 stays the default and the
single source of truth; this is additive, preview-cookie-gated, and reversible.

## Non-goals

- No changes to the v1 pages (`app/prep/*`, `app/bar/*`) or their components.
- No bespoke v2 Prep/Bar UI — the v1 component renders verbatim inside the shell.
- No `basePath` threading into `PrepPage`. The v1 "Standing prep par →" link to
  `/prep/par` will stay a v1-absolute link (documented residual, see Open
  questions).
- No middleware / `SENSITIVE_PREFIXES` changes — both routes are cook-tier (no
  PIN) and must stay that way.
- No cutover, default-on, or rollout changes (governed by `docs/V2_CUTOVER_PLAN.md`).
- No touching the concurrent session's in-flight manager-tier v2 routes
  (`app/v2/{beo,booking,costing,host,menu-engineering,morning,playbook,purchasing,shows,specials}`).
  This work is scoped strictly to prep + bar. **Exception:** `navRegistry.js`
  must be edited (see below) — but only to *append* the two new exclusion
  entries; existing entries are left untouched.

## User-facing surface

Two new preview-gated routes, reachable only when the `lariat_v2=1` cookie is set
(gate is inherited from `app/v2/layout.jsx`):

### `/v2/prep` → `app/v2/prep/page.jsx`

```
V2PrepPage({ searchParams })
  - export const dynamic = 'force-dynamic'
  - const sp = (await searchParams) || {}
  - resolve locationId from sp.location, else DEFAULT_LOCATION_ID
  - locale = await getLocale(); m = getMessages(locale)
  - renders:
      <main>
        <section hero>  eyebrow/title/copy from t(m, 'shells.prep.*')
          jump-nav: [ Back to today → /v2/today ]
                    [ shells.prep.watch* → /v2/eighty-six ]
        <section shell>
          <PrepPage searchParams={sp} />   // v1 component, unchanged
```

Example: `/v2/prep?location=bar` → hero + the v1 prep board for the `bar`
location (suggested-prep + station-grouped tasks), inside the v2 shell.

### `/v2/bar` → `app/v2/bar/page.jsx`

```
V2BarPage({ searchParams })
  - identical structure; embeds <BarPage searchParams={sp} />
  - hero copy from t(m, 'shells.bar.*')
  - jump-nav: [ Back to today → /v2/today ] [ shells.bar.watch* → /v2/prep ]
```

Example: `/v2/bar` → hero + the v1 pour-cost table (per-pour cost %, red/yellow/
green margin flags) inside the v2 shell.

**Honesty note on `/bar`:** despite the name, `/bar` is a *pour-cost analytics
dashboard*, not a prep/build board. It is cook-*reachable* (not in
`SENSITIVE_PREFIXES`), so it migrates through the identical wrapper, but it reads
as a margin readout rather than a service action board. Included per user
decision (keep Bar). Prep is the unambiguous core cook board of the two.

### i18n copy — `lib/i18n/messages/{en,es}.ts`

New `shells.prep` and `shells.bar` blocks mirroring the existing `shells.stations`
shape (eyebrow / title / copy + one jump-link label pair). English is authored;
Spanish is machine-draft consistent with the existing `shells.*` entries (stays
preview-gated pending operator review per `docs/OPERATIONS_HANDOFF.md §5`).

### v2 hub — `app/v2/page.jsx`

Add two `routeStyle` links (Prep, Bar) to the preview-lanes list and bump the
"Migration lanes" metric from `7` to `9`.

### Nav registry — `app/_components/navRegistry.js` (REQUIRED)

`tests/js/test-nav-shortcuts.mjs` ("registers or explicitly excludes every
non-dynamic app page") scans `app/` and asserts every static route is in
`NAV_ITEMS` or `NAV_ROUTE_EXCLUSIONS`. The moment `app/v2/prep/page.jsx` exists,
that test goes red unless `/v2/prep` is registered. So each route's task MUST
append its `NAV_ROUTE_EXCLUSIONS` entry **in the same commit** as the page:

```js
{ href: '/v2/prep', reason: 'Cookie-gated side-by-side preview route; keep v2 cook pages out of v1 navigation until cutover.' },
{ href: '/v2/bar',  reason: 'Cookie-gated side-by-side preview route; keep v2 cook pages out of v1 navigation until cutover.' },
```

These are append-only additions. The concurrent manager-tier v2 effort is also
appending to this array; on merge, expect an easily-resolved conflict (distinct
route strings, no shared logic).

## Data model deltas

**None.** No tables, columns, migrations, or `data/cache/*` changes. The v1 pages
own all data access; the wrappers add only presentation + navigation.

## Invariants

1. **v1 unchanged** — `app/prep/**` and `app/bar/**` are imported and rendered
   verbatim; no edits under those paths.
2. **Cook-tier stays cook-tier** — `/v2/prep` and `/v2/bar` are NOT added to
   `SENSITIVE_PREFIXES`; they return 200 without a PIN, exactly like their v1
   routes and the other v2 cook routes.
3. **Preview gate inherited** — no per-route cookie logic; `app/v2/layout.jsx`
   gates the whole subtree on `lariat_v2=1`.
4. **searchParams awaited** — both wrappers `await searchParams` before reading
   `location` (Next 16 app-router contract; a sync read silently yields the wrong
   location — the exact bug the v1 prep page comments call out).
5. **Location fidelity** — `sp.location` is threaded into the embedded v1 page so
   `?location=bar` renders the correct kitchen, matching v1 behavior.
6. **Route coverage stays green** — every task that creates a `app/v2/<x>/page.jsx`
   appends its `NAV_ROUTE_EXCLUSIONS` entry in the *same* commit, so
   `test-nav-shortcuts.mjs` never goes red mid-plan.
7. **Minimal collision surface** — the only shared-with-concurrent-session file
   touched is `navRegistry.js`, and only by appending two entries; the manager
   v2 route dirs (`app/v2/{beo,booking,…}`) are never touched.

## Testing

Static-contract `.mjs` structure tests, one per route, mirroring
`tests/js/test-v2-stations.mjs` (these assert file structure via regex, not
render — the established v2 test style, and they run without node_modules):

- `tests/js/test-v2-prep.mjs` — asserts `app/v2/prep/page.jsx` exists, is
  `force-dynamic`, awaits searchParams, reads location w/ `DEFAULT_LOCATION_ID`
  fallback, imports the live `app/prep/page.jsx`, renders `<PrepPage searchParams=`,
  and links `/v2/today`.
- `tests/js/test-v2-bar.mjs` — same shape against `app/v2/bar/page.jsx` /
  `<BarPage`.

Two existing tests must stay green (each route registers its exclusion in the
same commit, so they never go red mid-plan):

- `tests/js/test-nav-shortcuts.mjs` — route-coverage; enforces the
  `NAV_ROUTE_EXCLUSIONS` entries above.
- `tests/js/test-v2-shell.mjs` — hub/shell contract; its hard-coded
  exclusion-list and landing-content loops are extended to include `/v2/prep`
  and `/v2/bar`.

Full gate set at verify: `typecheck` (also enforces en/es i18n parity via
`Messages = typeof en`), `lint`, the v2 + nav structure tests, and production
`build`.

**Gate-coverage caveat (deferred, not fixed here):** the v2 `test-v2-*.mjs` and
`test-nav-shortcuts.mjs` structure tests are NOT wired into `npm run verify` or
`.github/workflows/ci.yml` — they're a manual convention across all 8 existing
v2 routes. The real CI gates for these routes are `typecheck` + `next build`.
This round matches the existing convention (run them manually) rather than
expanding scope to wire them into CI; flagged as a follow-up in the PR.

## Open questions

1. **`/prep/par` residual.** The v1 prep board renders a "Standing prep par →"
   link to `/prep/par` (v1-absolute). Inside the v2 shell this bounces the cook
   to v1. Options: (a) accept it as a documented residual this round
   [recommended — par editing is a secondary screen, and threading a `basePath`
   through `PrepPage` would modify the v1 page, violating the non-goal]; (b) a
   follow-up task to add optional `basePath` to `PrepPage` mirroring
   `StationsPage`. **Proposed: (a).**
2. **Bar swap.** User elected to keep `/bar` despite it being a pour-cost
   dashboard. If on review it feels out of place in the cook tier, the drop-in
   alternative is `/food-safety/cooling` (a true HACCP cook action). Left as-is
   per decision.
