# Settlement Math Implementation Plan

> **STATUS: SHIPPED (verified 2026-06-15 reconciliation) — deal parser + talent payout + settlement repo + PIN-gated API + settlement page with inline editor; 30/30 tests pass.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 task B (deal-point parser + per-show settlement repo + read-only settlement page with inline deal editor) so a manager can compute a Lariat settlement that ties out within $5 / 0.5% of the equivalent Prism number for any show in the DB.

**Architecture:** A new `show_deals` table holds structured deal-point inputs (cents-as-INTEGER for float-drift safety). A pure-fn module computes `computeTalentPayout` from a deal + ticket revenue. A repo module stitches together `box_office_lines`, `toast_sales_daily`, `show_deals`, and `shows` into one read-only `SettlementSummary`. Two PIN-gated routes (`/api/shows/[id]/deal` GET/PUT, `/api/shows/[id]/settlement` GET) and one read-only page expose it. Audit goes through the existing regulated DB stream (`lib/auditEvents.ts`).

**Tech Stack:** Next.js 14 App Router · React 18 · better-sqlite3 (WAL) · Node `--experimental-strip-types --test` runner · Jest for component tests · existing `lib/auditEvents.ts`, `lib/pin.ts`, `lib/location.ts` helpers.

**Spec:** `docs/superpowers/specs/2026-05-01-settlement-math-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `lib/db.ts` | Modify (line ~1805 in the Phase 2 init block) | Add `show_deals` table + index |
| `lib/dealPoints.ts` | Create | Pure-fn types + `parseDeal` + `emptyDeal` + `computeTalentPayout`. **No I/O.** |
| `lib/settlementRepo.ts` | Create | `getSettlement(showId, locationId)` and `upsertDeal(showId, deal, cookId, locationId)`. Audited via `postAuditEvent` inside the same tx. |
| `app/api/shows/[id]/deal/route.js` | Create | GET / PUT — PIN-checked, body-validated, returns `SettlementSummary` after PUT |
| `app/api/shows/[id]/settlement/route.js` | Create | GET — PIN-checked, returns `SettlementSummary` |
| `app/shows/[id]/settlement/page.jsx` | Create | Server component reads via repo; client `_components/DealEditor.jsx` PUTs back |
| `app/shows/[id]/settlement/_components/DealEditor.jsx` | Create | Manager-only collapsed editor |
| `app/_components/navRegistry.js` | Modify | Add settlement page entry |
| `tests/js/test-deal-points.mjs` | Create | Boundary cases on `computeTalentPayout` + parser |
| `tests/js/test-settlement-repo.mjs` | Create | In-memory SQLite, audit-row + rollback verification |
| `tests/js/test-settlement-route.mjs` | Create | PIN-gate enforcement (curl-replay), validation |

---

## Task 1: Add `show_deals` schema

**Files:**
- Modify: `lib/db.ts` (Phase 2 init block, after `box_office_lines` definition near line 1804)
- Test: `tests/js/test-schema-show-deals.mjs` (new)

- [x] **Step 1: Write the failing test**

```javascript
// tests/js/test-schema-show-deals.mjs
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

describe('show_deals schema', () => {
  it('has the expected columns and constraints', () => {
    const cols = db.prepare(`PRAGMA table_info(show_deals)`).all();
    const names = cols.map((c) => c.name);
    assert.deepEqual(
      names.sort(),
      [
        'buyout_cents',
        'costs_off_top_json',
        'guarantee_cents',
        'id',
        'location_id',
        'notes',
        'show_id',
        'updated_at',
        'updated_by_cook_id',
        'vs_pct_after_costs',
      ],
    );
  });

  it('enforces UNIQUE(show_id, location_id)', () => {
    db.prepare(
      `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (101, 'test', datetime('now'), 'ok')`,
    ).run();
    db.prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
       VALUES (101, 'default', 'X', '2026-05-01', 1, datetime('now'), 101)`,
    ).run();
    db.prepare(
      `INSERT INTO show_deals (show_id, location_id, guarantee_cents) VALUES (101, 'default', 100000)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO show_deals (show_id, location_id, guarantee_cents) VALUES (101, 'default', 200000)`,
          )
          .run(),
      /UNIQUE/,
    );
  });

  it('is idempotent — initSchema can be called twice without error', () => {
    const { initSchema } = require('../../lib/db.ts');
    // No-throw is the assertion.
    initSchema(db);
    initSchema(db);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-schema-show-deals.mjs`
Expected: FAIL with "no such table: show_deals" on the first test.

- [x] **Step 3: Add the table to `lib/db.ts`**

Find the closing `\`);` of the Phase 2 init block (currently at `lib/db.ts:1805`, immediately after `idx_box_office_source_ext`). Replace the closing `\`);` line with this — keep the new content above it, then close:

```ts
    CREATE TABLE IF NOT EXISTS show_deals (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id            INTEGER NOT NULL REFERENCES shows(id),
      location_id        TEXT NOT NULL DEFAULT 'default',
      guarantee_cents    INTEGER NOT NULL DEFAULT 0,
      vs_pct_after_costs REAL,
      costs_off_top_json TEXT NOT NULL DEFAULT '[]',
      buyout_cents       INTEGER NOT NULL DEFAULT 0,
      notes              TEXT,
      updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by_cook_id TEXT,
      UNIQUE (show_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_show_deals_show
      ON show_deals(show_id, location_id);
  `);
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-schema-show-deals.mjs`
Expected: PASS — 3 tests pass.

- [x] **Step 5: Commit**

```bash
git add lib/db.ts tests/js/test-schema-show-deals.mjs
git commit -m "feat(db): add show_deals table for Phase 2 settlement"
```

---

## Task 2: `lib/dealPoints.ts` — types + `emptyDeal` + `parseDeal`

**Files:**
- Create: `lib/dealPoints.ts`
- Create: `tests/js/test-deal-points.mjs`

- [x] **Step 1: Write the failing test**

```javascript
// tests/js/test-deal-points.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const dp = await import('../../lib/dealPoints.ts');

describe('emptyDeal', () => {
  it('returns a zeroed deal', () => {
    assert.deepEqual(dp.emptyDeal(), {
      guaranteeCents: 0,
      vsPctAfterCosts: null,
      costsOffTop: [],
      buyoutCents: 0,
    });
  });
});

describe('parseDeal', () => {
  it('parses a valid show_deals row', () => {
    const row = {
      guarantee_cents: 150000,
      vs_pct_after_costs: 0.85,
      costs_off_top_json: '[{"label":"Sound","cents":5000}]',
      buyout_cents: 25000,
    };
    assert.deepEqual(dp.parseDeal(row), {
      guaranteeCents: 150000,
      vsPctAfterCosts: 0.85,
      costsOffTop: [{ label: 'Sound', cents: 5000 }],
      buyoutCents: 25000,
    });
  });

  it('throws on malformed JSON in costs_off_top_json', () => {
    const row = {
      guarantee_cents: 0,
      vs_pct_after_costs: null,
      costs_off_top_json: 'not-json',
      buyout_cents: 0,
    };
    assert.throws(() => dp.parseDeal(row), /costs_off_top_json/);
  });

  it('treats null vs_pct as flat-guarantee deal', () => {
    const row = {
      guarantee_cents: 100000,
      vs_pct_after_costs: null,
      costs_off_top_json: '[]',
      buyout_cents: 0,
    };
    assert.equal(dp.parseDeal(row).vsPctAfterCosts, null);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-deal-points.mjs`
Expected: FAIL — module does not exist.

- [x] **Step 3: Write `lib/dealPoints.ts`**

```ts
// Pure-fn deal-point parser + talent payout math.
//
// No I/O. The settlement repo is the one place that converts a
// show_deals row into a DealPoint via parseDeal(), runs settlement
// math via computeTalentPayout(), and serializes back via the
// upsert.
//
// Money is INTEGER cents end-to-end. The repo rounds REAL columns
// (box_office_lines.face_price, fees) at the read boundary. The
// audit payload is the DealPoint DTO, not the raw row.

export interface DealCost {
  label: string;
  cents: number;
}

export interface DealPoint {
  guaranteeCents: number;
  vsPctAfterCosts: number | null;
  costsOffTop: DealCost[];
  buyoutCents: number;
}

export interface ShowDealRow {
  guarantee_cents: number;
  vs_pct_after_costs: number | null;
  costs_off_top_json: string;
  buyout_cents: number;
}

export function emptyDeal(): DealPoint {
  return {
    guaranteeCents: 0,
    vsPctAfterCosts: null,
    costsOffTop: [],
    buyoutCents: 0,
  };
}

export function parseDeal(row: ShowDealRow): DealPoint {
  let costs: DealCost[];
  try {
    const parsed = JSON.parse(row.costs_off_top_json);
    if (!Array.isArray(parsed)) {
      throw new Error('costs_off_top_json must be an array');
    }
    costs = parsed.map((c, i) => {
      if (!c || typeof c.label !== 'string' || typeof c.cents !== 'number') {
        throw new Error(`costs_off_top_json[${i}] missing label/cents`);
      }
      return { label: c.label, cents: Math.round(c.cents) };
    });
  } catch (e) {
    throw new Error(
      `parseDeal: bad costs_off_top_json — ${(e as Error).message}`,
    );
  }
  return {
    guaranteeCents: Math.round(row.guarantee_cents),
    vsPctAfterCosts: row.vs_pct_after_costs,
    costsOffTop: costs,
    buyoutCents: Math.round(row.buyout_cents),
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-deal-points.mjs`
Expected: PASS — 4 tests.

- [x] **Step 5: Commit**

```bash
git add lib/dealPoints.ts tests/js/test-deal-points.mjs
git commit -m "feat(deal-points): pure-fn parser + emptyDeal"
```

---

## Task 3: `computeTalentPayout` (pure-fn math)

**Files:**
- Modify: `lib/dealPoints.ts` (append)
- Modify: `tests/js/test-deal-points.mjs` (append boundary cases)

- [x] **Step 1: Write the failing tests**

Append to `tests/js/test-deal-points.mjs`:

```javascript
describe('computeTalentPayout', () => {
  const flat = {
    guaranteeCents: 100000,
    vsPctAfterCosts: null,
    costsOffTop: [],
    buyoutCents: 0,
  };
  const vs85 = {
    guaranteeCents: 100000,
    vsPctAfterCosts: 0.85,
    costsOffTop: [{ label: 'Sound', cents: 5000 }],
    buyoutCents: 0,
  };

  it('flat guarantee, revenue > guarantee → bonus 0', () => {
    const r = dp.computeTalentPayout({ deal: flat, ticketRevenueCents: 200000 });
    assert.equal(r.guaranteeCents, 100000);
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 100000);
  });

  it('vs deal, revenue ≤ guarantee + costs → bonus 0', () => {
    const r = dp.computeTalentPayout({ deal: vs85, ticketRevenueCents: 100000 });
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 100000);
  });

  it('vs deal, revenue above guarantee + costs → bonus split', () => {
    // overage = 200000 - 5000 - 100000 = 95000, vsBonus = floor(95000 * 0.85) = 80750
    const r = dp.computeTalentPayout({ deal: vs85, ticketRevenueCents: 200000 });
    assert.equal(r.vsBonusCents, 80750);
    assert.equal(r.totalCents, 180750);
  });

  it('all-zero deal → total 0', () => {
    const r = dp.computeTalentPayout({
      deal: dp.emptyDeal(),
      ticketRevenueCents: 999999,
    });
    assert.equal(r.totalCents, 0);
  });

  it('costs > revenue → overage clamped at 0', () => {
    const deal = {
      guaranteeCents: 0,
      vsPctAfterCosts: 0.5,
      costsOffTop: [{ label: 'Sound', cents: 50000 }],
      buyoutCents: 0,
    };
    const r = dp.computeTalentPayout({ deal, ticketRevenueCents: 10000 });
    assert.equal(r.vsBonusCents, 0);
    assert.equal(r.totalCents, 0);
  });

  it('buyout-only → total = buyout', () => {
    const deal = {
      guaranteeCents: 0,
      vsPctAfterCosts: null,
      costsOffTop: [],
      buyoutCents: 75000,
    };
    const r = dp.computeTalentPayout({ deal, ticketRevenueCents: 0 });
    assert.equal(r.totalCents, 75000);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/js/test-deal-points.mjs`
Expected: 6 new test failures with "computeTalentPayout is not a function".

- [x] **Step 3: Append `computeTalentPayout` to `lib/dealPoints.ts`**

```ts
export interface TalentPayout {
  guaranteeCents: number;
  vsBonusCents: number;
  buyoutCents: number;
  totalCents: number;
}

export function computeTalentPayout(args: {
  deal: DealPoint;
  ticketRevenueCents: number;
}): TalentPayout {
  const { deal, ticketRevenueCents } = args;
  const costsOffTopCents = deal.costsOffTop.reduce(
    (sum, c) => sum + c.cents,
    0,
  );
  const overage = Math.max(
    0,
    ticketRevenueCents - costsOffTopCents - deal.guaranteeCents,
  );
  const vsBonusCents =
    deal.vsPctAfterCosts === null ? 0 : Math.floor(overage * deal.vsPctAfterCosts);
  const totalCents = deal.guaranteeCents + vsBonusCents + deal.buyoutCents;
  return {
    guaranteeCents: deal.guaranteeCents,
    vsBonusCents,
    buyoutCents: deal.buyoutCents,
    totalCents,
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-deal-points.mjs`
Expected: PASS — 10 tests total.

- [x] **Step 5: Commit**

```bash
git add lib/dealPoints.ts tests/js/test-deal-points.mjs
git commit -m "feat(deal-points): computeTalentPayout with boundary tests"
```

---

## Task 4: `lib/settlementRepo.ts` — `upsertDeal` (audited, transactional)

**Files:**
- Create: `lib/settlementRepo.ts`
- Create: `tests/js/test-settlement-repo.mjs`

- [x] **Step 1: Write the failing test**

```javascript
// tests/js/test-settlement-repo.mjs
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const repo = await import('../../lib/settlementRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM show_deals; DELETE FROM audit_events;`);
});

describe('upsertDeal', () => {
  const sampleDeal = {
    guaranteeCents: 100000,
    vsPctAfterCosts: 0.85,
    costsOffTop: [{ label: 'Sound', cents: 5000 }],
    buyoutCents: 0,
  };

  it('inserts a new deal and writes one audit row', () => {
    repo.upsertDeal(1, sampleDeal, 'cook-jane', 'default');
    const dealRow = db.prepare(`SELECT * FROM show_deals WHERE show_id = 1`).get();
    assert.equal(dealRow.guarantee_cents, 100000);
    assert.equal(dealRow.vs_pct_after_costs, 0.85);
    assert.equal(dealRow.updated_by_cook_id, 'cook-jane');
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal'`)
      .all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'upsert');
    assert.equal(audit[0].actor_cook_id, 'cook-jane');
  });

  it('updates an existing deal and audits as correction', () => {
    repo.upsertDeal(1, sampleDeal, 'cook-jane', 'default');
    repo.upsertDeal(
      1,
      { ...sampleDeal, guaranteeCents: 150000 },
      'cook-bob',
      'default',
    );
    const dealRows = db.prepare(`SELECT * FROM show_deals WHERE show_id = 1`).all();
    assert.equal(dealRows.length, 1);
    assert.equal(dealRows[0].guarantee_cents, 150000);
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal' ORDER BY id`)
      .all();
    assert.equal(audit.length, 2);
    assert.equal(audit[1].action, 'correction');
    assert.equal(audit[1].actor_cook_id, 'cook-bob');
  });

  it('rolls back the audit row if the deal upsert fails', () => {
    // Force a violation: show_id = 999 doesn't exist (FK).
    assert.throws(
      () => repo.upsertDeal(999, sampleDeal, 'cook-jane', 'default'),
      /FOREIGN KEY/,
    );
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal'`)
      .all();
    assert.equal(audit.length, 0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-settlement-repo.mjs`
Expected: FAIL — module does not exist.

- [x] **Step 3: Write `lib/settlementRepo.ts` (upsertDeal only — getSettlement in Task 5)**

```ts
// Per-show settlement repo. Two surfaces:
//
//   getSettlement(showId, locationId) — read-only join across
//     shows + show_deals + box_office_lines + toast_sales_daily,
//     plus pure-fn computeTalentPayout, returning a SettlementSummary.
//
//   upsertDeal(showId, deal, cookId, locationId) — writes show_deals
//     + audit_events in a single tx. Action = 'upsert' on first write,
//     'correction' on every subsequent write per the audit_events
//     correction-trail convention.
//
// Money is INTEGER cents at every boundary inside the repo. Legacy
// REAL columns (box_office_lines.face_price, fees;
// toast_sales_daily.net_sales) are rounded at the read boundary.

import { getDb } from './db.ts';
import { postAuditEvent } from './auditEvents.ts';
import {
  computeTalentPayout,
  emptyDeal,
  parseDeal,
  type DealPoint,
} from './dealPoints.ts';

export function upsertDeal(
  showId: number,
  deal: DealPoint,
  cookId: string,
  locationId: string,
): void {
  const db = getDb();
  db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`,
      )
      .get(showId, locationId) as { id: number } | undefined;

    db.prepare(
      `INSERT INTO show_deals
         (show_id, location_id, guarantee_cents, vs_pct_after_costs,
          costs_off_top_json, buyout_cents, updated_at, updated_by_cook_id)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(show_id, location_id) DO UPDATE SET
         guarantee_cents    = excluded.guarantee_cents,
         vs_pct_after_costs = excluded.vs_pct_after_costs,
         costs_off_top_json = excluded.costs_off_top_json,
         buyout_cents       = excluded.buyout_cents,
         updated_at         = datetime('now'),
         updated_by_cook_id = excluded.updated_by_cook_id`,
    ).run(
      showId,
      locationId,
      deal.guaranteeCents,
      deal.vsPctAfterCosts,
      JSON.stringify(deal.costsOffTop),
      deal.buyoutCents,
      cookId,
    );

    const dealId =
      existing?.id ??
      (db
        .prepare(`SELECT id FROM show_deals WHERE show_id = ? AND location_id = ?`)
        .get(showId, locationId) as { id: number }).id;

    postAuditEvent({
      entity: 'show_deal',
      entity_id: dealId,
      action: existing ? 'correction' : 'upsert',
      actor_cook_id: cookId,
      actor_source: 'manager_ui',
      payload: deal,
      location_id: locationId,
    });
  })();
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-settlement-repo.mjs`
Expected: PASS — 3 tests.

- [x] **Step 5: Commit**

```bash
git add lib/settlementRepo.ts tests/js/test-settlement-repo.mjs
git commit -m "feat(settlement): upsertDeal with audit + transactional rollback"
```

---

## Task 5: `lib/settlementRepo.ts` — `getSettlement`

**Files:**
- Modify: `lib/settlementRepo.ts` (append)
- Modify: `tests/js/test-settlement-repo.mjs` (append)

- [x] **Step 1: Write the failing test**

Append to `tests/js/test-settlement-repo.mjs`:

```javascript
describe('getSettlement', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM show_deals;
      DELETE FROM box_office_lines;
      DELETE FROM toast_sales_daily;
      DELETE FROM audit_events;
    `);
  });

  it('returns emptyDeal + zeros when nothing has been entered', () => {
    const s = repo.getSettlement(1, 'default');
    assert.equal(s.show.id, 1);
    assert.equal(s.show.bandName, 'Test Band');
    assert.equal(s.deal.guaranteeCents, 0);
    assert.equal(s.ticketing.grossCents, 0);
    assert.equal(s.toast.totalCents, 0);
    assert.equal(s.toast.rowsFound, 0);
    assert.equal(s.netDoorCents, 0);
  });

  it('aggregates ticket revenue + fees by source', () => {
    db.prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
       VALUES (1, 'default', 'dice', 10, 35.00, 4.50),
              (1, 'default', 'walkup', 5, 40.00, 0)`,
    ).run();
    const s = repo.getSettlement(1, 'default');
    // dice: 10 × 35.00 = 350.00 → 35000c, 10 × 4.50 = 4500c
    // walkup: 5 × 40.00 = 200.00 → 20000c, 0 fees
    assert.equal(s.ticketing.grossCents, 55000);
    assert.equal(s.ticketing.feesCents, 4500);
    assert.equal(s.ticketing.netCents, 50500);
    assert.equal(s.ticketing.bySource.dice.qty, 10);
    assert.equal(s.ticketing.bySource.dice.grossCents, 35000);
    assert.equal(s.ticketing.bySource.walkup.qty, 5);
  });

  it('aggregates Toast revenue for shift_date = show_date', () => {
    db.prepare(
      `INSERT INTO toast_sales_daily
         (shift_date, net_sales, orders, guests, comparison_group, source, location_id)
       VALUES ('2026-05-01', 1234.56, 80, 120, 0, 'test', 'default'),
              ('2026-04-30', 999.99, 50, 70, 0, 'test', 'default')`,
    ).run();
    const s = repo.getSettlement(1, 'default');
    assert.equal(s.toast.totalCents, 123456);
    assert.equal(s.toast.ordersCount, 80);
    assert.equal(s.toast.guestsCount, 120);
    assert.equal(s.toast.rowsFound, 1);
    assert.equal(s.toast.attributionDate, '2026-05-01');
  });

  it('applies talent payout from the deal', () => {
    db.prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
       VALUES (1, 'default', 'dice', 100, 30.00, 3.00)`,
    ).run();
    repo.upsertDeal(
      1,
      {
        guaranteeCents: 100000,
        vsPctAfterCosts: 0.85,
        costsOffTop: [{ label: 'Sound', cents: 5000 }],
        buyoutCents: 0,
      },
      'cook-jane',
      'default',
    );
    const s = repo.getSettlement(1, 'default');
    // ticket gross = 300000c, fees = 30000c, net = 270000c
    // overage = 300000 - 5000 - 100000 = 195000
    // vsBonus = floor(195000 * 0.85) = 165750
    // talent = 100000 + 165750 + 0 = 265750
    // costs_off_top = 5000
    // net_door = 270000 - 5000 - 265750 = -750
    assert.equal(s.ticketing.grossCents, 300000);
    assert.equal(s.talent.totalCents, 265750);
    assert.equal(s.costsOffTopCents, 5000);
    assert.equal(s.netDoorCents, -750);
  });

  it('throws if the show does not exist', () => {
    assert.throws(() => repo.getSettlement(9999, 'default'), /show 9999 not found/);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/js/test-settlement-repo.mjs`
Expected: 5 new test failures with "getSettlement is not a function".

- [x] **Step 3: Append `getSettlement` to `lib/settlementRepo.ts`**

```ts
export type TicketSource = 'dice' | 'walkup' | 'comp' | 'will_call' | 'guestlist';

export interface SettlementSummary {
  show: { id: number; bandName: string; date: string; locationId: string };
  deal: DealPoint;
  ticketing: {
    grossCents: number;
    feesCents: number;
    netCents: number;
    bySource: Record<TicketSource, { qty: number; grossCents: number }>;
  };
  toast: {
    totalCents: number;
    ordersCount: number;
    guestsCount: number;
    attributionDate: string;
    rowsFound: number;
  };
  talent: {
    guaranteeCents: number;
    vsBonusCents: number;
    buyoutCents: number;
    totalCents: number;
  };
  costsOffTopCents: number;
  netDoorCents: number;
  computedAt: string;
}

const TICKET_SOURCES: TicketSource[] = [
  'dice',
  'walkup',
  'comp',
  'will_call',
  'guestlist',
];

function emptyBySource(): SettlementSummary['ticketing']['bySource'] {
  return TICKET_SOURCES.reduce(
    (acc, src) => ({ ...acc, [src]: { qty: 0, grossCents: 0 } }),
    {} as SettlementSummary['ticketing']['bySource'],
  );
}

export function getSettlement(
  showId: number,
  locationId: string,
): SettlementSummary {
  const db = getDb();
  const show = db
    .prepare(
      `SELECT id, band_name, show_date FROM shows
       WHERE id = ? AND location_id = ?`,
    )
    .get(showId, locationId) as
    | { id: number; band_name: string; show_date: string }
    | undefined;
  if (!show) throw new Error(`getSettlement: show ${showId} not found`);

  const dealRow = db
    .prepare(
      `SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
       FROM show_deals WHERE show_id = ? AND location_id = ?`,
    )
    .get(showId, locationId);
  const deal = dealRow ? parseDeal(dealRow) : emptyDeal();

  // Ticketing — aggregate cents, then group by source.
  const ticketRows = db
    .prepare(
      `SELECT source, qty, face_price, fees
       FROM box_office_lines
       WHERE show_id = ? AND location_id = ?`,
    )
    .all(showId, locationId) as {
    source: TicketSource;
    qty: number;
    face_price: number | null;
    fees: number | null;
  }[];

  const bySource = emptyBySource();
  let grossCents = 0;
  let feesCents = 0;
  for (const r of ticketRows) {
    const lineGross = Math.round((r.face_price ?? 0) * r.qty * 100);
    const lineFees = Math.round((r.fees ?? 0) * r.qty * 100);
    grossCents += lineGross;
    feesCents += lineFees;
    if (TICKET_SOURCES.includes(r.source)) {
      bySource[r.source].qty += r.qty;
      bySource[r.source].grossCents += lineGross;
    }
  }
  const netCents = grossCents - feesCents;

  // Toast — single date, single revenue number, no category split (v1).
  const toastRow = db
    .prepare(
      `SELECT
         COALESCE(SUM(net_sales), 0) AS net_sales,
         COALESCE(SUM(orders),    0) AS orders,
         COALESCE(SUM(guests),    0) AS guests,
         COUNT(*)                    AS rows_found
       FROM toast_sales_daily
       WHERE shift_date = ? AND location_id = ?`,
    )
    .get(show.show_date, locationId) as {
    net_sales: number;
    orders: number;
    guests: number;
    rows_found: number;
  };

  // Talent payout from the pure-fn module.
  const payout = computeTalentPayout({
    deal,
    ticketRevenueCents: grossCents,
  });
  const costsOffTopCents = deal.costsOffTop.reduce((s, c) => s + c.cents, 0);
  const netDoorCents = netCents - costsOffTopCents - payout.totalCents;

  return {
    show: {
      id: show.id,
      bandName: show.band_name,
      date: show.show_date,
      locationId,
    },
    deal,
    ticketing: { grossCents, feesCents, netCents, bySource },
    toast: {
      totalCents: Math.round(toastRow.net_sales * 100),
      ordersCount: toastRow.orders,
      guestsCount: toastRow.guests,
      attributionDate: show.show_date,
      rowsFound: toastRow.rows_found,
    },
    talent: payout,
    costsOffTopCents,
    netDoorCents,
    computedAt: new Date().toISOString(),
  };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-settlement-repo.mjs`
Expected: PASS — 8 tests total.

- [x] **Step 5: Commit**

```bash
git add lib/settlementRepo.ts tests/js/test-settlement-repo.mjs
git commit -m "feat(settlement): getSettlement aggregates tickets + Toast + deal"
```

---

## Task 6: `/api/shows/[id]/deal` route (GET, PUT, validated)

**Files:**
- Create: `app/api/shows/[id]/deal/route.js`
- Create: `tests/js/test-settlement-route.mjs`

- [x] **Step 1: Write the failing test**

```javascript
// tests/js/test-settlement-route.mjs
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM show_deals; DELETE FROM audit_events;`);
});

// Set PIN env so the route's hasPinCookie path runs.
process.env.LARIAT_PIN = '1234';
process.env.LARIAT_PIN_SECRET = 'test-secret-do-not-use-in-prod';

const dealRoute = await import(
  '../../app/api/shows/[id]/deal/route.js'
);

function makeReq(opts) {
  const url = `http://localhost/api/shows/${opts.id}/deal${opts.qs ?? ''}`;
  return new Request(url, {
    method: opts.method,
    headers: opts.cookie ? { cookie: `lariat_pin_ok=${opts.cookie}` } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

async function validCookie() {
  const { signPinCookieValue } = await import('../../lib/pinCookie.ts');
  return signPinCookieValue('test-secret-do-not-use-in-prod');
}

describe('PUT /api/shows/[id]/deal — auth', () => {
  it('returns 401 with no cookie (curl-replay defense)', async () => {
    const req = makeReq({
      id: 1,
      method: 'PUT',
      body: { deal: { guaranteeCents: 0, vsPctAfterCosts: null, costsOffTop: [], buyoutCents: 0 } },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 401);
  });
});

describe('PUT /api/shows/[id]/deal — validation', () => {
  it('rejects negative guarantee', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: { deal: { guaranteeCents: -1, vsPctAfterCosts: null, costsOffTop: [], buyoutCents: 0 } },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 422);
  });

  it('rejects vsPctAfterCosts > 1', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: { deal: { guaranteeCents: 0, vsPctAfterCosts: 1.5, costsOffTop: [], buyoutCents: 0 } },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 422);
  });

  it('accepts a valid deal and writes it', async () => {
    const cookie = await validCookie();
    const req = makeReq({
      id: 1,
      method: 'PUT',
      cookie,
      body: {
        deal: {
          guaranteeCents: 100000,
          vsPctAfterCosts: 0.85,
          costsOffTop: [{ label: 'Sound', cents: 5000 }],
          buyoutCents: 0,
        },
        cookId: 'cook-jane',
      },
    });
    const res = await dealRoute.PUT(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const written = db.prepare(`SELECT * FROM show_deals`).all();
    assert.equal(written.length, 1);
    assert.equal(written[0].guarantee_cents, 100000);
  });
});

describe('GET /api/shows/[id]/deal', () => {
  it('returns null when no deal entered', async () => {
    const cookie = await validCookie();
    const req = makeReq({ id: 1, method: 'GET', cookie });
    const res = await dealRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deal, null);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/js/test-settlement-route.mjs`
Expected: FAIL — module does not exist.

- [x] **Step 3: Write `app/api/shows/[id]/deal/route.js`**

```javascript
// PIN-gated deal upsert / read for a single show. Settlement page is the
// primary caller; backfill scripts can use the same surface with a valid
// PIN cookie.

import { NextResponse } from 'next/server';
import { hasPinCookie } from '../../../../../lib/pin.ts';
import { locationFromRequest } from '../../../../../lib/location.ts';
import { upsertDeal, getSettlement } from '../../../../../lib/settlementRepo.ts';
import { getDb } from '../../../../../lib/db.ts';
import { parseDeal } from '../../../../../lib/dealPoints.ts';

function validateDeal(d) {
  if (!d || typeof d !== 'object') return 'deal: must be an object';
  if (!Number.isInteger(d.guaranteeCents) || d.guaranteeCents < 0)
    return 'guaranteeCents: non-negative integer required';
  if (!Number.isInteger(d.buyoutCents) || d.buyoutCents < 0)
    return 'buyoutCents: non-negative integer required';
  if (
    d.vsPctAfterCosts !== null &&
    (typeof d.vsPctAfterCosts !== 'number' ||
      d.vsPctAfterCosts < 0 ||
      d.vsPctAfterCosts > 1)
  )
    return 'vsPctAfterCosts: null or 0-1';
  if (!Array.isArray(d.costsOffTop)) return 'costsOffTop: must be array';
  for (const [i, c] of d.costsOffTop.entries()) {
    if (!c || typeof c.label !== 'string')
      return `costsOffTop[${i}].label: string required`;
    if (!Number.isInteger(c.cents) || c.cents < 0)
      return `costsOffTop[${i}].cents: non-negative integer required`;
  }
  return null;
}

export async function GET(req, { params }) {
  if (!(await hasPinCookie(req)))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return NextResponse.json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  const row = getDb()
    .prepare(
      `SELECT guarantee_cents, vs_pct_after_costs, costs_off_top_json, buyout_cents
       FROM show_deals WHERE show_id = ? AND location_id = ?`,
    )
    .get(showId, locationId);
  return NextResponse.json({ deal: row ? parseDeal(row) : null });
}

export async function PUT(req, { params }) {
  if (!(await hasPinCookie(req)))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return NextResponse.json({ error: 'bad show id' }, { status: 400 });

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const dealError = validateDeal(body?.deal);
  if (dealError) return NextResponse.json({ error: dealError }, { status: 422 });
  const cookId =
    typeof body.cookId === 'string' && body.cookId.length > 0
      ? body.cookId
      : 'unknown';

  const locationId = locationFromRequest(req);
  upsertDeal(showId, body.deal, cookId, locationId);
  const summary = getSettlement(showId, locationId);
  return NextResponse.json(summary, { status: 200 });
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-settlement-route.mjs`
Expected: PASS — 5 tests.

- [x] **Step 5: Commit**

```bash
git add app/api/shows/[id]/deal/route.js tests/js/test-settlement-route.mjs
git commit -m "feat(api): /api/shows/[id]/deal GET+PUT (PIN-gated, validated)"
```

---

## Task 7: `/api/shows/[id]/settlement` route

**Files:**
- Create: `app/api/shows/[id]/settlement/route.js`
- Modify: `tests/js/test-settlement-route.mjs` (append)

- [x] **Step 1: Write the failing test**

Append to `tests/js/test-settlement-route.mjs`:

```javascript
const settlementRoute = await import(
  '../../app/api/shows/[id]/settlement/route.js'
);

describe('GET /api/shows/[id]/settlement — auth', () => {
  it('returns 401 with no cookie', async () => {
    const req = new Request('http://localhost/api/shows/1/settlement', {
      method: 'GET',
    });
    const res = await settlementRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 401);
  });
});

describe('GET /api/shows/[id]/settlement — happy path', () => {
  it('returns a SettlementSummary JSON body', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/1/settlement', {
      method: 'GET',
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await settlementRoute.GET(req, { params: { id: '1' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.show.id, 1);
    assert.equal(body.deal.guaranteeCents, 0);
    assert.ok('netDoorCents' in body);
  });

  it('returns 404 for unknown show', async () => {
    const cookie = await validCookie();
    const req = new Request('http://localhost/api/shows/9999/settlement', {
      method: 'GET',
      headers: { cookie: `lariat_pin_ok=${cookie}` },
    });
    const res = await settlementRoute.GET(req, { params: { id: '9999' } });
    assert.equal(res.status, 404);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --experimental-strip-types --test tests/js/test-settlement-route.mjs`
Expected: 3 new failures — module does not exist.

- [x] **Step 3: Write `app/api/shows/[id]/settlement/route.js`**

```javascript
import { NextResponse } from 'next/server';
import { hasPinCookie } from '../../../../../lib/pin.ts';
import { locationFromRequest } from '../../../../../lib/location.ts';
import { getSettlement } from '../../../../../lib/settlementRepo.ts';

export async function GET(req, { params }) {
  if (!(await hasPinCookie(req)))
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const showId = Number(params.id);
  if (!Number.isInteger(showId))
    return NextResponse.json({ error: 'bad show id' }, { status: 400 });
  const locationId = locationFromRequest(req);
  try {
    const summary = getSettlement(showId, locationId);
    return NextResponse.json(summary, { status: 200 });
  } catch (e) {
    if (/not found/.test(String(e?.message)))
      return NextResponse.json({ error: 'show not found' }, { status: 404 });
    throw e;
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test tests/js/test-settlement-route.mjs`
Expected: PASS — 8 tests total.

- [x] **Step 5: Commit**

```bash
git add app/api/shows/[id]/settlement/route.js tests/js/test-settlement-route.mjs
git commit -m "feat(api): /api/shows/[id]/settlement GET (PIN-gated)"
```

---

## Task 8: Settlement page + nav registry

**Files:**
- Create: `app/shows/[id]/settlement/page.jsx`
- Create: `app/shows/[id]/settlement/_components/DealEditor.jsx`
- Modify: `app/_components/navRegistry.js`

- [x] **Step 1: Add the nav-registry entry**

Open `app/_components/navRegistry.js`. Find the existing show-related entries (search for `/shows/`). Add (alphabetically sorted within its section):

```javascript
{
  id: 'show-settlement',
  label: 'Show settlement',
  path: '/shows/[id]/settlement',
  parent: 'shows',
  hint: 'Per-show ticket revenue, deal payout, net door',
  pinRequired: true,
},
```

(Match the surrounding entry shape — copy the keys from the entry above it and adjust.)

- [x] **Step 2: Write the page**

```jsx
// app/shows/[id]/settlement/page.jsx
//
// Server-component read of the SettlementSummary; client-component
// editor PUT-s back via /api/shows/[id]/deal.

import { headers } from 'next/headers';
import { getSettlement } from '../../../../lib/settlementRepo.ts';
import DealEditor from './_components/DealEditor';

function dollars(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export default async function SettlementPage({ params, searchParams }) {
  const showId = Number(params.id);
  // Server-side: location from query; client switches override via URL.
  const locationId = searchParams?.location || 'default';
  let summary;
  try {
    summary = getSettlement(showId, locationId);
  } catch (e) {
    return (
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Settlement</h1>
        <p className="mt-4 text-red-700">Show not found.</p>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{summary.show.bandName}</h1>
        <p className="text-sm text-stone-600">
          {summary.show.date} · location {summary.show.locationId}
        </p>
      </header>

      <section className="border rounded p-4">
        <h2 className="font-medium">Tickets</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Gross</dt>
          <dd className="text-right">{dollars(summary.ticketing.grossCents)}</dd>
          <dt>Fees</dt>
          <dd className="text-right">{dollars(summary.ticketing.feesCents)}</dd>
          <dt className="font-medium">Net</dt>
          <dd className="text-right font-medium">
            {dollars(summary.ticketing.netCents)}
          </dd>
        </dl>
        <div className="mt-3 text-xs text-stone-500">
          {Object.entries(summary.ticketing.bySource).map(([src, v]) =>
            v.qty > 0 ? (
              <span key={src} className="mr-3">
                {src}: {v.qty} ({dollars(v.grossCents)})
              </span>
            ) : null,
          )}
        </div>
      </section>

      <section className="border rounded p-4">
        <h2 className="font-medium">Toast</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Net sales</dt>
          <dd className="text-right">{dollars(summary.toast.totalCents)}</dd>
          <dt>Orders</dt>
          <dd className="text-right">{summary.toast.ordersCount}</dd>
          <dt>Guests</dt>
          <dd className="text-right">{summary.toast.guestsCount}</dd>
        </dl>
        {summary.toast.rowsFound === 0 ? (
          <p className="mt-2 text-xs text-amber-700">
            No Toast rows for {summary.toast.attributionDate} yet — re-check after the daily ingest.
          </p>
        ) : null}
      </section>

      <section className="border rounded p-4">
        <h2 className="font-medium">Talent payout</h2>
        <dl className="grid grid-cols-2 gap-2 mt-2 text-sm">
          <dt>Guarantee</dt>
          <dd className="text-right">{dollars(summary.talent.guaranteeCents)}</dd>
          <dt>vs bonus</dt>
          <dd className="text-right">{dollars(summary.talent.vsBonusCents)}</dd>
          <dt>Buyout</dt>
          <dd className="text-right">{dollars(summary.talent.buyoutCents)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium">
            {dollars(summary.talent.totalCents)}
          </dd>
        </dl>
        <DealEditor showId={summary.show.id} initialDeal={summary.deal} />
      </section>

      <section className="border rounded p-4 bg-stone-50">
        <h2 className="font-medium">Net to door</h2>
        <p className="text-3xl font-semibold mt-2">
          {dollars(summary.netDoorCents)}
        </p>
        <p className="text-xs text-stone-500 mt-1">
          tickets net − costs off top − talent payout
        </p>
      </section>
    </main>
  );
}
```

- [x] **Step 3: Write the deal editor (client component)**

```jsx
// app/shows/[id]/settlement/_components/DealEditor.jsx
'use client';

import { useState } from 'react';

function toCents(dollars) {
  const n = Number(dollars);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export default function DealEditor({ showId, initialDeal }) {
  const [open, setOpen] = useState(false);
  const [guarantee, setGuarantee] = useState(initialDeal.guaranteeCents / 100);
  const [vsPct, setVsPct] = useState(
    initialDeal.vsPctAfterCosts === null
      ? ''
      : String(initialDeal.vsPctAfterCosts),
  );
  const [buyout, setBuyout] = useState(initialDeal.buyoutCents / 100);
  const [costs, setCosts] = useState(
    JSON.stringify(
      initialDeal.costsOffTop.map((c) => ({
        label: c.label,
        dollars: c.cents / 100,
      })),
      null,
      2,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const parsedCosts = JSON.parse(costs).map((c) => ({
        label: c.label,
        cents: toCents(c.dollars),
      }));
      const body = {
        deal: {
          guaranteeCents: toCents(guarantee),
          vsPctAfterCosts: vsPct === '' ? null : Number(vsPct),
          costsOffTop: parsedCosts,
          buyoutCents: toCents(buyout),
        },
        cookId: 'manager',
      };
      const res = await fetch(`/api/shows/${showId}/deal`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      window.location.reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="mt-4 text-sm"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer">Edit deal</summary>
      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="text-xs">Guarantee ($)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={guarantee}
            onChange={(e) => setGuarantee(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">vs % after costs (0–1, blank for flat)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={vsPct}
            onChange={(e) => setVsPct(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">Buyout ($)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={buyout}
            onChange={(e) => setBuyout(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </label>
        <label className="block">
          <span className="text-xs">
            Costs off top — JSON array of {`{label, dollars}`}
          </span>
          <textarea
            rows={4}
            value={costs}
            onChange={(e) => setCosts(e.target.value)}
            className="border rounded px-2 py-1 w-full font-mono text-xs"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            className="border rounded px-3 py-1 bg-stone-900 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save deal'}
          </button>
          {err ? <span className="text-red-700 text-xs">{err}</span> : null}
        </div>
      </div>
    </details>
  );
}
```

- [x] **Step 4: Verify the build typechecks and the page renders**

Run: `npm run typecheck`
Expected: PASS (no type errors).

Run: `npm run dev` (background it: `&` then `disown`), open `http://localhost:3000/shows/1/settlement` after entering the PIN, confirm the page loads with empty values for a freshly-seeded test show.
Expected: page renders, "Edit deal" reveals the editor, save round-trips and re-renders.

(If you're in CI/automated context, skip the manual browser check and rely on the API-route tests from Tasks 6–7.)

- [x] **Step 5: Commit**

```bash
git add app/shows/[id]/settlement app/_components/navRegistry.js
git commit -m "feat(ui): /shows/[id]/settlement page + DealEditor"
```

---

## Task 9: Run the full settlement test slice end-to-end

**Files:** None changed; verification only.

- [x] **Step 1: Run the new test files together**

```bash
node --experimental-strip-types --test \
  tests/js/test-schema-show-deals.mjs \
  tests/js/test-deal-points.mjs \
  tests/js/test-settlement-repo.mjs \
  tests/js/test-settlement-route.mjs
```

Expected: all suites pass — roughly 20+ tests, 0 failures.

- [x] **Step 2: Run the full repo test surface to catch unintended breakage**

```bash
npm run test:schema
npm run test:rules
```

Expected: every existing suite stays green. If `test:schema` fails on the `assertCriticalSchemas` set, add `show_deals` to that set and re-run.

- [x] **Step 3: Re-run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [x] **Step 4: Commit only if any of the above prompted a fix**

```bash
# Only if you needed to add show_deals to assertCriticalSchemas or similar:
git add -p
git commit -m "test(settlement): add show_deals to critical schema assertions"
```

---

## Task 10: PR

**Files:** None changed; PR creation only.

- [x] **Step 1: Push the branch**

```bash
git push -u origin <branch-name>
```

- [x] **Step 2: Open the PR**

Title: `feat(phase2): per-show settlement math (deal points + repo + page)`

Body (paste-able):

```
Phase 2 task B (scope b): deal-point parser + settlement repo + page.

Spec: docs/superpowers/specs/2026-05-01-settlement-math-design.md
Plan: docs/superpowers/plans/2026-05-01-settlement-math.md

What's new
- show_deals table (cents-as-INTEGER) + idempotent migration
- lib/dealPoints.ts: pure-fn parser + computeTalentPayout
  (6 boundary tests: flat, vs-above, vs-below, all-zero, costs>rev, buyout-only)
- lib/settlementRepo.ts: getSettlement aggregating tickets + Toast
  + deal payout + net door; upsertDeal audited via postAuditEvent
  inside the same transaction (verified rollback on FK violation)
- /api/shows/[id]/deal GET+PUT and /api/shows/[id]/settlement GET,
  both PIN-gated at the route layer (curl-replay defense verified)
- /shows/[id]/settlement page + collapsed DealEditor

Out of scope (deferred slices)
- DICE reconciliation (B4 — blocked on Task C)
- PDF export
- Bar/food split of Toast revenue (no source column today)
- Multi-show-per-night attribution

Test plan
- node --experimental-strip-types --test tests/js/test-{schema-show-deals,deal-points,settlement-repo,settlement-route}.mjs
- npm run test:schema && npm run test:rules
- npm run typecheck
- Manual: enter a deal on /shows/1/settlement, confirm net-door updates round-trip
```

---

## Self-Review Notes

- **Spec coverage:** every section of the spec maps to at least one task — schema (Task 1), pure-fn parser/payout (Tasks 2–3), repo with audit (Tasks 4–5), routes (Tasks 6–7), page (Task 8), full-suite verification (Task 9).
- **No placeholders:** every code block contains real implementation. No "implement appropriate validation" hand-waves; the validator function is fully written.
- **Type consistency:** `DealPoint`, `SettlementSummary`, `TicketSource` defined in Tasks 2/5 and referenced consistently in Tasks 6–8. Field names (`guaranteeCents`, `vsPctAfterCosts`, `costsOffTop`) match across tests, repo, route, and page.
- **Acceptance-criteria coverage:** boundary tests (Task 3), repo round-trip (Task 5), PIN-gate curl-replay (Task 6), audit + rollback (Task 4), settlement page render (Task 8), end-to-end suite (Task 9). The "matches a hand-computed receipt" criterion is the manual-smoke step inside Task 8.
