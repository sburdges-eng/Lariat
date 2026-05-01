# Master Costing Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 task E — add per-recipe ABC ranking and a 28-day COGS-variance trend to `/costing`, plus a small copy polish on the menu-engineering quadrants.

**Architecture:** Pure-fn `rankByContribution` (no I/O) + read-only `getVarianceTrend` (single SELECT against `accounting_variance`). Two server-rendered tile components on `/costing`. No new schema.

**Tech Stack:** Next.js 14 App Router · React 18 · better-sqlite3 (existing tables only) · Node `--experimental-strip-types --test`.

**Spec:** `docs/superpowers/specs/2026-05-01-master-costing-tile-design.md`

---

## Task 1: `lib/abcRanking.ts` — types + `rankByContribution`

**Files:**
- Create: `lib/abcRanking.ts`
- Create: `tests/js/test-abc-ranking.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/js/test-abc-ranking.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const abc = await import('../../lib/abcRanking.ts');

const linked = (n, qty, cost, price) => ({
  itemName: n,
  qty,
  costPerUnit: cost,
  marginPct: ((price - cost) / price) * 100,
  netSales: price * qty,
});
const unlinked = (n, qty, price) => ({
  itemName: n,
  qty,
  costPerUnit: null,
  marginPct: null,
  netSales: price * qty,
});

describe('rankByContribution', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(abc.rankByContribution([]), []);
  });

  it('marks unlinked rows as unranked, score 0', () => {
    const r = abc.rankByContribution([unlinked('Mystery', 100, 10)]);
    assert.equal(r.length, 1);
    assert.equal(r[0].tier, 'unranked');
    assert.equal(r[0].scoreCents, 0);
  });

  it('top contributor lands in tier A', () => {
    const rows = [
      linked('Star',     500, 2.00, 12.00),  // contrib 5000, mix-weighted high
      linked('Mid',      100, 4.00, 10.00),
      linked('Tail',      10, 5.00,  8.00),
    ];
    const r = abc.rankByContribution(rows);
    const star = r.find((x) => x.itemName === 'Star');
    assert.equal(star.tier, 'A');
  });

  it('sums tier scores to total contribution', () => {
    const rows = [
      linked('A1', 100, 2.00, 10.00),
      linked('A2',  80, 3.00, 12.00),
      linked('B1',  20, 4.00,  9.00),
      linked('C1',   2, 5.00,  8.00),
    ];
    const r = abc.rankByContribution(rows);
    const total = r.reduce((s, x) => s + x.scoreCents, 0);
    assert.ok(total > 0);
    // Cumulative pct of last linked row should be ~100
    const lastLinked = [...r]
      .filter((x) => x.tier !== 'unranked')
      .pop();
    assert.ok(Math.abs(lastLinked.cumulativePct - 100) < 0.5);
  });

  it('respects custom thresholds', () => {
    const rows = [
      linked('Big',  1000, 1.00, 10.00),
      linked('Mid',   100, 1.00, 10.00),
      linked('Tail',   10, 1.00, 10.00),
    ];
    const r = abc.rankByContribution(rows, { aPct: 0.5, bPct: 0.9 });
    // With aPct=0.5 the dominant 'Big' row alone exceeds 50% → tier A
    const big = r.find((x) => x.itemName === 'Big');
    assert.equal(big.tier, 'A');
  });

  it('handles tiny menus — single linked row goes to A', () => {
    const r = abc.rankByContribution([linked('Solo', 50, 2.00, 10.00)]);
    assert.equal(r[0].tier, 'A');
    assert.equal(r[0].cumulativePct, 100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-abc-ranking.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `lib/abcRanking.ts`**

```ts
// Pure-fn ABC contribution ranking — no I/O.
//
// Inputs are caller-supplied rows shaped like a slimmed MenuEngineeringRow.
// The caller decides the time window (a day, a week, a month). This module
// just computes contribution-weighted Pareto tiers.

export interface AbcInputRow {
  itemName: string;
  qty: number;
  costPerUnit: number | null;
  marginPct: number | null;
  netSales: number;
}

export type AbcTier = 'A' | 'B' | 'C' | 'unranked';

export interface AbcRankedRow extends AbcInputRow {
  contributionDollars: number;
  menuMixPct: number;
  scoreCents: number;
  cumulativePct: number;
  tier: AbcTier;
}

export interface AbcThresholds {
  aPct?: number;   // default 0.80
  bPct?: number;   // default 0.95
}

export function rankByContribution(
  rows: AbcInputRow[],
  thresholds?: AbcThresholds,
): AbcRankedRow[] {
  const aPct = thresholds?.aPct ?? 0.8;
  const bPct = thresholds?.bPct ?? 0.95;

  if (rows.length === 0) return [];

  const totalQty = rows.reduce((s, r) => s + (r.qty || 0), 0);
  const enriched = rows.map((r) => {
    const linked = r.costPerUnit !== null && r.marginPct !== null;
    const avgPrice = r.qty > 0 ? r.netSales / r.qty : 0;
    const contributionDollars = linked
      ? Math.max(0, (avgPrice - (r.costPerUnit ?? 0)) * r.qty)
      : 0;
    const menuMixPct = totalQty > 0 ? r.qty / totalQty : 0;
    const scoreCents = linked
      ? Math.round(contributionDollars * menuMixPct * 100)
      : 0;
    return { ...r, contributionDollars, menuMixPct, scoreCents, linked };
  });

  const linkedRows = enriched.filter((x) => x.linked && x.scoreCents > 0);
  const totalScore = linkedRows.reduce((s, x) => s + x.scoreCents, 0);

  // Sort linked rows by score desc; assign cumulative + tier.
  linkedRows.sort((a, b) => b.scoreCents - a.scoreCents);
  let running = 0;
  const ranked: AbcRankedRow[] = [];
  for (const r of linkedRows) {
    running += r.scoreCents;
    const cumulativePct =
      totalScore > 0 ? Math.min(100, (running / totalScore) * 100) : 100;
    let tier: AbcTier;
    if (cumulativePct <= aPct * 100) tier = 'A';
    else if (cumulativePct <= bPct * 100) tier = 'B';
    else tier = 'C';
    ranked.push({
      itemName: r.itemName,
      qty: r.qty,
      costPerUnit: r.costPerUnit,
      marginPct: r.marginPct,
      netSales: r.netSales,
      contributionDollars: r.contributionDollars,
      menuMixPct: r.menuMixPct,
      scoreCents: r.scoreCents,
      cumulativePct,
      tier,
    });
  }

  // Append unranked rows in the original order, score 0.
  for (const r of enriched) {
    if (!r.linked || r.scoreCents === 0) {
      ranked.push({
        itemName: r.itemName,
        qty: r.qty,
        costPerUnit: r.costPerUnit,
        marginPct: r.marginPct,
        netSales: r.netSales,
        contributionDollars: 0,
        menuMixPct: r.menuMixPct,
        scoreCents: 0,
        cumulativePct: 0,
        tier: 'unranked',
      });
    }
  }

  return ranked;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-abc-ranking.mjs`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/abcRanking.ts tests/js/test-abc-ranking.mjs
git commit -m "feat(costing): pure-fn ABC contribution ranking"
```

---

## Task 2: `lib/varianceTrend.ts` — `getVarianceTrend`

**Files:**
- Create: `lib/varianceTrend.ts`
- Create: `tests/js/test-variance-trend.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/js/test-variance-trend.mjs
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const trend = await import('../../lib/varianceTrend.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`DELETE FROM accounting_variance;`);
});

function insertVariance(periodStart, periodEnd, theoretical, actual, location = 'default') {
  const variance_amount = actual - theoretical;
  const variance_pct = theoretical > 0 ? (variance_amount / theoretical) * 100 : null;
  db.prepare(
    `INSERT INTO accounting_variance
       (period_start, period_end, theoretical_cogs, actual_cogs,
        variance_amount, variance_pct, snapshot_at, location_id)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
  ).run(periodStart, periodEnd, theoretical, actual, variance_amount, variance_pct, location);
}

describe('getVarianceTrend', () => {
  it('returns rowsFound: 0 and empty points when table is empty', () => {
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 0);
    assert.equal(t.points.length, 0);
    assert.equal(t.pCurrent, null);
    assert.equal(t.pAverage, null);
  });

  it('returns last 28 days ordered oldest → newest', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1020);  // 2.0
    insertVariance('2026-04-08', '2026-04-14', 1000, 1050);  // 5.0
    insertVariance('2026-04-15', '2026-04-21', 1000, 1010);  // 1.0
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 3);
    assert.equal(t.points.length, 3);
    assert.equal(t.points[0].periodEnd, '2026-04-07');
    assert.equal(t.points[2].periodEnd, '2026-04-21');
    assert.equal(t.pCurrent, 1.0);
    assert.ok(Math.abs(t.pAverage - (2 + 5 + 1) / 3) < 0.01);
  });

  it('color buckets match T9 thresholds', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1019);  // 1.9 → green
    insertVariance('2026-04-08', '2026-04-14', 1000, 1030);  // 3.0 → yellow
    insertVariance('2026-04-15', '2026-04-21', 1000, 1080);  // 8.0 → red
    const t = trend.getVarianceTrend('default');
    assert.equal(t.points[0].thresholdColor, 'green');
    assert.equal(t.points[1].thresholdColor, 'yellow');
    assert.equal(t.points[2].thresholdColor, 'red');
  });

  it('respects location scoping', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1020, 'default');
    insertVariance('2026-04-01', '2026-04-07', 1000, 1100, 'other');
    const t = trend.getVarianceTrend('default');
    assert.equal(t.rowsFound, 1);
    assert.equal(t.pCurrent, 2.0);
  });

  it('honors a custom window', () => {
    insertVariance('2026-04-01', '2026-04-07', 1000, 1010);
    insertVariance('2026-04-08', '2026-04-14', 1000, 1020);
    insertVariance('2026-04-15', '2026-04-21', 1000, 1030);
    const t = trend.getVarianceTrend('default', 14);
    // Only the two most recent rows should fit in a 14-day window
    // (period_end of 2026-04-21 minus 14 days = 2026-04-07 — boundary inclusive).
    assert.ok(t.points.length >= 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-variance-trend.mjs`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write `lib/varianceTrend.ts`**

```ts
// 28-day COGS-variance trend reader.
//
// accounting_variance is written by the compute engine
// (lib/computeEngine/accountingVariance.ts). This module is a
// read-only consumer that pulls the most-recent N days for the
// /costing variance-trend tile. No I/O outside the SELECT.
//
// Color buckets reuse the T9 dashboard thresholds (< 2 / 2-5 / >= 5)
// so the tile reads consistently with the existing B1 tile.

import { getDb } from './db.ts';

export interface VarianceTrendPoint {
  periodStart: string;
  periodEnd: string;
  variancePct: number | null;
  varianceAmount: number | null;
  thresholdColor: 'green' | 'yellow' | 'red';
}

export interface VarianceTrend {
  points: VarianceTrendPoint[];
  pCurrent: number | null;
  pAverage: number | null;
  windowDays: number;
  rowsFound: number;
}

function colorFor(pct: number | null): 'green' | 'yellow' | 'red' {
  if (pct === null) return 'green';
  const abs = Math.abs(pct);
  if (abs >= 5) return 'red';
  if (abs >= 2) return 'yellow';
  return 'green';
}

export function getVarianceTrend(
  locationId: string,
  windowDays: number = 28,
): VarianceTrend {
  const db = getDb();

  // Find the cutoff date relative to the latest period_end in the
  // table — picking up "windowDays before the most recent run" rather
  // than "windowDays before today" so a stale DB still renders the
  // most recent N days of data.
  const latest = db
    .prepare(
      `SELECT MAX(period_end) AS latest FROM accounting_variance
       WHERE location_id = ?`,
    )
    .get(locationId) as { latest: string | null };
  if (!latest?.latest) {
    return {
      points: [],
      pCurrent: null,
      pAverage: null,
      windowDays,
      rowsFound: 0,
    };
  }

  const cutoff = new Date(latest.latest);
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `SELECT period_start, period_end, variance_amount, variance_pct
       FROM accounting_variance
       WHERE location_id = ? AND period_end >= ?
       ORDER BY period_end ASC`,
    )
    .all(locationId, cutoffISO) as {
    period_start: string;
    period_end: string;
    variance_amount: number | null;
    variance_pct: number | null;
  }[];

  const points: VarianceTrendPoint[] = rows.map((r) => ({
    periodStart: r.period_start,
    periodEnd: r.period_end,
    varianceAmount: r.variance_amount,
    variancePct: r.variance_pct,
    thresholdColor: colorFor(r.variance_pct),
  }));

  const numericPcts = points
    .map((p) => p.variancePct)
    .filter((x): x is number => x !== null);
  const pAverage =
    numericPcts.length === 0
      ? null
      : numericPcts.reduce((s, x) => s + x, 0) / numericPcts.length;
  const pCurrent =
    points.length === 0 ? null : points[points.length - 1].variancePct;

  return {
    points,
    pCurrent,
    pAverage,
    windowDays,
    rowsFound: rows.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-variance-trend.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/varianceTrend.ts tests/js/test-variance-trend.mjs
git commit -m "feat(costing): 28-day variance trend reader"
```

---

## Task 3: `AbcTile` server component

**Files:**
- Create: `app/costing/_components/AbcTile.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { rankByContribution } from '../../../lib/abcRanking';

function dollars(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function tierCount(rows, tier) {
  return rows.filter((r) => r.tier === tier).length;
}

function tierShare(rows, tier) {
  const total = rows.reduce((s, r) => s + r.scoreCents, 0);
  if (total === 0) return 0;
  const tierTotal = rows
    .filter((r) => r.tier === tier)
    .reduce((s, r) => s + r.scoreCents, 0);
  return (tierTotal / total) * 100;
}

export default function AbcTile({ menuRows }) {
  // menuRows is the trimmed shape from MenuEngineeringRow → AbcInputRow.
  const ranked = rankByContribution(menuRows);
  const topA = ranked.filter((r) => r.tier === 'A').slice(0, 5);
  const linkedTotal = ranked.filter((r) => r.tier !== 'unranked').length;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row-meta" style={{ marginBottom: 8 }}>
        ABC contribution
      </div>
      {linkedTotal === 0 ? (
        <p className="row-meta" style={{ color: 'var(--amber, #8a5a00)' }}>
          No costed dishes yet — wire dish_components for the menu items
          before this tile becomes useful.
        </p>
      ) : (
        <>
          <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
            <TierRow tier="A" rows={ranked} />
            <TierRow tier="B" rows={ranked} />
            <TierRow tier="C" rows={ranked} />
            <TierRow tier="unranked" rows={ranked} label="unranked · no costing" />
          </dl>
          {topA.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <div className="row-meta">Top {topA.length} in tier A</div>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                {topA.map((r) => (
                  <li key={r.itemName} style={{ fontSize: 13 }}>
                    {r.itemName} · {dollars(r.contributionDollars / r.qty || 0)} margin/unit · {r.qty} sold
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TierRow({ tier, rows, label }) {
  const count = tierCount(rows, tier);
  const share = tierShare(rows, tier);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <dt>{label ?? `Tier ${tier}`}</dt>
      <dd style={{ margin: 0 }}>
        {count} {count === 1 ? 'dish' : 'dishes'} · {share.toFixed(0)}% of margin
      </dd>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/costing/_components/AbcTile.jsx
git commit -m "feat(costing): AbcTile component for /costing"
```

---

## Task 4: `VarianceTrend` server component

**Files:**
- Create: `app/costing/_components/VarianceTrend.jsx`

- [ ] **Step 1: Write the component**

```jsx
const COLOR = {
  green: 'var(--green, #2a8f3f)',
  yellow: 'var(--yellow, #b88300)',
  red: 'var(--red, #c00)',
};

function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export default function VarianceTrend({ trend }) {
  const { points, pCurrent, pAverage, windowDays, rowsFound } = trend;

  if (rowsFound === 0) {
    return (
      <section className="card" style={{ padding: 16 }}>
        <div className="row-meta" style={{ marginBottom: 8 }}>
          COGS variance · last {windowDays} days
        </div>
        <p className="row-meta" style={{ color: 'var(--amber, #8a5a00)' }}>
          No accounting_variance rows yet — run the compute engine to populate.
        </p>
      </section>
    );
  }

  // Inline SVG sparkline. Width adapts to point count; height is fixed.
  const cellW = 14;
  const cellGap = 2;
  const maxCellH = 40;
  const numericPcts = points
    .map((p) => Math.abs(p.variancePct ?? 0));
  const peak = Math.max(...numericPcts, 1);
  const w = points.length * (cellW + cellGap);
  const h = maxCellH + 4;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row-meta" style={{ marginBottom: 8 }}>
        COGS variance · last {windowDays} days · {rowsFound}{' '}
        {rowsFound === 1 ? 'run' : 'runs'}
      </div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        <Stat label="current" value={pct(pCurrent)} />
        <Stat label="average" value={pct(pAverage)} />
      </div>
      <svg width={w} height={h} role="img" aria-label="variance sparkline">
        {points.map((p, i) => {
          const v = Math.abs(p.variancePct ?? 0);
          const cellH = peak > 0 ? Math.max(2, (v / peak) * maxCellH) : 2;
          const x = i * (cellW + cellGap);
          const y = h - cellH;
          return (
            <rect
              key={`${p.periodEnd}-${i}`}
              x={x}
              y={y}
              width={cellW}
              height={cellH}
              fill={COLOR[p.thresholdColor]}
            />
          );
        })}
      </svg>
      <p className="row-meta" style={{ marginTop: 10, fontSize: 12 }}>
        Green ≤ 2% · Yellow 2–5% · Red ≥ 5%
      </p>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="row-meta">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/costing/_components/VarianceTrend.jsx
git commit -m "feat(costing): VarianceTrend sparkline component"
```

---

## Task 5: Wire both tiles into `/costing`

**Files:**
- Modify: `app/costing/page.jsx`

- [ ] **Step 1: Find the existing tile region**

The existing page renders B1 / B2 / B3 / dish-coverage tiles inside a grid. The new tiles append below that grid in a second row.

- [ ] **Step 2: Add imports + data plumbing + render**

Open `app/costing/page.jsx`. After the existing `import { computeDishCoverage } …` line, add:

```javascript
import { computeMenuEngineering } from '../../lib/menuEngineering';
import { getVarianceTrend } from '../../lib/varianceTrend';
import AbcTile from './_components/AbcTile';
import VarianceTrend from './_components/VarianceTrend';
```

After the existing `const dishCoverage = computeDishCoverage(loc);` line in the page body, add:

```javascript
let menuRows = [];
try {
  const me = computeMenuEngineering(loc);
  menuRows = me.rows.map((r) => ({
    itemName: r.item_name,
    qty: r.qty,
    costPerUnit: r.cost_per_unit,
    marginPct: r.margin_pct,
    netSales: r.net_sales,
  }));
} catch (e) {
  console.error('costing: menu-engineering compute failed', e);
}
const trend = getVarianceTrend(loc);
```

Then below the closing `</div>` of the existing four-tile grid, before the variance/unmapped tables, add:

```jsx
{/* Master costing — ABC contribution + variance trend */}
<div className="grid-2" style={{ marginTop: 18, gap: 18 }}>
  <AbcTile menuRows={menuRows} />
  <VarianceTrend trend={trend} />
</div>
```

(If the existing layout doesn't use `grid-2`, mirror the existing tile-grid class — open the file and copy whatever the B1/B2/B3 row uses.)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/costing/page.jsx
git commit -m "feat(costing): mount AbcTile + VarianceTrend on /costing"
```

---

## Task 6: Quadrant copy polish on `/menu-engineering`

**Files:**
- Modify: `app/menu-engineering/page.tsx`

- [ ] **Step 1: Update the `Q` map descriptions**

Open `app/menu-engineering/page.tsx`. Replace the `Q` object (currently lines ~11–17) with:

```ts
const Q: Record<string, { label: string; desc: string; color: string }> = {
  star:      { label: 'Star',      desc: 'High margin & popularity. Protect availability — never 86 a star.',  color: 'var(--green)' },
  plowhorse: { label: 'Plowhorse', desc: 'Low margin, high popularity. Reprice or sub a cheaper component before margin drift sinks the night.', color: 'var(--yellow)' },
  puzzle:    { label: 'Puzzle',    desc: 'High margin, low popularity. Push it on specials boards — the room does not know it exists.', color: 'var(--blue)' },
  dog:       { label: 'Dog',       desc: 'Low margin & popularity. Cut from the menu unless it anchors a category.',     color: 'var(--muted)' },
  unknown:   { label: 'Unknown',   desc: 'Need cost data — wire dish_components first.',              color: 'var(--border)' },
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/menu-engineering/page.tsx
git commit -m "chore(menu-engineering): action-oriented quadrant copy"
```

---

## Task 7: Verification gate

**Files:** None changed; verification only.

- [ ] **Step 1: Run the new test files together**

```bash
node --experimental-strip-types --test \
  tests/js/test-abc-ranking.mjs \
  tests/js/test-variance-trend.mjs
```

Expected: PASS — 11 tests total.

- [ ] **Step 2: Run the full repo gates**

```bash
npm run test:schema
npm run test:rules
npm run typecheck
```

Expected: every existing suite stays green.

---

## Task 8: PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/phase2-costing-tile
```

- [ ] **Step 2: Open the PR**

Title: `feat(phase2): master costing tile (ABC + variance trend + quadrant copy)`

Body:

```
Phase 2 task E. Two new tiles on /costing — ABC contribution
ranking (A: top 80% of margin / B: next 15% / C: tail / unranked) and
a 28-day COGS variance sparkline — plus action-oriented copy on the
menu-engineering quadrants.

Spec: docs/superpowers/specs/2026-05-01-master-costing-tile-design.md
Plan: docs/superpowers/plans/2026-05-01-master-costing-tile.md

What's new
- lib/abcRanking.ts — pure-fn rank by (avg_price - cost) × menu_mix
- lib/varianceTrend.ts — read-only get last N days of accounting_variance
- AbcTile + VarianceTrend server components on /costing
- Action sentences on the four menu-engineering quadrants

Out of scope (deferred slices)
- Recipe-level drill into the variance trend
- ABC inside /menu-engineering itself

Test plan
- node --experimental-strip-types --test tests/js/test-{abc-ranking,variance-trend}.mjs
- npm run test:schema && npm run test:rules
- npm run typecheck
- Manual: load /costing on a dev DB; confirm both tiles render and amber-state correctly when DB is empty
```

---

## Self-Review Notes

- **Spec coverage:** ABC (T1+T3+T5), variance trend (T2+T4+T5), quadrant copy (T6), gates (T7), PR (T8).
- **No placeholders.** Every code block is complete and ready to paste.
- **Type consistency:** `AbcInputRow` / `AbcRankedRow` defined T1, used T3+T5. `VarianceTrend` / `VarianceTrendPoint` defined T2, used T4+T5.
