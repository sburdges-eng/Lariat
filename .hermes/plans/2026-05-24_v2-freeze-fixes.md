# V2 Freeze Fixes — Implementation Plan

> **STATUS: PARTIAL (2026-06-15 reconciliation) — done: `dish_coverage_snapshots` table/type, WAL autocheckpoint pragma, 4 `db_query` registry entries. Remaining: KDS bump test, BEO share test, `sagemaker.ts` task (no such file — likely N/A), full verification run.**

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Close all remaining gaps identified in the V2 freeze audit so the codebase can be tagged `v2.0.0`.

**Architecture:** All fixes are surgical — no new systems, no refactors. Each task is an isolated fix to an existing file or a missing test/table/export. Nothing here changes the public API surface.

**Tech Stack:** Next.js 16, better-sqlite3 (WAL), TypeScript, Node test runner, Jest

---

## Task 1: Add `dish_coverage_snapshots` table to db.ts schema

**Objective:** The table is referenced by `lib/dishCoverageSnapshots.ts` (INSERT/SELECT) but never created in `lib/db.ts`. TypeScript error TS2305 because the type isn't exported either.

**Files:**
- Modify: `lib/db.ts` — add CREATE TABLE + export type

**Step 1: Find where other snapshot tables are created in db.ts**

Search for `CREATE TABLE IF NOT EXISTS` near line 2300+ in `lib/db.ts` for placement context.

**Step 2: Add the CREATE TABLE statement**

In `lib/db.ts` inside `initSchema()`, after the last CREATE TABLE block, add:

```sql
CREATE TABLE IF NOT EXISTS dish_coverage_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id   TEXT NOT NULL DEFAULT 'default',
  total_dishes  INTEGER NOT NULL,
  covered_dishes INTEGER NOT NULL,
  coverage_pct  REAL NOT NULL,
  uncovered_dishes TEXT NOT NULL DEFAULT '[]',
  created_by    TEXT NOT NULL DEFAULT 'compute_engine',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Step 3: Add the type export**

In the type-export section of `lib/db.ts` (near where other row types like `SpendMonthly`, `BomLine` etc. are defined), add:

```typescript
export interface DishCoverageSnapshot {
  id: number;
  location_id: string;
  total_dishes: number;
  covered_dishes: number;
  coverage_pct: number;
  uncovered_dishes: string;
  created_by: string;
  created_at: string;
}
```

**Step 4: Verify typecheck passes**

Run: `npx tsc --noEmit 2>&1 | grep -i dish`
Expected: no output (error TS2305 is gone)

**Step 5: Commit**

```bash
git add lib/db.ts
git commit -m "fix: add dish_coverage_snapshots table + type export to db.ts"
```

---

## Task 2: Add WAL auto-checkpoint pragma

**Objective:** WAL file can grow unbounded under load. Add explicit `wal_autocheckpoint` pragma after WAL mode is set in `getDb()`.

**Files:**
- Modify: `lib/db.ts:3590-3595` — add pragma after existing WAL line

**Step 1: Add the pragma**

After line 3594 (`_db.pragma('synchronous = FULL');`), add:

```typescript
  // WAL auto-checkpoint: trigger passive checkpoint every 1000 pages (~4MB).
  // Prevents unbounded WAL growth during heavy write bursts (inventory counts,
  // BEO imports, sync feed replay).
  _db.pragma('wal_autocheckpoint = 1000');
```

**Step 2: Verify DB still opens**

Run: `node -e "require('./lib/db.ts')" 2>&1 || npx tsx -e "import { getDb } from './lib/db.ts'; getDb(); console.log('ok')"`
Expected: "ok"

**Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "fix: add WAL auto-checkpoint pragma (1000 pages / ~4MB)"
```

---

## Task 3: Fix sagemaker.ts TypeScript errors

**Objective:** Two TS errors: missing `@aws-sdk/client-sagemaker-runtime` (TS2307) and unused `_TIMEOUT_MS` (TS6133). SageMaker is an optional runtime dep — fix with proper conditional import pattern.

**Files:**
- Modify: `lib/sagemaker.ts:14-46`

**Step 1: Fix the unused `_TIMEOUT_MS`**

The variable is computed but never referenced. Either use it in the InvokeEndpoint call (preferred) or prefix with underscore properly. Since it's already prefixed with `_`, just add a `// @ts-expect-error` or actually wire it into the InvokeEndpoint options.

Read the full file to find where InvokeEndpointCommand is called, then add the timeout there:

```typescript
// Replace the _TIMEOUT_MS declaration:
const TIMEOUT_MS = Math.min(
  120_000,
  Math.max(5_000, parseInt(process.env.LARIAT_SAGEMAKER_TIMEOUT_MS || '60000', 10) || 60_000),
);
```

Then use `TIMEOUT_MS` in the actual invocation (AbortSignal.timeout).

**Step 2: Fix the missing module error**

Add `@aws-sdk/client-sagemaker-runtime` as an optional peer dependency, or add a `try/catch` dynamic import with a clear error message. Preferred approach — add to package.json as optional:

```bash
npm install --save-optional @aws-sdk/client-sagemaker-runtime
```

Or if you prefer not to add the dep (it's 30MB+), change the static import to dynamic:

```typescript
// At the top of sagemaker.ts, replace the static import:
let SageMakerRuntimeClient: any;
let InvokeEndpointCommand: any;

async function ensureSdk() {
  if (!SageMakerRuntimeClient) {
    try {
      const mod = await import('@aws-sdk/client-sagemaker-runtime');
      SageMakerRuntimeClient = mod.SageMakerRuntimeClient;
      InvokeEndpointCommand = mod.InvokeEndpointCommand;
    } catch {
      throw new Error(
        'SageMaker inference requires @aws-sdk/client-sagemaker-runtime. ' +
        'Install: npm install @aws-sdk/client-sagemaker-runtime'
      );
    }
  }
}
```

Then call `await ensureSdk()` at the top of `sagemakerChat()`.

**Step 3: Verify typecheck**

Run: `npx tsc --noEmit 2>&1 | grep sagemaker`
Expected: no output

**Step 4: Commit**

```bash
git add lib/sagemaker.ts
git commit -m "fix: sagemaker.ts — dynamic SDK import + wire timeout"
```

---

## Task 4: Add KDS bump API test

**Objective:** KDS ticket bump (`/api/kds/tickets/[id]/bump`) is a critical path with no test coverage.

**Files:**
- Create: `tests/js/test-kds-bump.mjs`
- Reference: `app/api/kds/tickets/route.ts`, `app/api/kds/tickets/[id]/bump/route.ts`, `lib/kds.ts`

**Step 1: Read the KDS API routes to understand the contract**

Read `app/api/kds/tickets/route.ts` and `app/api/kds/tickets/[id]/bump/route.ts` for the request/response shape.

**Step 2: Write the test**

```javascript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, resetDb } from '../../lib/db.ts';

// Import KDS functions directly from lib
import { createTicket, bumpTicket, listTickets } from '../../lib/kds.ts';

describe('KDS ticket bump', () => {
  before(() => {
    resetDb(':memory:');
  });

  it('creates a ticket and bumps it through lifecycle', () => {
    const db = getDb();
    // Create a ticket
    const ticket = createTicket({
      orderNumber: 'T-001',
      items: [{ name: 'Burger', qty: 1, mods: '' }],
      locationId: 'default',
    });
    assert.ok(ticket.id, 'ticket has an id');

    // Bump it
    const bumped = bumpTicket(ticket.id);
    assert.equal(bumped.status, 'bumped');

    // Verify it no longer appears in active list
    const active = listTickets({ locationId: 'default', status: 'open' });
    const found = active.find((t) => t.id === ticket.id);
    assert.ok(!found || found.status !== 'open', 'bumped ticket is not open');
  });

  it('rejects bump on non-existent ticket', () => {
    assert.throws(() => bumpTicket(999999), /not found|no.*ticket/i);
  });
});
```

Note: Adjust imports and function signatures after reading the actual KDS source. The test structure is correct but the exact function names/args must match the real code.

**Step 3: Run the test**

Run: `node --import tsx --test tests/js/test-kds-bump.mjs`
Expected: 2 passed

**Step 4: Commit**

```bash
git add tests/js/test-kds-bump.mjs
git commit -m "test: add KDS ticket bump lifecycle test"
```

---

## Task 5: Add BEO share-flow test

**Objective:** BEO share token generation and retrieval (`/api/beo/[id]/share-token` + `/api/beo/share/[token]`) has no test coverage.

**Files:**
- Create: `tests/js/test-beo-share.mjs`
- Reference: `lib/beoShare.ts`, `app/api/beo/[id]/share-token/route.ts`, `app/api/beo/share/[token]/route.ts`

**Step 1: Read the BEO share source**

Read `lib/beoShare.ts` and the API routes to understand the share token contract.

**Step 2: Write the test**

```javascript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, resetDb } from '../../lib/db.ts';
import {
  generateShareToken,
  getEventByShareToken,
} from '../../lib/beoShare.ts';

describe('BEO share flow', () => {
  before(() => {
    resetDb(':memory:');
    // Seed a BEO event
    const db = getDb();
    db.prepare(`INSERT INTO beo_events (id, event_name, event_date, guest_count, location_id, status)
                VALUES (1, 'Test Wedding', '2026-06-01', 120, 'default', 'confirmed')`).run();
  });

  it('generates a share token for an event', () => {
    const token = generateShareToken(1);
    assert.ok(token, 'token is truthy');
    assert.ok(token.length >= 16, 'token is long enough to be secure');
  });

  it('retrieves event by share token', () => {
    const token = generateShareToken(1);
    const event = getEventByShareToken(token);
    assert.ok(event, 'event found');
    assert.equal(event.event_name, 'Test Wedding');
  });

  it('returns null for invalid token', () => {
    const result = getEventByShareToken('bogus-token-does-not-exist');
    assert.equal(result, null);
  });
});
```

Note: Adjust function names/imports after reading the actual source.

**Step 3: Run the test**

Run: `node --import tsx --test tests/js/test-beo-share.mjs`
Expected: 3 passed

**Step 4: Commit**

```bash
git add tests/js/test-beo-share.mjs
git commit -m "test: add BEO share token generation + retrieval test"
```

---

## Task 6: Add 4 missing db_query registry entries

**Objective:** The freeze audit identified 4 high-value queries missing from the LaRi db_query registry: `recipe_with_bom`, `sales_depletion_unresolved`, `beo_prep_status`, `equipment_maintenance_due`.

**Files:**
- Modify: `lib/dbQueryRegistry.ts` — add 4 new query specs
- Modify: `tests/js/test-db-query-tool.mjs` — add smoke tests for new queries

**Step 1: Read existing registry for naming conventions**

Read `lib/dbQueryRegistry.ts` fully. Note the tier system, param patterns, SQL conventions.

**Step 2: Add `recipe_with_bom` query**

In the manager-tier section of `dbQueryRegistry.ts`:

```typescript
{
  name: 'recipe_with_bom',
  tier: 'manager',
  description: 'Full recipe with BOM lines: ingredient, vendor, pack price, unit cost, qty.',
  locationScoped: false,
  rowCap: 100,
  params: [
    { name: 'recipe_id', type: 'string', required: true, maxLength: 128, description: 'Recipe slug (e.g. chicken-parm).' },
  ],
  sql: `
    SELECT
      r.recipe_id, r.recipe_name, r.batch_cost, r.portion_cost,
      b.ingredient, b.qty, b.unit,
      vp.vendor, vp.pack_price, vp.unit_price, vp.pack_size, vp.pack_unit
    FROM recipe_costs r
    JOIN bom_lines b ON b.recipe_id = r.recipe_id
    LEFT JOIN vendor_prices vp ON vp.master_id = b.master_id
    WHERE r.recipe_id = :recipe_id
    ORDER BY b.ingredient
  `,
},
```

**Step 3: Add `sales_depletion_unresolved` query**

```typescript
{
  name: 'sales_depletion_unresolved',
  tier: 'manager',
  description: 'Menu items sold but not linked to any recipe (depletion cannot compute usage).',
  locationScoped: true,
  rowCap: 100,
  params: [
    { name: 'period', type: 'string', required: false, maxLength: 32, description: 'Period label filter (e.g. 2026-W20). Omit for all periods.' },
  ],
  sql: `
    SELECT DISTINCT
      sl.item_name, sl.period_label, sl.qty_sold, sl.net_sales
    FROM sales_lines sl
    LEFT JOIN dish_components dc ON dc.dish_name = sl.item_name
    WHERE dc.id IS NULL
      AND sl.location_id = :location_id
      AND (:period IS NULL OR sl.period_label = :period)
    ORDER BY sl.net_sales DESC
  `,
},
```

**Step 4: Add `beo_prep_status` query**

```typescript
{
  name: 'beo_prep_status',
  tier: 'cook',
  description: 'Prep tasks for an upcoming BEO event with completion status.',
  locationScoped: true,
  rowCap: 60,
  params: [
    { name: 'event_id', type: 'integer', required: true, min: 1, description: 'BEO event ID.' },
  ],
  sql: `
    SELECT
      bt.id, bt.task, bt.assigned_cook_id, bt.status,
      bt.due_date, bt.completed_at,
      be.event_name, be.event_date
    FROM beo_tasks bt
    JOIN beo_events be ON be.id = bt.event_id
    WHERE bt.event_id = :event_id
      AND be.location_id = :location_id
    ORDER BY bt.due_date, bt.id
  `,
},
```

**Step 5: Add `equipment_maintenance_due` query**

```typescript
{
  name: 'equipment_maintenance_due',
  tier: 'manager',
  description: 'Equipment with maintenance due or overdue (next service date <= today + N days).',
  locationScoped: true,
  rowCap: 40,
  params: [
    { name: 'lookahead_days', type: 'integer', required: false, min: 0, max: 90, description: 'Days ahead to look. Default 7.' },
  ],
  sql: `
    SELECT
      e.id, e.name, e.location, e.model, e.serial,
      ms.service_type, ms.next_due,
      CAST(round(julianday(ms.next_due) - julianday('now')) AS INTEGER) AS days_until_due
    FROM equipment e
    JOIN maintenance_schedule ms ON ms.equipment_id = e.id
    WHERE e.location_id = :location_id
      AND ms.next_due <= date('now', '+' || COALESCE(:lookahead_days, 7) || ' days')
    ORDER BY ms.next_due
  `,
},
```

**Step 6: Add smoke tests for new queries**

In `tests/js/test-db-query-tool.mjs`, add test cases that verify each new query name is in the registry and that the SQL parses without error:

```javascript
for (const name of [
  'recipe_with_bom',
  'sales_depletion_unresolved',
  'beo_prep_status',
  'equipment_maintenance_due',
]) {
  it(`registry contains ${name}`, () => {
    const spec = registry.find((q) => q.name === name);
    assert.ok(spec, `${name} not found in registry`);
    // Verify SQL parses (prepare against in-memory db)
    assert.doesNotThrow(() => db.prepare(spec.sql));
  });
}
```

**Step 7: Run tests**

Run: `node --import tsx --test tests/js/test-db-query-tool.mjs`
Expected: all pass (including 4 new)

**Step 8: Commit**

```bash
git add lib/dbQueryRegistry.ts tests/js/test-db-query-tool.mjs
git commit -m "feat: add 4 db_query registry entries (recipe_with_bom, depletion, beo_prep, equipment)"
```

---

## Task 7: Verify full test suite passes

**Objective:** Run all tests and typecheck to confirm zero regressions from Tasks 1–6.

**Files:** None (verification only)

**Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: 0 errors (all 3 prior errors resolved)

**Step 2: Jest tests**

Run: `npx jest --ci`
Expected: 17 suites, 96+ tests, all passing

**Step 3: Node test runner**

Run: `node --import tsx --test tests/js/*.mjs`
Expected: all passing (including new KDS + BEO + db_query tests)

**Step 4: Production build**

Run: `npm run build`
Expected: clean build, no errors

**Step 5: Commit verification marker**

```bash
git commit --allow-empty -m "chore: v2 freeze pre-checks pass — tsc 0 errors, all tests green, build clean"
```

---

## Task 8: Update freeze plan + tag

**Objective:** Mark all P1 items as done in the freeze plan, update the checklist, prepare for tag.

**Files:**
- Modify: `.hermes/plans/2026-05-24_045500-v2-freeze-plan.md` — update status
- Create: `CHANGELOG.md` (if not exists) — V2 release notes

**Step 1: Update freeze plan checklist**

Mark completed items in section 4:

```markdown
- [x] Items 1-5 from "improvements" table above are merged
- [x] All tests pass
- [x] `npm run build` succeeds
- [ ] `lari-qwen` model runs on fresh Ollama install (document in SETUP.md)
- [ ] SageMaker teardown script verified
- [ ] Electron `npm run build:webpack` + notarize succeeds
- [ ] PWA offline smoke test passes
- [ ] docs/PROJECT_ROADMAP.md updated
- [ ] CHANGELOG.md written
- [ ] Git tag `v2.0.0` on clean main
```

**Step 2: Write CHANGELOG.md**

Create `CHANGELOG.md` with a V2 feature summary derived from the inventory in the freeze plan.

**Step 3: Commit**

```bash
git add .hermes/plans/ CHANGELOG.md
git commit -m "docs: update V2 freeze checklist + CHANGELOG"
```

---

## Summary of V2 Freeze Status

### COMPLETE (ship as-is) — 21 major systems

| # | System | Verdict |
|---|--------|---------|
| 1 | Kitchen Assistant AI (LaRi + Qwen 2.5 7B) | FREEZE |
| 2 | HACCP Rule Engine (13 modules) | FREEZE |
| 3 | Compute Engine (costing, margin, depletion, ABC) | FREEZE |
| 4 | Recipe System (73 recipes, BOM, sub-recipe graph) | FREEZE |
| 5 | Menu Engineering (margin deltas, dish components) | FREEZE |
| 6 | Inventory (counts, par, depletion) | FREEZE |
| 7 | 86 Board | FREEZE |
| 8 | Prep Board + Fire Schedule | FREEZE |
| 9 | Station Checklists + Line Checks | FREEZE |
| 10 | BEO / Events | FREEZE |
| 11 | Shows / Settlement / Box Office | FREEZE |
| 12 | Labor Compliance (breaks, sick leave, tip pool, wage) | FREEZE |
| 13 | Peer Sync (mDNS, hub election, failover) | FREEZE |
| 14 | Cloud Bridge (push/pull, dead letters) | FREEZE |
| 15 | Idempotency Layer | FREEZE |
| 16 | PIN Auth + Temp PINs | FREEZE |
| 17 | KDS Protocol | FREEZE |
| 18 | Data Pack (USDA, FDA, OFF, Wikibooks, FlavorDB) | FREEZE |
| 19 | ETL Pipelines (Toast, Shamrock, Sysco, 7shifts) | FREEZE |
| 20 | Electron Desktop | FREEZE |
| 21 | PWA + Offline Queue | FREEZE |

### FIX BEFORE FREEZE — 7 tasks in this plan

| Task | Effort | Risk |
|------|--------|------|
| 1. DishCoverageSnapshot table + type | S (15 min) | Low |
| 2. WAL auto-checkpoint pragma | S (5 min) | Low |
| 3. sagemaker.ts TS errors | S (15 min) | Low |
| 4. KDS bump test | M (30 min) | Low |
| 5. BEO share-flow test | M (30 min) | Low |
| 6. 4 db_query registry entries | M (45 min) | Low |
| 7. Full test suite verification | S (10 min) | None |

### OUT — deferred to V3+

- Multi-turn conversations
- Voice input (Whisper)
- UI v2 shell migration
- Multi-venue rollout
- HACCP PDF generator
- i18n (Spanish)
- Specials → menu engineering pipeline
- Operator analytics dashboard
- Allergen verification (manager attestation)
- Summarization for large query results

### Open Questions for Sean (from freeze audit)

1. Ship Q8_0 (better quality, 8.1GB) or Q4_K_M (faster, 4.7GB) as default model?
2. Is the live-music venue arm (shows/box-office) in active use? If not, deprecate for V3.
3. V2 release timeline: freeze now, or after the 7 tasks above?
