# v2 Cook Migration — Prep + Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/v2/prep` and `/v2/bar` preview routes that wrap the unchanged v1 pages in the branded v2 shell, so a cook running the v2 preview reaches prep and bar work without falling back to v1.

**Architecture:** Each route is a thin server-component wrapper (`force-dynamic`) that awaits `searchParams`, renders an i18n hero + jump-nav, then embeds the v1 component (`<PrepPage>` / `<BarPage>`) verbatim — identical to the four shipped v2 cook routes (today, punch, eighty-six, stations). No v1 code changes. Because the route-coverage test scans `app/` for pages, each route registers its `NAV_ROUTE_EXCLUSIONS` entry in the same commit.

**Tech Stack:** Next.js 16 app router (JSX server components), hand-rolled `lib/i18n` (en + es, `Messages = typeof en` parity enforced by `tsc`), `node --test` static-contract structure tests.

## Global Constraints

- **No edits under `app/prep/**` or `app/bar/**`** — v1 components are imported and rendered unchanged.
- **`/v2/prep` and `/v2/bar` MUST NOT be added to `SENSITIVE_PREFIXES`** in `middleware.js` — both are cook-tier (no PIN), matching their v1 routes and the other v2 cook routes.
- **Preview gate is inherited** from `app/v2/layout.jsx` (`lariat_v2=1`) — no per-route cookie logic.
- **`await searchParams`** before reading `location`; fall back to `DEFAULT_LOCATION_ID` (Next 16 contract — a sync read yields the wrong location).
- **i18n parity:** any key added to `lib/i18n/messages/en.ts` MUST be added to `es.ts` with the same shape, or `tsc` fails.
- **`navRegistry.js` is append-only** in this plan — add the two new exclusion entries; do not touch existing entries or the concurrent manager-v2 work.
- **Do not touch** `app/v2/{beo,booking,costing,host,menu-engineering,morning,playbook,purchasing,shows,specials}` (concurrent session).
- **Commit prefix** is the task id (`T1:` / `T2:`). One commit per task. Never weaken a test to pass.
- **Structure-test runner:** `node --experimental-strip-types --test <file>`.

---

### Task T1: `/v2/prep` cook route

**Files:**
- Create: `app/v2/prep/page.jsx`
- Create: `tests/js/test-v2-prep.mjs`
- Modify: `lib/i18n/messages/en.ts` (add `shells.prep` block)
- Modify: `lib/i18n/messages/es.ts` (add `shells.prep` block)
- Modify: `app/_components/navRegistry.js` (append `/v2/prep` to `NAV_ROUTE_EXCLUSIONS`)
- Modify: `app/v2/page.jsx` (add Prep link; bump "Migration lanes" `7` → `8`)
- Modify: `tests/js/test-v2-shell.mjs` (add `/v2/prep` to the exclusion-list loop and the landing-content loop)

**Interfaces:**
- Consumes: `PrepPage` (default export of `app/prep/page.jsx`, signature `PrepPage({ searchParams })`); `DEFAULT_LOCATION_ID` from `lib/location`; `getMessages`, `t` from `lib/i18n/index.ts`; `getLocale` from `lib/i18n/server.ts`.
- Produces: route `/v2/prep`; i18n keys `shells.prep.{eyebrow,title,copy,watchEyebrow,watchLink}`; `NAV_ROUTE_EXCLUSIONS` entry `{href:'/v2/prep'}`. T2 relies on none of these except the "Migration lanes" count being `8` after this task (T2 bumps it to `9`).

**MUST NOT modify:** `app/prep/**`, `middleware.js`, `app/v2/bar/**`, any `app/v2/{beo,booking,…}` dir.

- [ ] **Step 1: Write the failing structure test**

Create `tests/js/test-v2-prep.mjs`:

```js
#!/usr/bin/env node
// Static contract for the fifth cook-tier v2 route: /v2/prep.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-prep.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_PREP_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'prep', 'page.jsx');
const V2_HUB_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/prep route file', () => {
  it('ships the fifth cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_PREP_PAGE), 'app/v2/prep/page.jsx should exist');
  });

  it('stays server-rendered and location-aware like v1 prep', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 prep');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
  });

  it('reuses the live v1 prep page instead of a dead stub', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /from ['"].*\/prep\/page\.jsx['"]/, 'v2 prep should import the live prep page');
    assert.match(source, /<PrepPage\s+searchParams=\{sp\}\s*\/?>/, 'v2 prep should pass awaited searchParams through');
  });

  it('keeps cooks moving back to today', () => {
    const source = read(V2_PREP_PAGE);
    assert.match(source, /\/v2\/today/, '/v2/today should be linked from /v2/prep');
  });

  it('is listed on the v2 hub', () => {
    const source = read(V2_HUB_PAGE);
    assert.match(source, /href=["']\/v2\/prep["']/, '/v2/prep should be listed on the v2 hub');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-v2-prep.mjs`
Expected: FAIL — first assertion `app/v2/prep/page.jsx should exist` throws (file absent).

Also run the shell test after extending it (Step 3 extends it) — but first confirm the current baseline is green:
Run: `node --experimental-strip-types --test tests/js/test-v2-shell.mjs`
Expected: PASS (baseline, before extension).

- [ ] **Step 3a: Create the wrapper page**

Create `app/v2/prep/page.jsx`:

```jsx
// @ts-nocheck - fifth cook-tier v2 route: /v2/prep.
import Link from 'next/link';
import PrepPage from '../../prep/page.jsx';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { getMessages, t } from '../../../lib/i18n/index.ts';
import { getLocale } from '../../../lib/i18n/server.ts';

export const dynamic = 'force-dynamic';

export default async function V2PrepPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const locationId =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';
  const locale = await getLocale();
  const m = getMessages(locale);

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={eyebrowStyle}>{t(m, 'shells.prep.eyebrow')}</div>
          <h1 style={titleStyle}>{t(m, 'shells.prep.title')}</h1>
          <p style={copyStyle}>{t(m, 'shells.prep.copy')}</p>
        </div>
        <div style={jumpRowStyle}>
          <Link href={`/v2/today${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>{t(m, 'common.back')}</span>
            <strong>{t(m, 'shells.backToToday')}</strong>
          </Link>
          <Link href={`/v2/eighty-six${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>{t(m, 'shells.prep.watchEyebrow')}</span>
            <strong>{t(m, 'shells.prep.watchLink')}</strong>
          </Link>
        </div>
      </section>

      <section style={shellStyle}>
        <PrepPage searchParams={sp} />
      </section>
    </main>
  );
}

const heroStyle = {
  display: 'grid',
  gap: 16,
  padding: 20,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(246, 240, 229, 0.06)',
};

const eyebrowStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9cc6ac',
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(32px, 6vw, 54px)',
  lineHeight: 0.95,
  letterSpacing: 0,
};

const copyStyle = {
  margin: 0,
  maxWidth: 560,
  color: 'rgba(246, 240, 229, 0.74)',
  lineHeight: 1.4,
};

const jumpRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const jumpCardStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 76,
  alignContent: 'center',
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(23, 24, 20, 0.32)',
  padding: 16,
  textDecoration: 'none',
};

const shellStyle = {
  padding: 4,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.12)',
  background: 'rgba(12, 13, 11, 0.24)',
};
```

- [ ] **Step 3b: Add `shells.prep` to `lib/i18n/messages/en.ts`**

Inside the `shells: { … }` object, immediately after the `station: { … },` block (before the `},` that closes `shells`), insert:

```ts
    prep: {
      eyebrow: 'Prep now',
      title: 'Work the prep list',
      copy: 'Claim your prep, knock it out, and keep the line stocked.',
      watchEyebrow: 'Watch',
      watchLink: 'Watch 86',
    },
```

- [ ] **Step 3c: Add the mirrored `shells.prep` to `lib/i18n/messages/es.ts`**

Inside its `shells: { … }` object, after the `station: { … },` block, insert:

```ts
    prep: {
      eyebrow: 'Prep ya',
      title: 'Trabaja la lista de prep',
      copy: 'Toma tu prep, sácalo y mantén la línea surtida.',
      watchEyebrow: 'Ver',
      watchLink: 'Ver los 86',
    },
```

- [ ] **Step 3d: Append the `/v2/prep` nav exclusion**

In `app/_components/navRegistry.js`, inside `NAV_ROUTE_EXCLUSIONS`, after the `/v2/stations` entry, insert:

```js
  {
    href: '/v2/prep',
    reason: 'Cookie-gated side-by-side preview route; keep v2 cook pages out of v1 navigation until cutover.',
  },
```

- [ ] **Step 3e: Add the hub link and bump the lane count in `app/v2/page.jsx`**

In the preview-lanes `<aside>` route list, after the `/v2/stations` `<Link>`, insert:

```jsx
            <Link href="/v2/prep" style={routeStyle}>
              <span>Prep</span>
              <strong>Work the list</strong>
            </Link>
```

And change the "Migration lanes" metric number from `7` to `8`:

```jsx
            <div style={metricStyle}>
              <span style={metricNumberStyle}>8</span>
              <span style={metricLabelStyle}>Migration lanes</span>
            </div>
```

- [ ] **Step 3f: Extend `tests/js/test-v2-shell.mjs` to cover `/v2/prep`**

Add `'/v2/prep'` to BOTH hard-coded route arrays: the exclusion-documentation loop (the `for (const href of [ … ])` at ~line 59) and the landing-content loop (~line 71). Each becomes:

```js
    for (const href of ['/v2/today', '/v2/kds/punch', '/v2/eighty-six', '/v2/stations', '/v2/prep', '/v2/command', '/v2/management', '/v2/analytics']) {
```

- [ ] **Step 4: Run the acceptance tests + gates to verify green**

Run each and expect PASS:

```bash
node --experimental-strip-types --test tests/js/test-v2-prep.mjs
node --experimental-strip-types --test tests/js/test-v2-shell.mjs
node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs
npm run typecheck
```

Expected: `test-v2-prep` PASS (page + hub link present); `test-v2-shell` PASS (`/v2/prep` documented + listed); `test-nav-shortcuts` PASS (route coverage satisfied by the new exclusion); `typecheck` PASS (en/es `shells.prep` shapes match).

- [ ] **Step 5: Commit**

```bash
git add app/v2/prep/page.jsx tests/js/test-v2-prep.mjs \
        lib/i18n/messages/en.ts lib/i18n/messages/es.ts \
        app/_components/navRegistry.js app/v2/page.jsx tests/js/test-v2-shell.mjs
git commit -m "T1: add /v2/prep cook route (wrapper + i18n + nav exclusion + hub link)"
```

---

### Task T2: `/v2/bar` cook route

**Files:**
- Create: `app/v2/bar/page.jsx`
- Create: `tests/js/test-v2-bar.mjs`
- Modify: `lib/i18n/messages/en.ts` (add `shells.bar` block)
- Modify: `lib/i18n/messages/es.ts` (add `shells.bar` block)
- Modify: `app/_components/navRegistry.js` (append `/v2/bar` to `NAV_ROUTE_EXCLUSIONS`)
- Modify: `app/v2/page.jsx` (add Bar link; bump "Migration lanes" `8` → `9`)
- Modify: `tests/js/test-v2-shell.mjs` (add `/v2/bar` to the exclusion-list loop and the landing-content loop)

**Interfaces:**
- Consumes: `BarPage` (default export of `app/bar/page.jsx`, signature `BarPage({ searchParams })`); same `lib/location` / `lib/i18n` imports as T1. Depends on T1 having set the "Migration lanes" count to `8`.
- Produces: route `/v2/bar`; i18n keys `shells.bar.{eyebrow,title,copy,watchEyebrow,watchLink}`; `NAV_ROUTE_EXCLUSIONS` entry `{href:'/v2/bar'}`.

**Depends on:** T1 (shared files `app/v2/page.jsx`, `navRegistry.js`, `en.ts`, `es.ts`, `test-v2-shell.mjs` — run T2 after T1 is committed).

**MUST NOT modify:** `app/bar/**`, `middleware.js`, `app/v2/prep/**`, any `app/v2/{beo,booking,…}` dir.

- [ ] **Step 1: Write the failing structure test**

Create `tests/js/test-v2-bar.mjs`:

```js
#!/usr/bin/env node
// Static contract for the sixth cook-tier v2 route: /v2/bar.
//
// Run: node --experimental-strip-types --test tests/js/test-v2-bar.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2_BAR_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'bar', 'page.jsx');
const V2_HUB_PAGE = path.join(REPO_ROOT, 'app', 'v2', 'page.jsx');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('/v2/bar route file', () => {
  it('ships the sixth cook-tier migration page', () => {
    assert.ok(fs.existsSync(V2_BAR_PAGE), 'app/v2/bar/page.jsx should exist');
  });

  it('stays server-rendered and location-aware like v1 bar', () => {
    const source = read(V2_BAR_PAGE);
    assert.match(source, /export const dynamic\s*=\s*['"]force-dynamic['"]/, 'route should stay dynamic like v1 bar');
    assert.match(source, /const sp = \(await searchParams\) \|\| \{\}/, 'route should await searchParams');
    assert.match(source, /typeof sp\.location === 'string'/, 'route should read location from awaited search params');
    assert.match(source, /DEFAULT_LOCATION_ID/, 'route should default to the canonical location');
  });

  it('reuses the live v1 bar page instead of a dead stub', () => {
    const source = read(V2_BAR_PAGE);
    assert.match(source, /from ['"].*\/bar\/page\.jsx['"]/, 'v2 bar should import the live bar page');
    assert.match(source, /<BarPage\s+searchParams=\{sp\}\s*\/?>/, 'v2 bar should pass awaited searchParams through');
  });

  it('keeps cooks moving back to today', () => {
    const source = read(V2_BAR_PAGE);
    assert.match(source, /\/v2\/today/, '/v2/today should be linked from /v2/bar');
  });

  it('is listed on the v2 hub', () => {
    const source = read(V2_HUB_PAGE);
    assert.match(source, /href=["']\/v2\/bar["']/, '/v2/bar should be listed on the v2 hub');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-v2-bar.mjs`
Expected: FAIL — `app/v2/bar/page.jsx should exist` throws.

- [ ] **Step 3a: Create the wrapper page**

Create `app/v2/bar/page.jsx` (jump-nav points back to today and over to the new prep board):

```jsx
// @ts-nocheck - sixth cook-tier v2 route: /v2/bar.
import Link from 'next/link';
import BarPage from '../../bar/page.jsx';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { getMessages, t } from '../../../lib/i18n/index.ts';
import { getLocale } from '../../../lib/i18n/server.ts';

export const dynamic = 'force-dynamic';

export default async function V2BarPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const locationId =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const locationQuery = locationId !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(locationId)}` : '';
  const locale = await getLocale();
  const m = getMessages(locale);

  return (
    <main style={{ display: 'grid', gap: 18 }}>
      <section style={heroStyle}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={eyebrowStyle}>{t(m, 'shells.bar.eyebrow')}</div>
          <h1 style={titleStyle}>{t(m, 'shells.bar.title')}</h1>
          <p style={copyStyle}>{t(m, 'shells.bar.copy')}</p>
        </div>
        <div style={jumpRowStyle}>
          <Link href={`/v2/today${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>{t(m, 'common.back')}</span>
            <strong>{t(m, 'shells.backToToday')}</strong>
          </Link>
          <Link href={`/v2/prep${locationQuery}`} style={jumpCardStyle}>
            <span style={eyebrowStyle}>{t(m, 'shells.bar.watchEyebrow')}</span>
            <strong>{t(m, 'shells.bar.watchLink')}</strong>
          </Link>
        </div>
      </section>

      <section style={shellStyle}>
        <BarPage searchParams={sp} />
      </section>
    </main>
  );
}

const heroStyle = {
  display: 'grid',
  gap: 16,
  padding: 20,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(246, 240, 229, 0.06)',
};

const eyebrowStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#9cc6ac',
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(32px, 6vw, 54px)',
  lineHeight: 0.95,
  letterSpacing: 0,
};

const copyStyle = {
  margin: 0,
  maxWidth: 560,
  color: 'rgba(246, 240, 229, 0.74)',
  lineHeight: 1.4,
};

const jumpRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const jumpCardStyle = {
  display: 'grid',
  gap: 4,
  minHeight: 76,
  alignContent: 'center',
  borderRadius: 10,
  border: '1px solid rgba(246, 240, 229, 0.16)',
  background: 'rgba(23, 24, 20, 0.32)',
  padding: 16,
  textDecoration: 'none',
};

const shellStyle = {
  padding: 4,
  borderRadius: 12,
  border: '1px solid rgba(246, 240, 229, 0.12)',
  background: 'rgba(12, 13, 11, 0.24)',
};
```

- [ ] **Step 3b: Add `shells.bar` to `lib/i18n/messages/en.ts`**

After the `prep: { … },` block added in T1 (inside `shells`), insert:

```ts
    bar: {
      eyebrow: 'Pour cost',
      title: 'Read the bar numbers',
      copy: 'See which pours hit target and which are bleeding margin.',
      watchEyebrow: 'Prep',
      watchLink: 'Work the prep list',
    },
```

- [ ] **Step 3c: Add the mirrored `shells.bar` to `lib/i18n/messages/es.ts`**

After the `prep: { … },` block (inside `shells`), insert:

```ts
    bar: {
      eyebrow: 'Costo por trago',
      title: 'Lee los números de la barra',
      copy: 'Mira qué tragos dan el margen y cuáles lo pierden.',
      watchEyebrow: 'Prep',
      watchLink: 'Trabaja la lista de prep',
    },
```

- [ ] **Step 3d: Append the `/v2/bar` nav exclusion**

In `app/_components/navRegistry.js`, inside `NAV_ROUTE_EXCLUSIONS`, after the `/v2/prep` entry, insert:

```js
  {
    href: '/v2/bar',
    reason: 'Cookie-gated side-by-side preview route; keep v2 cook pages out of v1 navigation until cutover.',
  },
```

- [ ] **Step 3e: Add the hub link and bump the lane count in `app/v2/page.jsx`**

After the `/v2/prep` `<Link>` added in T1, insert:

```jsx
            <Link href="/v2/bar" style={routeStyle}>
              <span>Bar</span>
              <strong>Pour cost</strong>
            </Link>
```

And change the "Migration lanes" metric number from `8` to `9`:

```jsx
            <div style={metricStyle}>
              <span style={metricNumberStyle}>9</span>
              <span style={metricLabelStyle}>Migration lanes</span>
            </div>
```

- [ ] **Step 3f: Extend `tests/js/test-v2-shell.mjs` to cover `/v2/bar`**

Add `'/v2/bar'` to BOTH hard-coded route arrays (after `/v2/prep`). Each becomes:

```js
    for (const href of ['/v2/today', '/v2/kds/punch', '/v2/eighty-six', '/v2/stations', '/v2/prep', '/v2/bar', '/v2/command', '/v2/management', '/v2/analytics']) {
```

- [ ] **Step 4: Run the acceptance tests + gates to verify green**

```bash
node --experimental-strip-types --test tests/js/test-v2-bar.mjs
node --experimental-strip-types --test tests/js/test-v2-prep.mjs
node --experimental-strip-types --test tests/js/test-v2-shell.mjs
node --experimental-strip-types --test tests/js/test-nav-shortcuts.mjs
npm run typecheck
```

Expected: all PASS. `test-v2-prep` still green (regression check), `test-v2-bar` green, shell + nav coverage green, typecheck green.

- [ ] **Step 5: Commit**

```bash
git add app/v2/bar/page.jsx tests/js/test-v2-bar.mjs \
        lib/i18n/messages/en.ts lib/i18n/messages/es.ts \
        app/_components/navRegistry.js app/v2/page.jsx tests/js/test-v2-shell.mjs
git commit -m "T2: add /v2/bar cook route (wrapper + i18n + nav exclusion + hub link)"
```

---

## Final verification (after T1 + T2)

Run the full local gate superset (`verify` plus lint plus the structure tests CI doesn't run):

```bash
node --experimental-strip-types --test tests/js/test-v2-prep.mjs tests/js/test-v2-bar.mjs tests/js/test-v2-shell.mjs tests/js/test-nav-shortcuts.mjs
npm run typecheck
npm run lint
npm run build
```

All green → push `feat/v2-cook-prep-bar` and open a PR (SPEC + PLAN links, commit list, gate output). Note the deferred follow-up: wire `test-v2-*.mjs` + `test-nav-shortcuts.mjs` into `verify`/CI (they currently only gate manually — pre-existing gap, not introduced here).

## Self-Review

**Spec coverage:** `/v2/prep` (T1) ✓, `/v2/bar` (T2) ✓, i18n en+es (T1/T2 3b/3c) ✓, nav exclusions (T1/T2 3d) ✓, hub links + lane count (T1/T2 3e) ✓, structure tests (T1/T2 Step 1) ✓, shell/nav-coverage green (T1/T2 3f + Step 4) ✓, no v1 edits (Global Constraints) ✓, no `SENSITIVE_PREFIXES` change (Global Constraints) ✓, `/prep/par` residual accepted (spec Open Q1 — no task, by design) ✓.

**Placeholder scan:** every code step contains complete file content or an exact insert with surrounding anchor. No TBD/TODO/"handle edge cases".

**Type consistency:** wrapper export names `V2PrepPage`/`V2BarPage`; embedded components `PrepPage`/`BarPage` (verified as the v1 default exports); i18n key paths `shells.prep.*`/`shells.bar.*` used identically in page + en + es; `<PrepPage searchParams={sp} />` / `<BarPage searchParams={sp} />` match the test regex `<PrepPage\s+searchParams=\{sp\}` / `<BarPage\s+searchParams=\{sp\}`.
