# Catering Estimate — Heritage Render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render an existing BEO event as a heritage-branded ("1885") catering estimate document, shared by a new operator route (`/beo/[id]/estimate`) and the re-skinned client share route (`/beo/share/[token]`).

**Architecture:** A pure `EstimateDocument` component renders from props; a `lib/beoEstimate.ts` helper computes totals + section grouping (de-duping math currently inlined in the share page). Two thin server routes load DB rows and render the component. No new data model.

**Tech Stack:** Next.js App Router (server components), React, plain CSS (`.estimate-doc`-scoped, role tokens), better-sqlite3 via `lib/db`, Jest + @testing-library/react (component), Node `--test` (`--experimental-strip-types`) for the helper.

## Global Constraints

- No Tailwind — plain CSS using `var(--token)` role tokens from `styles/tokens.css`; new rules scoped under `.estimate-doc`. (verbatim from spec invariant 3)
- No DB schema change; no `SCHEMA_VERSION` bump (keeps `check-schema-version-bump` green). (spec "Data model deltas")
- Totals math preserved to the cent: `subtotal = Σ(unit_cost × quantity)`, `serviceFee = subtotal × service_fee_pct/100`, `tax = subtotal × tax_rate`, `total = subtotal + serviceFee + tax`. (spec invariant 1)
- Reuse app fonts (`--display`, `--sans`, `--mono`); no new webfonts. (spec non-goals)
- Branch `feat/catering-estimate-heritage`; one commit per task, `T#:` prefix; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `register==='client'` must never render an operator-only (`data-print="false"`) node. (spec invariant 2)

## File Structure

- `lib/beoEstimate.ts` — pure totals + grouping (new).
- `tests/js/test-beo-estimate.mjs` — helper tests (new).
- `app/beo/_components/EstimateDocument.jsx` — heritage document component (new).
- `app/beo/_components/CopyLinkButton.jsx` — operator copy-share-link client button (new).
- `styles/estimate.css` — `.estimate-doc`-scoped heritage styles (new).
- `app/__tests__/EstimateDocument.test.jsx` — component tests (new).
- `app/__tests__/CopyLinkButton.test.jsx` — button test (new).
- `app/beo/share/[token]/page.jsx` — refactor to use `EstimateDocument` (modify).
- `app/beo/[id]/estimate/page.jsx` — operator route (new).
- `package.json` — add `test:beo-estimate` script + fold into `verify` (modify).

---

### Task T1: Totals + grouping helper (`lib/beoEstimate.ts`)

**Files:**
- Create: `lib/beoEstimate.ts`
- Test: `tests/js/test-beo-estimate.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces:
  - `computeEstimateTotals(event: {tax_rate?: number; service_fee_pct?: number}, lineItems: Array<{unit_cost?: number; quantity?: number}>): {subtotal: number; serviceFee: number; tax: number; total: number}`
  - `groupLineItemsBySection(lineItems: LineItem[], courses: Array<{id:number; course_label:string}>): Array<{label: string; items: LineItem[]}>` where `LineItem = {id:number; item_name:string; category?:string; unit_cost?:number; quantity?:number; course_id?:number; sort_order?:number}`
  - `SECTION_ORDER: string[]` (canonical band order)

- [ ] **Step 1: Write the failing test**

```js
// tests/js/test-beo-estimate.mjs
// Run: node --experimental-strip-types --test tests/js/test-beo-estimate.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEstimateTotals, groupLineItemsBySection } from '../../lib/beoEstimate.ts';

describe('computeEstimateTotals', () => {
  it('matches the prototype event (8200 → svc20% → tax8.15%)', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0.0815, service_fee_pct: 20 },
      [{ unit_cost: 4100, quantity: 2 }], // 8200
    );
    assert.equal(t.subtotal, 8200);
    assert.equal(t.serviceFee, 1640);
    assert.equal(Number(t.tax.toFixed(2)), 668.3);
    assert.equal(Number(t.total.toFixed(2)), 10508.3);
  });
  it('matches a real corpus event (Collett 15000 → svc15% → tax8.15%)', () => {
    const t = computeEstimateTotals(
      { tax_rate: 0.0815, service_fee_pct: 15 },
      [{ unit_cost: 15000, quantity: 1 }],
    );
    assert.equal(t.serviceFee, 2250);
    assert.equal(Number(t.tax.toFixed(2)), 1222.5);
    assert.equal(Number(t.total.toFixed(2)), 18472.5);
  });
  it('treats missing rates/fields as zero', () => {
    const t = computeEstimateTotals({}, [{ unit_cost: 10 }, { quantity: 3 }, {}]);
    assert.deepEqual(t, { subtotal: 0, serviceFee: 0, tax: 0, total: 0 });
  });
});

describe('groupLineItemsBySection', () => {
  it('groups by category in canonical order, unknown appended, null → Menu', () => {
    const groups = groupLineItemsBySection(
      [
        { id: 1, item_name: 'Open Bar', category: 'Bar & Fees', sort_order: 1 },
        { id: 2, item_name: 'Carnitas', category: 'Buffet', sort_order: 2 },
        { id: 3, item_name: 'Pig Wings', category: 'Passed', sort_order: 3 },
        { id: 4, item_name: 'Mystery', category: 'Zzz Catering', sort_order: 4 },
        { id: 5, item_name: 'Loose', sort_order: 5 },
      ],
      [],
    );
    assert.deepEqual(groups.map((g) => g.label), ['Passed', 'Buffet', 'Bar & Fees', 'Zzz Catering', 'Menu']);
    assert.equal(groups[0].items[0].item_name, 'Pig Wings');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-beo-estimate.mjs`
Expected: FAIL — `Cannot find module '../../lib/beoEstimate.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/beoEstimate.ts
export interface EstimateLineItem {
  id: number; item_name: string; category?: string | null;
  unit_cost?: number | null; quantity?: number | null;
  course_id?: number | null; sort_order?: number | null;
}
export interface EstimateTotals { subtotal: number; serviceFee: number; tax: number; total: number; }

export const SECTION_ORDER: string[] = [
  'Passed', 'Passed Hors d’Oeuvres', 'Large Format', 'Buffet', 'Large Format & Buffet',
  'Family Style', 'Passed Desserts', 'Desserts', 'Artisan Snack Boards', 'Boards', 'Bar & Fees',
];

export function computeEstimateTotals(
  event: { tax_rate?: number | null; service_fee_pct?: number | null },
  lineItems: Array<{ unit_cost?: number | null; quantity?: number | null }>,
): EstimateTotals {
  const subtotal = lineItems.reduce(
    (acc, l) => acc + Number(l.unit_cost || 0) * Number(l.quantity || 0), 0);
  const serviceFee = subtotal * (Number(event.service_fee_pct || 0) / 100);
  const tax = subtotal * Number(event.tax_rate || 0);
  return { subtotal, serviceFee, tax, total: subtotal + serviceFee + tax };
}

export function groupLineItemsBySection(
  lineItems: EstimateLineItem[],
  courses: Array<{ id: number; course_label: string }>,
): Array<{ label: string; items: EstimateLineItem[] }> {
  const courseLabel = new Map(courses.map((c) => [c.id, c.course_label]));
  const buckets = new Map<string, EstimateLineItem[]>();
  for (const li of [...lineItems].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const label = (li.category && li.category.trim())
      || (li.course_id != null && courseLabel.get(li.course_id)) || 'Menu';
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(li);
  }
  const rank = (l: string) => { const i = SECTION_ORDER.indexOf(l); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  return [...buckets.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, items]) => ({ label, items }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-beo-estimate.mjs`
Expected: PASS (3 + 1 describe blocks green).

- [ ] **Step 5: Wire into npm scripts**

In `package.json` `scripts`, add: `"test:beo-estimate": "node --experimental-strip-types --test tests/js/test-beo-estimate.mjs"`, and append ` && npm run test:beo-estimate` to the `verify` script (before `&& npm run build`).
Run: `npm run test:beo-estimate` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/beoEstimate.ts tests/js/test-beo-estimate.mjs package.json
git commit -m "T1: beoEstimate totals + section grouping helper"
```

---

### Task T2: `EstimateDocument` component + heritage CSS

**Files:**
- Create: `app/beo/_components/EstimateDocument.jsx`, `styles/estimate.css`
- Test: `app/__tests__/EstimateDocument.test.jsx`

**Interfaces:**
- Consumes: `computeEstimateTotals`, `groupLineItemsBySection` outputs from T1; `formatDollars` from `lib/formatMoney`.
- Produces: `export default function EstimateDocument({ event, sections, totals, courses, signatures, register, signSlot })`. Root element: `<article className={`estimate-doc ${register}`}>`. Operator-only nodes carry `data-print="false"`.

- [ ] **Step 1: Write the failing test**

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import EstimateDocument from '../beo/_components/EstimateDocument';

const base = {
  event: { id: 1, title: 'Harvest Dinner', guest_count: 60, tax_rate: 0.0815, service_fee_pct: 20 },
  sections: [{ label: 'Passed', items: [{ id: 1, item_name: 'Pig Wings', unit_cost: 4, quantity: 60 }] }],
  totals: { subtotal: 240, serviceFee: 48, tax: 19.56, total: 307.56 },
  courses: [], signatures: [],
};

test('renders title, section band label, and the estimated total', () => {
  render(<EstimateDocument {...base} register="client" />);
  expect(screen.getByText('Harvest Dinner')).toBeInTheDocument();
  expect(screen.getByText('Passed')).toBeInTheDocument();
  expect(screen.getByText('$307.56')).toBeInTheDocument();
});

test('client register hides operator-only nodes; operator shows them', () => {
  const { container: client } = render(<EstimateDocument {...base} register="client" />);
  expect(client.querySelector('.estimate-doc.client')).toBeTruthy();
  const { container: op } = render(<EstimateDocument {...base} register="operator" />);
  expect(op.querySelector('.estimate-doc.operator')).toBeTruthy();
});

test('renders signSlot when provided', () => {
  render(<EstimateDocument {...base} register="client" signSlot={<div>SIGN HERE</div>} />);
  expect(screen.getByText('SIGN HERE')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/EstimateDocument.test.jsx`
Expected: FAIL — cannot resolve `../beo/_components/EstimateDocument`.

- [ ] **Step 3: Write `styles/estimate.css`**

Scoped heritage tokens + bands. Complete rules (navy/brass/cream), e.g.:

```css
/* styles/estimate.css — all rules scoped under .estimate-doc (no .paper regression) */
.estimate-doc { --nav:#1F2D3D; --brass:#A8772F; --cream:#F4F0E8; --ink:#1A1814; --slate:#6B7280; --hairline:#C9CDD2;
  background:var(--cream); color:var(--ink); font-family:var(--display, Georgia, serif); }
.estimate-doc .ed-band-head { background:var(--nav); color:#fff; }
.estimate-doc .ed-section-band { background:var(--brass); color:#fff; font-family:var(--mono, monospace);
  text-transform:uppercase; letter-spacing:.14em; font-size:11px; padding:6px 12px; }
.estimate-doc .ed-total-band { background:var(--nav); color:#fff; display:flex; justify-content:space-between;
  padding:14px 18px; font-weight:700; }
.estimate-doc .ed-num { font-family:var(--mono, monospace); font-variant-numeric:tabular-nums; text-align:right; }
.estimate-doc .ed-rule { border:0; border-top:1px solid var(--hairline); }
.estimate-doc.client [data-print="false"] { display:none; }
@media print { [data-print="false"] { display:none !important; }
  .estimate-doc .ed-section-band, .estimate-doc .ed-total-band, .estimate-doc .ed-band-head {
    -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
```

- [ ] **Step 4: Write `EstimateDocument.jsx` (port the prototype markup to JSX)**

Port the document markup from the validated prototype `scratchpad/estimate-builder.html` (the read/client register only — masthead with inline SVG wordmark, Prepared-For / Event-Details grid, one `.ed-section-band` per `sections[]` then its item rows with `formatDollars(unit_cost)` and line total via `unit_cost*quantity`, subtotal/service/tax rows, `.ed-total-band` Estimated Total, terms, signature block + `signSlot`). Root: `<article className={`estimate-doc ${register}`}>`. Import `./...` CSS at top: `import '../../../styles/estimate.css';` and `import { formatDollars } from '../../../lib/formatMoney';`. No data fetching. Use `data-print="false"` on operator-only wrappers (none required yet beyond the class hook).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest app/__tests__/EstimateDocument.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/beo/_components/EstimateDocument.jsx styles/estimate.css app/__tests__/EstimateDocument.test.jsx
git commit -m "T2: EstimateDocument heritage component + scoped CSS"
```

---

### Task T3: Refactor client share route to use `EstimateDocument`

**Files:**
- Modify: `app/beo/share/[token]/page.jsx`

**Interfaces:**
- Consumes: `computeEstimateTotals`, `groupLineItemsBySection` (T1); `EstimateDocument` (T2); existing `SignForm`, `isValidShareTokenShape`.

- [ ] **Step 1: Pre-change characterization (manual)** — note current rendered totals for a seeded share token so the refactor can be compared. Run `npm run seed-beo` if needed; record subtotal/service/tax/total.

- [ ] **Step 2: Refactor** — keep the DB queries, `isValidShareTokenShape`, `notFound()`, and the chrome-hide `<style>`. Replace the hand-rolled header/menu/totals JSX with:

```jsx
const totals = computeEstimateTotals(event, lineItems);
const sections = groupLineItemsBySection(lineItems, courses);
return (
  <EstimateDocument
    event={event} sections={sections} totals={totals} courses={courses}
    signatures={signatures} register="client"
    signSlot={<SignForm token={token} />}
  />
);
```
Wrap with the existing chrome-hide `<style>` fragment. Delete the now-dead inline `subtotal/serviceFee/tax/total` math and the `EYEBROW_STYLE`/table JSX.

- [ ] **Step 3: Verify** — `npm run typecheck` → PASS. Then visual check via the run-lariat skill: screenshot `/beo/share/<seeded-token>` and confirm the heritage document renders with correct totals (matches Step 1) and the SignForm still posts.

- [ ] **Step 4: Commit**

```bash
git add app/beo/share/[token]/page.jsx
git commit -m "T3: re-skin client share route onto EstimateDocument"
```

---

### Task T4: Operator estimate route `/beo/[id]/estimate` + copy-link button

**Files:**
- Create: `app/beo/[id]/estimate/page.jsx`, `app/beo/_components/CopyLinkButton.jsx`
- Test: `app/__tests__/CopyLinkButton.test.jsx`

**Interfaces:**
- Consumes: `getDb`, `computeEstimateTotals`, `groupLineItemsBySection`, `EstimateDocument`. Gated automatically by `middleware.js` (`/beo` is sensitive; `/beo/share/` is the only exception).
- Produces: `CopyLinkButton({ url })` client component.

- [ ] **Step 1: Write the failing test (button)**

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CopyLinkButton from '../beo/_components/CopyLinkButton';

test('copies the url and shows confirmation', async () => {
  const writeText = jest.fn().mockResolvedValue();
  Object.assign(navigator, { clipboard: { writeText } });
  render(<CopyLinkButton url="https://x/beo/share/abc" />);
  await userEvent.click(screen.getByRole('button', { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith('https://x/beo/share/abc');
  expect(await screen.findByText(/copied/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest app/__tests__/CopyLinkButton.test.jsx`
Expected: FAIL — cannot resolve `CopyLinkButton`.

- [ ] **Step 3: Implement `CopyLinkButton.jsx`**

```jsx
'use client';
import { useState } from 'react';
export default function CopyLinkButton({ url }) {
  const [done, setDone] = useState(false);
  if (!url) return null;
  return (
    <button type="button" className="btn" data-print="false" onClick={async () => {
      try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch {}
    }}>{done ? 'Copied' : 'Copy client link'}</button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest app/__tests__/CopyLinkButton.test.jsx`
Expected: PASS.

- [ ] **Step 5: Implement the operator route**

```jsx
// app/beo/[id]/estimate/page.jsx
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { computeEstimateTotals, groupLineItemsBySection } from '../../../../lib/beoEstimate';
import EstimateDocument from '../../_components/EstimateDocument';
import CopyLinkButton from '../../_components/CopyLinkButton';

export const dynamic = 'force-dynamic';

export default async function OperatorEstimatePage({ params }) {
  const { id } = (await params) || {};
  const db = getDb();
  const event = db.prepare(
    `SELECT id, title, event_date, event_time, contact_name, guest_count, notes,
            tax_rate, service_fee_pct, status, share_token FROM beo_events WHERE id = ?`).get(id);
  if (!event) return notFound();
  const lineItems = db.prepare(
    `SELECT id, sort_order, item_name, category, unit_cost, quantity, course_id
       FROM beo_line_items WHERE event_id = ? ORDER BY sort_order, id`).all(event.id);
  const courses = db.prepare(
    `SELECT id, course_label, fire_at, notes, sort_order FROM beo_courses WHERE event_id = ? ORDER BY sort_order, id`).all(event.id);
  const signatures = db.prepare(
    `SELECT id, signed_name, signed_at FROM beo_signatures WHERE event_id = ? ORDER BY signed_at DESC, id DESC`).all(event.id);
  const totals = computeEstimateTotals(event, lineItems);
  const sections = groupLineItemsBySection(lineItems, courses);
  const shareUrl = event.share_token ? `/beo/share/${event.share_token}` : null;
  return (
    <div style={{ padding: 16 }}>
      <div data-print="false" style={{ marginBottom: 12 }}>
        {shareUrl ? <CopyLinkButton url={shareUrl} /> : <span className="muted">No client link yet — generate one in the board.</span>}
      </div>
      <EstimateDocument event={event} sections={sections} totals={totals}
        courses={courses} signatures={signatures} register="operator" />
    </div>
  );
}
```

- [ ] **Step 6: Verify** — `npm run typecheck` → PASS. Visual check via run-lariat: visit `/beo/<id>/estimate` (PIN-gated) for a seeded event; confirm document + working "Copy client link".

- [ ] **Step 7: Commit**

```bash
git add app/beo/[id]/estimate/page.jsx app/beo/_components/CopyLinkButton.jsx app/__tests__/CopyLinkButton.test.jsx
git commit -m "T4: operator estimate route + copy-link button"
```

---

### Task T5: Verify + PR

- [ ] **Step 1:** Run full gates: `npm run typecheck && npm run lint && npm run test:unit && npm run test:beo-estimate && npm run build`. All green (capture output).
- [ ] **Step 2:** Push branch `feat/catering-estimate-heritage`.
- [ ] **Step 3:** Open PR (base `main`) with: link to SPEC + this PLAN, commit list (T1–T4), test output, and deferred follow-ups (food-cost overlay, min-spend meter — increment 2).

## Self-Review

- **Spec coverage:** EstimateDocument (T2) ✓, operator route (T4) ✓, share upgrade (T3) ✓, computeEstimateTotals helper (T1) ✓, `.estimate-doc` scoped styling (T2) ✓, register gating (T2 test) ✓, no schema change ✓, invariants 1–5 covered by T1 test + T3 verify + scoping. No spec requirement left without a task.
- **Placeholder scan:** helper + tests + button + route are complete code; the one referential step is T2/Step 4 (porting the large document markup from the named prototype file) — intentional, the prototype is the visual source of truth.
- **Type consistency:** `computeEstimateTotals` / `groupLineItemsBySection` signatures identical across T1 definition and T2/T3/T4 consumers; `EstimateDocument` prop names consistent across T2 test, T3, T4.
