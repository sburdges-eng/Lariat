# Specials Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manager-curated persistence layer to the existing Specials sandbox: save sessions, list/edit/soft-delete them, and export them as workbook-pasteable CSVs — all PIN-gated under `/specials/saved/*`. The existing `/specials` chat surface stays unchanged and stays open to line cooks.

**Architecture:** New `specials` table for session snapshots. Pure validators (`lib/specialsValidators.ts`) and a pure CSV builder (`lib/specialsExport.ts`) keep route files thin and unit-testable. Five API routes wrap the table; export produces a CSV but never writes to recipe DB tables (the workbook-as-source-of-truth invariant is preserved). Two new pages render list and detail views; the existing `/specials` page gets a "Save this special" button. Middleware gates the new paths via the existing `SENSITIVE_PREFIXES` array.

**Tech Stack:** Next.js 14 App Router, React 18, better-sqlite3 (WAL), Node test runner with in-memory SQLite (no mocks), Jest+jsdom for component tests, TypeScript with `--experimental-strip-types` for `.ts` imports in `node --test`.

**Spec:** `docs/superpowers/specs/2026-05-01-specials-persistence-design.md`

---

## File Structure

**Create:**
- `lib/specialsValidators.ts` — pure validators (name, slug, yield, allowed-PATCH keys, JSON shape)
- `lib/specialsExport.ts` — pure CSV builder (RFC 4180 escaping, two-section format)
- `app/api/specials/saved/route.js` — POST (create), GET (list)
- `app/api/specials/saved/[id]/route.js` — GET (detail), PATCH (name + scratch_notes only), DELETE (soft)
- `app/api/specials/saved/[id]/export/route.js` — POST (build CSV, bump last_exported_at)
- `app/specials/saved/page.jsx` — server component, list view
- `app/specials/saved/[id]/page.jsx` — server component, detail wrapper
- `app/specials/saved/[id]/SpecialDetailClient.jsx` — client component, edit/delete/export UI
- `tests/js/test-specials-saved-rules.mjs` — pure-validator tests
- `tests/js/test-specials-saved-api.mjs` — round-trip API tests against in-memory SQLite
- `tests/js/test-specials-export.mjs` — CSV builder tests + export-route last_exported_at semantics
- `app/__tests__/SpecialsPageSave.test.jsx` — Jest+jsdom test for the save button + form

**Modify:**
- `lib/db.ts` — add `specials` table block to `initSchema` (do not edit existing DDL in place)
- `app/api/specials/route.js` — add `cost_breakdown` and `cost_total` to the JSON response
- `app/specials/page.jsx` — capture cost/sources from response, add Save button + form
- `app/_components/navRegistry.js` — add `specials-saved` entry under `Service` group
- `middleware.js` — add `/specials/saved` and `/api/specials/saved` to `SENSITIVE_PREFIXES`

**File audit fn:** `logAuditAction({action, …})` from `lib/auditLog.mjs`. Action strings: `specials.create`, `specials.update`, `specials.delete`, `specials.export`.

**UUID helper:** `uuidv7()` from `lib/uuid.ts`.

**DB test setup:** `setDbPathForTest()` + `getDb()` from `lib/db.ts`; tests register the `.ts`-aware resolver via `register(new URL('./resolver.mjs', import.meta.url))`.

---

## Task 0: Worktree setup (manual, one-time)

**Files:** none (env setup only)

- [ ] **Step 1: Create the worktree per Lariat protocol**

```bash
scripts/worktree.sh new claude specials-persistence
cd ../Lariat-worktrees/claude-specials-persistence
```

This locks the implementer to branch `feat/specials-persistence` (the pre-commit guard refuses commits if HEAD drifts). All subsequent tasks run from the worktree root.

- [ ] **Step 2: Verify clean tree**

Run: `git status`
Expected: `On branch feat/specials-persistence` and `nothing to commit, working tree clean`.

---

## Task 1: Schema migration

**Files:**
- Modify: `lib/db.ts` — append a new block to `initSchema` (do not edit existing DDL)
- Test: covered indirectly by `npm run test:schema` and Task 4 API tests; no new test file in this task

- [ ] **Step 1: Locate the end of `initSchema` in `lib/db.ts`**

Use `grep -n "initSchema\|initFoodSafetyLaborSchema" lib/db.ts | head` to find the boundary. Append the new `db.exec` block immediately before the closing of `initSchema`. Do **not** modify any existing CREATE TABLE / CREATE INDEX statement.

- [ ] **Step 2: Add the `specials` table**

Append this block inside `initSchema`:

```ts
  db.exec(`
    CREATE TABLE IF NOT EXISTS specials (
      id                 TEXT PRIMARY KEY,
      location_id        TEXT NOT NULL DEFAULT 'default',
      name               TEXT NOT NULL,
      pantry_text        TEXT NOT NULL DEFAULT '',
      prompt_text        TEXT NOT NULL DEFAULT '',
      ai_answer          TEXT NOT NULL DEFAULT '',
      ai_model           TEXT NOT NULL DEFAULT '',
      cost_breakdown     TEXT,
      cost_total         REAL,
      scratch_notes      TEXT NOT NULL DEFAULT '',
      sources            TEXT,
      last_exported_at   INTEGER,
      created_at         INTEGER NOT NULL,
      updated_at         INTEGER NOT NULL,
      archived_at        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_specials_loc_created
      ON specials(location_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_specials_active
      ON specials(location_id, archived_at) WHERE archived_at IS NULL;
  `);
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Run schema test**

Run: `npm run test:schema`
Expected: passes. The `IF NOT EXISTS` clauses make the migration idempotent against an existing DB.

- [ ] **Step 5: Sanity-check the new table on a fresh DB**

```bash
node -e "
const db = require('./lib/db.ts');
db.setDbPathForTest('/tmp/lariat-schema-check.db');
const d = db.getDb();
console.log(d.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='specials'\").all());
console.log(d.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='specials'\").all());
db.setDbPathForTest(null);
" --experimental-strip-types
```

Expected: prints `[ { name: 'specials' } ]` and the two index rows.

- [ ] **Step 6: Commit**

```bash
git add lib/db.ts
git commit -m "feat(specials): add specials table for persistence

Holds session snapshots from the sandbox chat — pantry, prompt, AI
answer, captured cost breakdown, scratch notes, and grounding sources
— plus soft-delete (archived_at) and export tracking
(last_exported_at). Indexed by (location_id, created_at) and a
partial index on active rows only.
"
```

---

## Task 2: Pure validators

**Files:**
- Create: `lib/specialsValidators.ts`
- Test: `tests/js/test-specials-saved-rules.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/js/test-specials-saved-rules.mjs`:

```javascript
#!/usr/bin/env node
// Tests for lib/specialsValidators — pure validators with no DB or HTTP.
// Run: node --experimental-strip-types --test tests/js/test-specials-saved-rules.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const v = await import('../../lib/specialsValidators.ts');

describe('validateName', () => {
  it('accepts a 1-char name', () => {
    assert.deepEqual(v.validateName('A'), { ok: true, value: 'A' });
  });
  it('accepts a 200-char name', () => {
    assert.equal(v.validateName('x'.repeat(200)).ok, true);
  });
  it('trims whitespace', () => {
    assert.deepEqual(v.validateName('  Pork Belly App  '), { ok: true, value: 'Pork Belly App' });
  });
  it('rejects empty string', () => {
    assert.equal(v.validateName('').ok, false);
  });
  it('rejects whitespace-only', () => {
    assert.equal(v.validateName('   ').ok, false);
  });
  it('rejects 201-char', () => {
    assert.equal(v.validateName('x'.repeat(201)).ok, false);
  });
  it('rejects non-string', () => {
    assert.equal(v.validateName(null).ok, false);
    assert.equal(v.validateName(undefined).ok, false);
    assert.equal(v.validateName(123).ok, false);
  });
});

describe('validateSlug', () => {
  it('accepts lowercase-hyphen', () => {
    assert.deepEqual(v.validateSlug('pork-belly-app'), { ok: true, value: 'pork-belly-app' });
  });
  it('accepts digits', () => {
    assert.equal(v.validateSlug('beef-100').ok, true);
  });
  it('rejects uppercase', () => {
    assert.equal(v.validateSlug('Pork-Belly').ok, false);
  });
  it('rejects spaces', () => {
    assert.equal(v.validateSlug('pork belly').ok, false);
  });
  it('rejects underscores', () => {
    assert.equal(v.validateSlug('pork_belly').ok, false);
  });
  it('rejects empty', () => {
    assert.equal(v.validateSlug('').ok, false);
  });
  it('rejects > 80 chars', () => {
    assert.equal(v.validateSlug('a'.repeat(81)).ok, false);
  });
  it('accepts 80 chars', () => {
    assert.equal(v.validateSlug('a'.repeat(80)).ok, true);
  });
});

describe('validateYieldQty', () => {
  it('accepts a positive number', () => {
    assert.deepEqual(v.validateYieldQty(12), { ok: true, value: 12 });
  });
  it('accepts a fractional positive', () => {
    assert.equal(v.validateYieldQty(0.001).ok, true);
  });
  it('rejects zero', () => {
    assert.equal(v.validateYieldQty(0).ok, false);
  });
  it('rejects negative', () => {
    assert.equal(v.validateYieldQty(-1).ok, false);
  });
  it('rejects NaN', () => {
    assert.equal(v.validateYieldQty(NaN).ok, false);
  });
  it('rejects Infinity', () => {
    assert.equal(v.validateYieldQty(Infinity).ok, false);
  });
  it('rejects strings', () => {
    assert.equal(v.validateYieldQty('12').ok, false);
  });
});

describe('validateYieldUnit', () => {
  it('accepts a 1-char unit', () => {
    assert.deepEqual(v.validateYieldUnit('g'), { ok: true, value: 'g' });
  });
  it('trims whitespace', () => {
    assert.deepEqual(v.validateYieldUnit('  portions  '), { ok: true, value: 'portions' });
  });
  it('rejects empty', () => {
    assert.equal(v.validateYieldUnit('').ok, false);
    assert.equal(v.validateYieldUnit('   ').ok, false);
  });
  it('rejects > 32 chars', () => {
    assert.equal(v.validateYieldUnit('x'.repeat(33)).ok, false);
  });
});

describe('validatePatchKeys', () => {
  it('accepts name only', () => {
    assert.deepEqual(v.validatePatchKeys({ name: 'X' }), { ok: true, rejected: [] });
  });
  it('accepts scratch_notes only', () => {
    assert.deepEqual(v.validatePatchKeys({ scratch_notes: 'X' }), { ok: true, rejected: [] });
  });
  it('accepts both', () => {
    assert.equal(v.validatePatchKeys({ name: 'X', scratch_notes: 'Y' }).ok, true);
  });
  it('rejects unknown keys', () => {
    const r = v.validatePatchKeys({ name: 'X', ai_answer: 'Z', cost_total: 5 });
    assert.equal(r.ok, false);
    assert.deepEqual(r.rejected.sort(), ['ai_answer', 'cost_total']);
  });
  it('rejects empty body', () => {
    assert.equal(v.validatePatchKeys({}).ok, false);
  });
});

describe('coerceJsonField', () => {
  it('accepts an object', () => {
    assert.deepEqual(v.coerceJsonField({ a: 1 }), { ok: true, value: '{"a":1}' });
  });
  it('accepts an array', () => {
    assert.deepEqual(v.coerceJsonField([{ a: 1 }]), { ok: true, value: '[{"a":1}]' });
  });
  it('accepts a valid JSON string', () => {
    assert.deepEqual(v.coerceJsonField('{"a":1}'), { ok: true, value: '{"a":1}' });
  });
  it('rejects a non-JSON string', () => {
    assert.equal(v.coerceJsonField('not json').ok, false);
  });
  it('treats null/undefined as no-op', () => {
    assert.deepEqual(v.coerceJsonField(null), { ok: true, value: null });
    assert.deepEqual(v.coerceJsonField(undefined), { ok: true, value: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-rules.mjs`
Expected: FAIL with "Cannot find module" for `lib/specialsValidators.ts`.

- [ ] **Step 3: Create `lib/specialsValidators.ts`**

```ts
// Pure validators for the specials persistence layer. No I/O, no DB,
// no HTTP — every consumer is responsible for surfacing the error
// shape it needs.

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const NAME_MIN = 1;
const NAME_MAX = 200;
const SLUG_RE = /^[a-z0-9-]+$/;
const SLUG_MAX = 80;
const YIELD_UNIT_MAX = 32;

const ALLOWED_PATCH_KEYS = new Set(['name', 'scratch_notes']);

export function validateName(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'name must be a string' };
  const trimmed = input.trim();
  if (trimmed.length < NAME_MIN) return { ok: false, error: 'name required' };
  if (trimmed.length > NAME_MAX) return { ok: false, error: `name max ${NAME_MAX} chars` };
  return { ok: true, value: trimmed };
}

export function validateSlug(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'slug must be a string' };
  if (input.length < 1 || input.length > SLUG_MAX) {
    return { ok: false, error: `slug 1–${SLUG_MAX} chars` };
  }
  if (!SLUG_RE.test(input)) return { ok: false, error: 'slug must match ^[a-z0-9-]+$' };
  return { ok: true, value: input };
}

export function validateYieldQty(input: unknown): Result<number> {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return { ok: false, error: 'yield_qty must be a positive finite number' };
  }
  return { ok: true, value: input };
}

export function validateYieldUnit(input: unknown): Result<string> {
  if (typeof input !== 'string') return { ok: false, error: 'yield_unit must be a string' };
  const trimmed = input.trim();
  if (trimmed.length < 1) return { ok: false, error: 'yield_unit required' };
  if (trimmed.length > YIELD_UNIT_MAX) {
    return { ok: false, error: `yield_unit max ${YIELD_UNIT_MAX} chars` };
  }
  return { ok: true, value: trimmed };
}

export type PatchKeyResult = { ok: true; rejected: [] } | { ok: false; rejected: string[] };

export function validatePatchKeys(body: Record<string, unknown>): PatchKeyResult {
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, rejected: [] };
  const rejected = keys.filter((k) => !ALLOWED_PATCH_KEYS.has(k));
  if (rejected.length > 0) return { ok: false, rejected };
  return { ok: true, rejected: [] };
}

export function coerceJsonField(input: unknown): Result<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input === 'string') {
    try {
      JSON.parse(input);
      return { ok: true, value: input };
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
  }
  if (typeof input === 'object') {
    try {
      return { ok: true, value: JSON.stringify(input) };
    } catch {
      return { ok: false, error: 'not serializable' };
    }
  }
  return { ok: false, error: 'must be JSON string, object, or null' };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-rules.mjs`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add lib/specialsValidators.ts tests/js/test-specials-saved-rules.mjs
git commit -m "feat(specials): pure validators for the persistence layer

name, slug, yield_qty, yield_unit, allowed-PATCH-keys, and JSON-field
coercion. Result<T> envelope so callers (route, page) can surface the
right error shape per surface.
"
```

---

## Task 3: Pure CSV exporter

**Files:**
- Create: `lib/specialsExport.ts`
- Test: `tests/js/test-specials-export.mjs`

- [ ] **Step 1: Write the failing test file**

Create `tests/js/test-specials-export.mjs`:

```javascript
#!/usr/bin/env node
// Tests for lib/specialsExport — pure CSV builder and helpers.
// Route-level last_exported_at semantics are tested in test-specials-saved-api.mjs.
// Run: node --experimental-strip-types --test tests/js/test-specials-export.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ex = await import('../../lib/specialsExport.ts');

describe('escapeCsvField', () => {
  it('returns plain text unchanged', () => {
    assert.equal(ex.escapeCsvField('plain'), 'plain');
  });
  it('quotes fields with commas', () => {
    assert.equal(ex.escapeCsvField('a,b'), '"a,b"');
  });
  it('quotes fields with newlines', () => {
    assert.equal(ex.escapeCsvField('line1\nline2'), '"line1\nline2"');
  });
  it('doubles embedded quotes and wraps', () => {
    assert.equal(ex.escapeCsvField('he said "hi"'), '"he said ""hi"""');
  });
  it('returns empty for null/undefined', () => {
    assert.equal(ex.escapeCsvField(null), '');
    assert.equal(ex.escapeCsvField(undefined), '');
  });
  it('coerces numbers to strings', () => {
    assert.equal(ex.escapeCsvField(12.5), '12.5');
  });
});

describe('mapCostBreakdownToIngredientRows', () => {
  const breakdown = [
    { item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco Pork Belly Skin-On', pack_size: 10, pack_unit: 'lb', pack_price: 50, cost: 10 },
    { item: 'Tomato (soft)', req_qty: 0.5, req_unit: 'case', match: '', pack_size: null, pack_unit: null, pack_price: null, cost: null, note: 'no vendor match' },
  ];

  it('maps matched and unmatched rows', () => {
    const rows = ex.mapCostBreakdownToIngredientRows(breakdown);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      ingredient: 'Pork Belly', qty: 2, unit: 'lb',
      vendor_match: 'Sysco Pork Belly Skin-On', note: '',
    });
    assert.deepEqual(rows[1], {
      ingredient: 'Tomato (soft)', qty: 0.5, unit: 'case',
      vendor_match: '', note: 'unmatched — pick a vendor item before paste',
    });
  });

  it('handles partial rows defensively', () => {
    const rows = ex.mapCostBreakdownToIngredientRows([{ item: 'X' }]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ingredient, 'X');
    assert.equal(rows[0].qty, '');
    assert.equal(rows[0].unit, '');
    assert.equal(rows[0].vendor_match, '');
    assert.equal(rows[0].note, 'unmatched — pick a vendor item before paste');
  });

  it('returns [] for null or non-array input', () => {
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows(null), []);
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows('not array'), []);
    assert.deepEqual(ex.mapCostBreakdownToIngredientRows([]), []);
  });
});

describe('selectSkippedRows', () => {
  it('returns only unmatched rows', () => {
    const rows = [
      { ingredient: 'A', qty: 1, unit: 'lb', vendor_match: 'X', note: '' },
      { ingredient: 'B', qty: 2, unit: 'lb', vendor_match: '', note: 'unmatched — pick a vendor item before paste' },
    ];
    assert.deepEqual(ex.selectSkippedRows(rows), [rows[1]]);
  });
});

describe('stripCostMarkdown', () => {
  it('strips a trailing > [!NOTE] block', () => {
    const ans = 'Sear belly.\nSeason it.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00\n>\n> | x | y |\n';
    assert.equal(ex.stripCostMarkdown(ans), 'Sear belly.\nSeason it.');
  });
  it('strips a trailing > [!WARNING] block', () => {
    const ans = 'Sear belly.\n\n> [!WARNING]\n> Could not compute deterministic cost: foo';
    assert.equal(ex.stripCostMarkdown(ans), 'Sear belly.');
  });
  it('leaves answers without cost blocks alone', () => {
    assert.equal(ex.stripCostMarkdown('Plain answer.'), 'Plain answer.');
  });
});

describe('buildExportCsv', () => {
  it('produces a two-section CSV with the expected headers', () => {
    const csv = ex.buildExportCsv({
      recipe_row: {
        slug: 'pork-belly-app', display_name: 'Pork Belly App',
        yield_qty: 12, yield_unit: 'portions', category: 'appetizer',
        procedure: 'Sear belly.',
      },
      ingredient_rows: [
        { ingredient: 'Pork Belly', qty: 2, unit: 'lb', vendor_match: 'Sysco', note: '' },
      ],
    });
    assert.match(csv, /^# RECIPE\nslug,display_name,yield_qty,yield_unit,category,procedure\n/);
    assert.match(csv, /pork-belly-app,Pork Belly App,12,portions,appetizer,Sear belly\./);
    assert.match(csv, /\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n/);
    assert.match(csv, /Pork Belly,2,lb,Sysco,/);
  });

  it('escapes commas, quotes, and newlines RFC-4180', () => {
    const csv = ex.buildExportCsv({
      recipe_row: {
        slug: 's', display_name: 'A, B "C"', yield_qty: 1, yield_unit: 'ea',
        category: '', procedure: 'line1\nline2',
      },
      ingredient_rows: [],
    });
    assert.match(csv, /"A, B ""C""","line1\nline2"/);
  });

  it('handles empty ingredient list', () => {
    const csv = ex.buildExportCsv({
      recipe_row: { slug: 's', display_name: 'X', yield_qty: 1, yield_unit: 'ea', category: '', procedure: '' },
      ingredient_rows: [],
    });
    assert.match(csv, /\n\n# INGREDIENTS\ningredient,qty,unit,vendor_match,note\n$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-specials-export.mjs`
Expected: FAIL with "Cannot find module" for `lib/specialsExport.ts`.

- [ ] **Step 3: Create `lib/specialsExport.ts`**

```ts
// Pure CSV builder and helpers for the specials export pipeline.
// No I/O, no DB. The route layer is responsible for read/write side-effects.

export interface IngredientRow {
  ingredient: string;
  qty: number | string;
  unit: string;
  vendor_match: string;
  note: string;
}

export interface RecipeRow {
  slug: string;
  display_name: string;
  yield_qty: number;
  yield_unit: string;
  category: string;
  procedure: string;
}

const UNMATCHED_NOTE = 'unmatched — pick a vendor item before paste';

const RECIPE_HEADER = 'slug,display_name,yield_qty,yield_unit,category,procedure';
const INGREDIENT_HEADER = 'ingredient,qty,unit,vendor_match,note';

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function joinRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function mapCostBreakdownToIngredientRows(breakdown: unknown): IngredientRow[] {
  if (!Array.isArray(breakdown)) return [];
  return breakdown.map((row: any) => {
    const matched = typeof row?.match === 'string' && row.match.length > 0 && row?.cost !== null && row?.cost !== undefined;
    return {
      ingredient: typeof row?.item === 'string' ? row.item : '',
      qty: row?.req_qty ?? '',
      unit: typeof row?.req_unit === 'string' ? row.req_unit : '',
      vendor_match: matched ? row.match : '',
      note: matched ? '' : UNMATCHED_NOTE,
    };
  });
}

export function selectSkippedRows(rows: IngredientRow[]): IngredientRow[] {
  return rows.filter((r) => r.note === UNMATCHED_NOTE);
}

// Strip a trailing GitHub-style markdown blockquote (> [!NOTE] / > [!WARNING])
// emitted by the cost_special action handler. Anything before that block is
// kept verbatim — chefs may want it as procedure prose.
export function stripCostMarkdown(answer: string): string {
  if (typeof answer !== 'string') return '';
  const idx = answer.search(/\n\n> \[!(NOTE|WARNING)\]/);
  if (idx < 0) return answer;
  return answer.slice(0, idx).trimEnd();
}

export function buildExportCsv(input: { recipe_row: RecipeRow; ingredient_rows: IngredientRow[] }): string {
  const r = input.recipe_row;
  const recipeBody = joinRow([r.slug, r.display_name, r.yield_qty, r.yield_unit, r.category, r.procedure]);
  const ingredientBody = input.ingredient_rows
    .map((row) => joinRow([row.ingredient, row.qty, row.unit, row.vendor_match, row.note]))
    .join('\n');
  const tail = ingredientBody.length > 0 ? `${ingredientBody}\n` : '';
  return `# RECIPE\n${RECIPE_HEADER}\n${recipeBody}\n\n# INGREDIENTS\n${INGREDIENT_HEADER}\n${tail}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-specials-export.mjs`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add lib/specialsExport.ts tests/js/test-specials-export.mjs
git commit -m "feat(specials): pure CSV exporter

RFC-4180 escaping, two-section format (RECIPE + INGREDIENTS), and
helpers to map cost_breakdown rows into ingredient rows / strip the
trailing cost blockquote from an AI answer for use as procedure prose.
"
```

---

## Task 4: POST + GET (list) endpoint

**Files:**
- Create: `app/api/specials/saved/route.js`
- Test: `tests/js/test-specials-saved-api.mjs` (initial cut — extended in Tasks 5 and 6)

- [ ] **Step 1: Write the failing test file with create + list scenarios**

Create `tests/js/test-specials-saved-api.mjs`:

```javascript
#!/usr/bin/env node
// Round-trip API tests for /api/specials/saved/* against in-memory SQLite.
// PIN gating is enforced by middleware.js, not by the route handlers — these
// tests bypass middleware and exercise the route logic directly. Middleware
// integration is left to Playwright e2e (out of scope here).
//
// Run: node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const AUDIT_PATH = path.join(TMP_DIR, 'management-actions.jsonl');

process.env.LARIAT_AUDIT_PATH = AUDIT_PATH;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);

const create = await import('../../app/api/specials/saved/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const d = db.getDb();
  d.prepare('DELETE FROM specials').run();
  try { fs.unlinkSync(AUDIT_PATH); } catch { /* ignore */ }
});

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: 'Pork Belly App',
  pantry_text: '10 lbs pork belly',
  prompt_text: 'High-margin appetizer',
  ai_answer: 'Sear belly. Plate over slaw.',
  ai_model: 'lari-the-kitchen-assistant',
  cost_breakdown: [{ item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco', cost: 10 }],
  cost_total: 10,
  scratch_notes: '',
  sources: [],
};

describe('POST /api/specials/saved', () => {
  it('creates a row and returns its id', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', validBody));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.id, /^[0-9a-f-]{36}$/);

    const row = db.getDb().prepare('SELECT * FROM specials WHERE id = ?').get(data.id);
    assert.equal(row.name, 'Pork Belly App');
    assert.equal(row.location_id, 'default');
    assert.equal(row.cost_total, 10);
    assert.equal(typeof row.cost_breakdown, 'string');
    assert.equal(row.archived_at, null);
    assert.equal(row.last_exported_at, null);
  });

  it('rejects empty name', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: '   ' }));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /name/i);
  });

  it('rejects fully-empty session content', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      name: 'X', pantry_text: '', prompt_text: '', ai_answer: '', ai_model: '',
    }));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /no session content/i);
  });

  it('rejects invalid JSON in cost_breakdown', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      ...validBody, cost_breakdown: 'not json at all',
    }));
    assert.equal(res.status, 400);
  });

  it('honors location_id from body', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      ...validBody, location_id: 'food-truck',
    }));
    assert.equal(res.status, 200);
    const data = await res.json();
    const row = db.getDb().prepare('SELECT location_id FROM specials WHERE id = ?').get(data.id);
    assert.equal(row.location_id, 'food-truck');
  });

  it('writes a file-audit line on create', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', validBody));
    assert.equal(res.status, 200);
    const data = await res.json();
    const auditRaw = fs.readFileSync(AUDIT_PATH, 'utf8').trim();
    const audit = JSON.parse(auditRaw);
    assert.equal(audit.action, 'specials.create');
    assert.equal(audit.special_id, data.id);
    assert.equal(audit.name, 'Pork Belly App');
  });
});

describe('GET /api/specials/saved (list)', () => {
  it('returns active rows newest-first for the requested location', async () => {
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: 'Old' }));
    await new Promise((r) => setTimeout(r, 5));
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: 'New' }));

    const res = await create.GET(new Request('http://x/api/specials/saved?location=default'));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].name, 'New');
    assert.equal(data.items[1].name, 'Old');
    assert.ok(typeof data.items[0].snippet === 'string');
    assert.ok(data.items[0].snippet.length <= 120);
  });

  it('isolates by location', async () => {
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, location_id: 'a', name: 'A' }));
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, location_id: 'b', name: 'B' }));
    const res = await create.GET(new Request('http://x/api/specials/saved?location=a'));
    const data = await res.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].name, 'A');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs`
Expected: FAIL — `Cannot find module './../../app/api/specials/saved/route.js'`.

- [ ] **Step 3: Update `lib/auditLog.mjs` to honor `LARIAT_AUDIT_PATH` env**

The default audit file path is hard-coded. Tests need it overridable. Read the current file:

```bash
sed -n '1,30p' lib/auditLog.mjs
```

If a constant like `AUDIT_LOG = ...` is defined, update it to:

```js
const AUDIT_LOG = process.env.LARIAT_AUDIT_PATH || path.join(process.cwd(), 'data', 'audit', 'management-actions.jsonl');
```

If the file already supports an env override, skip this step.

- [ ] **Step 4: Create the route handler**

Create `app/api/specials/saved/route.js`:

```javascript
import { getDb } from '../../../../lib/db';
import { uuidv7 } from '../../../../lib/uuid';
import { logAuditAction } from '../../../../lib/auditLog.mjs';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';
import {
  validateName,
  coerceJsonField,
} from '../../../../lib/specialsValidators';

export const dynamic = 'force-dynamic';

const SNIPPET_MAX = 120;

function snippet(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= SNIPPET_MAX ? t : t.slice(0, SNIPPET_MAX);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const nameRes = validateName(body.name);
  if (!nameRes.ok) return Response.json({ error: nameRes.error }, { status: 400 });

  const pantry = typeof body.pantry_text === 'string' ? body.pantry_text : '';
  const prompt = typeof body.prompt_text === 'string' ? body.prompt_text : '';
  const answer = typeof body.ai_answer === 'string' ? body.ai_answer : '';
  const model = typeof body.ai_model === 'string' ? body.ai_model : '';

  if (pantry.trim() === '' && prompt.trim() === '' && answer.trim() === '') {
    return Response.json({ error: 'no session content to save' }, { status: 400 });
  }

  const cb = coerceJsonField(body.cost_breakdown);
  if (!cb.ok) return Response.json({ error: 'invalid cost_breakdown JSON' }, { status: 400 });

  const sources = coerceJsonField(body.sources);
  if (!sources.ok) return Response.json({ error: 'invalid sources JSON' }, { status: 400 });

  const costTotal =
    typeof body.cost_total === 'number' && Number.isFinite(body.cost_total) ? body.cost_total : null;
  const scratch = typeof body.scratch_notes === 'string' ? body.scratch_notes : '';

  const locFromBody = locationFromBody(body);
  const locFromReq = locationFromRequest(req);
  const locationId = locFromBody !== 'default' ? locFromBody : locFromReq;

  const id = uuidv7();
  const now = Date.now();

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO specials
      (id, location_id, name, pantry_text, prompt_text, ai_answer, ai_model,
       cost_breakdown, cost_total, scratch_notes, sources,
       created_at, updated_at)
    VALUES
      (@id, @location_id, @name, @pantry_text, @prompt_text, @ai_answer, @ai_model,
       @cost_breakdown, @cost_total, @scratch_notes, @sources,
       @created_at, @updated_at)
  `);

  const txn = db.transaction((row) => {
    insert.run(row);
    logAuditAction({
      action: 'specials.create',
      special_id: row.id,
      name: row.name,
      location_id: row.location_id,
    });
  });

  txn({
    id,
    location_id: locationId,
    name: nameRes.value,
    pantry_text: pantry,
    prompt_text: prompt,
    ai_answer: answer,
    ai_model: model,
    cost_breakdown: cb.value,
    cost_total: costTotal,
    scratch_notes: scratch,
    sources: sources.value,
    created_at: now,
    updated_at: now,
  });

  return Response.json({ id }, { status: 200 });
}

export async function GET(req) {
  const url = new URL(req.url);
  const location = url.searchParams.get('location') || 'default';

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, name, ai_answer, cost_total, last_exported_at, created_at
    FROM specials
    WHERE location_id = ? AND archived_at IS NULL
    ORDER BY created_at DESC
  `).all(location);

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    cost_total: r.cost_total,
    last_exported_at: r.last_exported_at,
    created_at: r.created_at,
    snippet: snippet(r.ai_answer),
  }));

  return Response.json({ items }, { status: 200 });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs`
Expected: PASS — all describe blocks green.

- [ ] **Step 6: Commit**

```bash
git add app/api/specials/saved/route.js tests/js/test-specials-saved-api.mjs lib/auditLog.mjs
git commit -m "feat(specials): POST + GET list endpoint

POST /api/specials/saved creates a row and emits a specials.create
file-audit line inside the same db.transaction so the audit can roll
back the insert. GET returns active rows for the location, newest
first, with a 120-char ai_answer snippet for the list cards.
"
```

---

## Task 5: GET detail / PATCH / DELETE endpoint

**Files:**
- Create: `app/api/specials/saved/[id]/route.js`
- Test: extend `tests/js/test-specials-saved-api.mjs`

- [ ] **Step 1: Append failing tests for the [id] route**

Add these `describe` blocks to `tests/js/test-specials-saved-api.mjs`, after the existing GET-list block, and at the top add:

```javascript
const detail = await import('../../app/api/specials/saved/[id]/route.js');
```

Then append:

```javascript
async function createOne(overrides = {}) {
  const res = await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, ...overrides }));
  return (await res.json()).id;
}

describe('GET /api/specials/saved/[id]', () => {
  it('returns the full record', async () => {
    const id = await createOne();
    const res = await detail.GET(new Request(`http://x/api/specials/saved/${id}`), { params: { id } });
    assert.equal(res.status, 200);
    const row = await res.json();
    assert.equal(row.id, id);
    assert.equal(row.name, 'Pork Belly App');
    assert.equal(row.ai_answer, 'Sear belly. Plate over slaw.');
  });

  it('404s on unknown id', async () => {
    const res = await detail.GET(new Request('http://x/api/specials/saved/missing'), { params: { id: 'missing' } });
    assert.equal(res.status, 404);
  });

  it('404s when id exists but in a different location', async () => {
    const id = await createOne({ location_id: 'a' });
    const res = await detail.GET(new Request(`http://x/api/specials/saved/${id}?location=b`), { params: { id } });
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/specials/saved/[id]', () => {
  it('updates allowed fields and bumps updated_at', async () => {
    const id = await createOne();
    const beforeRow = db.getDb().prepare('SELECT updated_at FROM specials WHERE id = ?').get(id);
    await new Promise((r) => setTimeout(r, 5));
    const res = await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', scratch_notes: 'hello' }),
      }),
      { params: { id } },
    );
    assert.equal(res.status, 200);
    const row = db.getDb().prepare('SELECT * FROM specials WHERE id = ?').get(id);
    assert.equal(row.name, 'Renamed');
    assert.equal(row.scratch_notes, 'hello');
    assert.ok(row.updated_at > beforeRow.updated_at);
  });

  it('rejects disallowed fields with the rejected list', async () => {
    const id = await createOne();
    const res = await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'OK', ai_answer: 'NO', cost_total: 99 }),
      }),
      { params: { id } },
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.deepEqual(data.rejected.sort(), ['ai_answer', 'cost_total']);
  });

  it('keeps captured session fields immutable', async () => {
    const id = await createOne();
    const before = db.getDb().prepare('SELECT ai_answer, cost_total FROM specials WHERE id = ?').get(id);
    await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }),
      { params: { id } },
    );
    const after = db.getDb().prepare('SELECT ai_answer, cost_total FROM specials WHERE id = ?').get(id);
    assert.equal(after.ai_answer, before.ai_answer);
    assert.equal(after.cost_total, before.cost_total);
  });

  it('writes a specials.update file-audit line', async () => {
    const id = await createOne();
    fs.unlinkSync(AUDIT_PATH); // clear the create row
    await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      { params: { id } },
    );
    const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8').trim());
    assert.equal(audit.action, 'specials.update');
    assert.equal(audit.special_id, id);
  });
});

describe('DELETE /api/specials/saved/[id]', () => {
  it('soft-deletes (sets archived_at, removes from list)', async () => {
    const id = await createOne();
    const res = await detail.DELETE(
      new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }),
      { params: { id } },
    );
    assert.equal(res.status, 200);
    const row = db.getDb().prepare('SELECT archived_at FROM specials WHERE id = ?').get(id);
    assert.ok(row.archived_at !== null);

    const list = await create.GET(new Request('http://x/api/specials/saved?location=default'));
    const data = await list.json();
    assert.equal(data.items.length, 0);
  });

  it('is idempotent on re-delete', async () => {
    const id = await createOne();
    await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    const res = await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    assert.equal(res.status, 200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs`
Expected: FAIL on the new describe blocks — `Cannot find module 'app/api/specials/saved/[id]/route.js'`.

- [ ] **Step 3: Create the [id] route handler**

Create `app/api/specials/saved/[id]/route.js`:

```javascript
import { getDb } from '../../../../../lib/db';
import { logAuditAction } from '../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../lib/location';
import {
  validateName,
  validatePatchKeys,
} from '../../../../../lib/specialsValidators';

export const dynamic = 'force-dynamic';

function loadRow(db, id, locationId) {
  return db.prepare(`
    SELECT * FROM specials
    WHERE id = ? AND location_id = ? AND archived_at IS NULL
  `).get(id, locationId);
}

function loadAnyRow(db, id, locationId) {
  return db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, locationId);
}

export async function GET(req, { params }) {
  const id = params.id;
  const locationId = locationFromRequest(req);
  const db = getDb();
  const row = loadAnyRow(db, id, locationId);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json(row, { status: 200 });
}

export async function PATCH(req, { params }) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const keysRes = validatePatchKeys(body);
  if (!keysRes.ok) {
    if (keysRes.rejected.length === 0) {
      return Response.json({ error: 'no fields to update' }, { status: 400 });
    }
    return Response.json({ error: 'fields not editable', rejected: keysRes.rejected }, { status: 400 });
  }

  const updates = {};
  if ('name' in body) {
    const r = validateName(body.name);
    if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
    updates.name = r.value;
  }
  if ('scratch_notes' in body) {
    if (typeof body.scratch_notes !== 'string') {
      return Response.json({ error: 'scratch_notes must be a string' }, { status: 400 });
    }
    updates.scratch_notes = body.scratch_notes;
  }

  const id = params.id;
  const locationId = locationFromRequest(req);
  const now = Date.now();

  const db = getDb();
  const existing = loadRow(db, id, locationId);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });

  const setFragments = Object.keys(updates).map((k) => `${k} = @${k}`).concat(['updated_at = @updated_at']);
  const stmt = db.prepare(`UPDATE specials SET ${setFragments.join(', ')} WHERE id = @id`);

  const txn = db.transaction((args) => {
    stmt.run(args);
    logAuditAction({
      action: 'specials.update',
      special_id: id,
      changed: Object.keys(updates),
      location_id: locationId,
    });
  });
  txn({ ...updates, updated_at: now, id });

  return Response.json({ ok: true }, { status: 200 });
}

export async function DELETE(req, { params }) {
  const id = params.id;
  const locationId = locationFromRequest(req);
  const now = Date.now();
  const db = getDb();

  const existing = loadAnyRow(db, id, locationId);
  if (!existing) return Response.json({ error: 'not found' }, { status: 404 });
  if (existing.archived_at !== null) return Response.json({ ok: true }, { status: 200 });

  const stmt = db.prepare('UPDATE specials SET archived_at = ?, updated_at = ? WHERE id = ?');
  const txn = db.transaction(() => {
    stmt.run(now, now, id);
    logAuditAction({
      action: 'specials.delete',
      special_id: id,
      location_id: locationId,
    });
  });
  txn();

  return Response.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs`
Expected: PASS — all describe blocks (POST, GET list, GET detail, PATCH, DELETE) green.

- [ ] **Step 5: Commit**

```bash
git add app/api/specials/saved/[id]/route.js tests/js/test-specials-saved-api.mjs
git commit -m "feat(specials): GET / PATCH / DELETE [id] endpoint

PATCH allows only name + scratch_notes (rejects everything else with
the rejected-key list); DELETE is a soft-delete via archived_at and is
idempotent on re-delete; GET 404s on cross-location ids so existence
isn't leaked. Each mutation emits a specials.{update,delete} file-
audit line inside the db.transaction.
"
```

---

## Task 6: Export endpoint

**Files:**
- Create: `app/api/specials/saved/[id]/export/route.js`
- Test: extend `tests/js/test-specials-export.mjs` with route-level cases

- [ ] **Step 1: Append failing tests for the export route**

The existing `tests/js/test-specials-export.mjs` (from Task 3) is pure-builder only. Now add a DB-backed harness and route-level tests.

At the **top** of the file (alongside the existing imports), extend the imports and harness so the file's full header now reads:

```javascript
#!/usr/bin/env node
// Tests for lib/specialsExport (pure CSV builder) and the export route
// (DB-backed, in-memory SQLite per project rule).
// Run: node --experimental-strip-types --test tests/js/test-specials-export.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-export-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const AUDIT_PATH = path.join(TMP_DIR, 'management-actions.jsonl');
process.env.LARIAT_AUDIT_PATH = AUDIT_PATH;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);

const ex = await import('../../lib/specialsExport.ts');
const create = await import('../../app/api/specials/saved/route.js');
const exportRoute = await import('../../app/api/specials/saved/[id]/export/route.js');
const detail = await import('../../app/api/specials/saved/[id]/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const d = db.getDb();
  try { d.prepare('DELETE FROM specials').run(); } catch { /* table may not be initialised on first test — harmless */ }
  try { fs.unlinkSync(AUDIT_PATH); } catch { /* ignore */ }
});
```

Keep the existing pure-builder `describe` blocks (`escapeCsvField`, `mapCostBreakdownToIngredientRows`, `selectSkippedRows`, `stripCostMarkdown`, `buildExportCsv`) verbatim — they continue to work because they don't touch the DB and the `beforeEach` DELETE is harmless.

Then **append** below the pure-builder blocks (use plain `describe`/`it`, not aliased):

const validBody = {
  name: 'Pork Belly App',
  pantry_text: '10 lbs pork belly',
  prompt_text: 'High-margin appetizer',
  ai_answer: 'Sear belly.\n\n> [!NOTE]\n> ⚡ COMPUTED RECIPE COST: $10.00',
  ai_model: 'lari-the-kitchen-assistant',
  cost_breakdown: [
    { item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco Pork Belly Skin-On', pack_size: 10, pack_unit: 'lb', pack_price: 50, cost: 10 },
    { item: 'Tomato (soft)', req_qty: 0.5, req_unit: 'case', match: '', pack_size: null, pack_unit: null, pack_price: null, cost: null },
  ],
  cost_total: 10,
  scratch_notes: '',
  sources: [],
};

function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createOne(overrides = {}) {
  const res = await create.POST(jsonRequest('http://x/api/specials/saved', 'POST', { ...validBody, ...overrides }));
  return (await res.json()).id;
}

const exportBody = {
  slug: 'pork-belly-app',
  yield_qty: 12,
  yield_unit: 'portions',
  category: 'appetizer',
};

describe('POST /api/specials/saved/[id]/export', () => {
  it('builds a CSV with recipe + ingredient sections', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.csv, /^# RECIPE\n/);
    assert.match(data.csv, /pork-belly-app/);
    assert.match(data.csv, /\n\n# INGREDIENTS\n/);
    assert.match(data.csv, /Pork Belly,2,lb,Sysco Pork Belly Skin-On,/);
    assert.equal(data.recipe_row.slug, 'pork-belly-app');
    assert.equal(data.ingredient_rows.length, 2);
    assert.equal(data.skipped.length, 1);
    assert.equal(data.skipped[0].ingredient, 'Tomato (soft)');
  });

  it('strips trailing cost markdown from procedure when no override', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const data = await res.json();
    assert.equal(data.recipe_row.procedure, 'Sear belly.');
  });

  it('uses procedure_override when provided', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, procedure_override: 'Custom procedure' }), { params: { id } });
    const data = await res.json();
    assert.equal(data.recipe_row.procedure, 'Custom procedure');
  });

  it('updates last_exported_at on each export', async () => {
    const id = await createOne();
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const t1 = db.getDb().prepare('SELECT last_exported_at FROM specials WHERE id = ?').get(id).last_exported_at;
    assert.ok(t1 > 0);
    await new Promise((r) => setTimeout(r, 5));
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const t2 = db.getDb().prepare('SELECT last_exported_at FROM specials WHERE id = ?').get(id).last_exported_at;
    assert.ok(t2 > t1);
  });

  it('410s when special is archived', async () => {
    const id = await createOne();
    await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    assert.equal(res.status, 410);
  });

  it('400s on invalid yield_qty', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, yield_qty: 0 }), { params: { id } });
    assert.equal(res.status, 400);
  });

  it('400s on bad slug', async () => {
    const id = await createOne();
    const res = await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', { ...exportBody, slug: 'Bad Slug' }), { params: { id } });
    assert.equal(res.status, 400);
  });

  it('writes a specials.export file-audit line', async () => {
    const id = await createOne();
    fs.unlinkSync(AUDIT_PATH);
    await exportRoute.POST(jsonRequest(`http://x/api/specials/saved/${id}/export`, 'POST', exportBody), { params: { id } });
    const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8').trim());
    assert.equal(audit.action, 'specials.export');
    assert.equal(audit.special_id, id);
    assert.equal(audit.slug, 'pork-belly-app');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/js/test-specials-export.mjs`
Expected: FAIL — `Cannot find module 'app/api/specials/saved/[id]/export/route.js'`.

- [ ] **Step 3: Create the export route handler**

Create `app/api/specials/saved/[id]/export/route.js`:

```javascript
import { getDb } from '../../../../../../lib/db';
import { logAuditAction } from '../../../../../../lib/auditLog.mjs';
import { locationFromRequest } from '../../../../../../lib/location';
import {
  validateSlug,
  validateYieldQty,
  validateYieldUnit,
} from '../../../../../../lib/specialsValidators';
import {
  buildExportCsv,
  mapCostBreakdownToIngredientRows,
  selectSkippedRows,
  stripCostMarkdown,
} from '../../../../../../lib/specialsExport';

export const dynamic = 'force-dynamic';

const CATEGORY_MAX = 64;

export async function POST(req, { params }) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const slugRes = validateSlug(body.slug);
  if (!slugRes.ok) return Response.json({ error: slugRes.error }, { status: 400 });

  const yqRes = validateYieldQty(body.yield_qty);
  if (!yqRes.ok) return Response.json({ error: yqRes.error }, { status: 400 });

  const yuRes = validateYieldUnit(body.yield_unit);
  if (!yuRes.ok) return Response.json({ error: yuRes.error }, { status: 400 });

  let category = '';
  if (body.category !== undefined && body.category !== null) {
    if (typeof body.category !== 'string') {
      return Response.json({ error: 'category must be a string' }, { status: 400 });
    }
    category = body.category.trim();
    if (category.length > CATEGORY_MAX) {
      return Response.json({ error: `category max ${CATEGORY_MAX} chars` }, { status: 400 });
    }
  }

  let procedureOverride = null;
  if (body.procedure_override !== undefined && body.procedure_override !== null) {
    if (typeof body.procedure_override !== 'string') {
      return Response.json({ error: 'procedure_override must be a string' }, { status: 400 });
    }
    procedureOverride = body.procedure_override;
  }

  const id = params.id;
  const locationId = locationFromRequest(req);
  const db = getDb();

  const row = db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(id, locationId);
  if (!row) return Response.json({ error: 'not found' }, { status: 404 });
  if (row.archived_at !== null) return Response.json({ error: 'special is archived' }, { status: 410 });

  // Slug collision check is read-only; tolerate missing entities_recipes table on fresh DBs.
  try {
    const collide = db.prepare(
      'SELECT slug FROM entities_recipes WHERE slug = ? AND location_id = ? LIMIT 1',
    ).get(slugRes.value, locationId);
    if (collide) {
      return Response.json({ error: 'slug already exists', slug: slugRes.value }, { status: 409 });
    }
  } catch {
    /* table not present in this test/db — skip the check */
  }

  let breakdown = [];
  if (row.cost_breakdown) {
    try { breakdown = JSON.parse(row.cost_breakdown); } catch { breakdown = []; }
  }
  const ingredient_rows = mapCostBreakdownToIngredientRows(breakdown);
  const skipped = selectSkippedRows(ingredient_rows);

  const procedure = procedureOverride !== null ? procedureOverride : stripCostMarkdown(row.ai_answer || '');

  const recipe_row = {
    slug: slugRes.value,
    display_name: row.name,
    yield_qty: yqRes.value,
    yield_unit: yuRes.value,
    category,
    procedure,
  };

  const csv = buildExportCsv({ recipe_row, ingredient_rows });

  const now = Date.now();
  const stmt = db.prepare('UPDATE specials SET last_exported_at = ?, updated_at = ? WHERE id = ?');
  const txn = db.transaction(() => {
    stmt.run(now, now, id);
    logAuditAction({
      action: 'specials.export',
      special_id: id,
      slug: slugRes.value,
      location_id: locationId,
    });
  });
  txn();

  return Response.json({ recipe_row, ingredient_rows, skipped, csv }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test tests/js/test-specials-export.mjs`
Expected: PASS — pure-builder tests + route-level tests all green.

- [ ] **Step 5: Commit**

```bash
git add app/api/specials/saved/[id]/export/route.js tests/js/test-specials-export.mjs
git commit -m "feat(specials): export endpoint

POST /api/specials/saved/[id]/export validates slug/yield/yield_unit/
category/procedure_override, reads the saved cost_breakdown, builds an
RFC-4180 CSV via lib/specialsExport, and bumps last_exported_at. Slug
collision against entities_recipes returns 409 (read-only check). 410
when the special is archived. Every export emits a specials.export
file-audit line inside the db.transaction.
"
```

---

## Task 7: Add cost fields to /api/specials response

**Files:**
- Modify: `app/api/specials/route.js`
- Test: covered by manual verification in Task 8 (jsdom test exercises the field shape)

- [ ] **Step 1: Locate the JSON response near the bottom of `app/api/specials/route.js`**

Currently the route returns `{ answer, model, location_id, sources, latencyMs, disclaimer }` at line ~138. The page needs `cost_breakdown` and `cost_total` to send into the save endpoint.

- [ ] **Step 2: Hoist the cost result so it can be read after the action handler**

Inside the `if (payload && payload.action === 'cost_special' …)` block, the local `costResult` is currently scoped inside the try. Hoist it:

```javascript
    let finalAnswer = content;
    let costResult = null;
    const { payload, stripped } = extractAction(content);
    if (payload && payload.action === 'cost_special' && Array.isArray(payload.ingredients)) {
      finalAnswer = stripped || '';
      try {
        costResult = computeSandboxCost(locationId, payload.ingredients);
        // … existing markdown rendering logic, unchanged …
      } catch (err) {
        console.error("Sandbox costing error:", err);
        finalAnswer += `\n\n> [!WARNING]\n> Could not compute deterministic cost: ${err.message}`;
      }
    }
```

- [ ] **Step 3: Extend the success response**

Update the final `return Response.json({...})` to:

```javascript
    return Response.json({
      answer: finalAnswer,
      model,
      location_id: locationId,
      sources,
      cost_breakdown: costResult ? costResult.breakdown : null,
      cost_total: costResult ? costResult.totalCost : null,
      latencyMs,
      disclaimer:
        'Answers use only the context snapshot above. Allergen tags are not legal allergen advice. Verify critical items on the floor and with a manager.',
    });
```

- [ ] **Step 4: Run the existing kitchen-assistant tests**

Run: `npm run test:rules` (catches anything that imports from lib/ollama.ts or shares constants).
Expected: PASS.

Run: `node --experimental-strip-types --test tests/js/test-specials-export.mjs`
Expected: still PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add app/api/specials/route.js
git commit -m "feat(specials): expose cost_breakdown + cost_total in API response

The save flow needs the structured breakdown alongside the rendered
markdown. Hoist costResult so it can be returned to the client; null
when no cost_special action ran.
"
```

---

## Task 8: Save button + form on /specials page

**Files:**
- Modify: `app/specials/page.jsx`
- Create: `app/__tests__/SpecialsPageSave.test.jsx`

- [ ] **Step 1: Write the failing component test**

Create `app/__tests__/SpecialsPageSave.test.jsx`:

```jsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SpecialsPage from '../specials/page';

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

function mockChatResponse(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      answer: 'Sear belly. Plate over slaw.',
      model: 'lari-the-kitchen-assistant',
      location_id: 'default',
      sources: [],
      cost_breakdown: [{ item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco', cost: 10 }],
      cost_total: 10,
      latencyMs: 100,
      ...overrides,
    }),
  };
}

async function runChat(prompt) {
  fireEvent.change(screen.getByPlaceholderText(/Create a high-margin/i), { target: { value: prompt } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /run it/i }));
  });
}

test('Save button is hidden before an answer renders', () => {
  render(<SpecialsPage />);
  expect(screen.queryByRole('button', { name: /save this special/i })).toBeNull();
});

test('Save button appears after a successful chat response', async () => {
  global.fetch.mockResolvedValueOnce(mockChatResponse());
  render(<SpecialsPage />);
  await runChat('Make a pork belly app');
  expect(await screen.findByRole('button', { name: /save this special/i })).toBeInTheDocument();
});

test('Save form requires a name', async () => {
  global.fetch.mockResolvedValueOnce(mockChatResponse());
  render(<SpecialsPage />);
  await runChat('Make a pork belly app');
  fireEvent.click(screen.getByRole('button', { name: /save this special/i }));
  // Submit button is disabled with an empty name
  const submit = screen.getByRole('button', { name: /^save$/i });
  expect(submit).toBeDisabled();
});

test('Save POSTs the captured session shape', async () => {
  global.fetch
    .mockResolvedValueOnce(mockChatResponse())
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'abc-123' }) });
  render(<SpecialsPage />);
  await runChat('Make a pork belly app');

  fireEvent.click(screen.getByRole('button', { name: /save this special/i }));
  fireEvent.change(screen.getByPlaceholderText(/name this special/i), { target: { value: 'Pork Belly App' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
  });

  const lastCall = global.fetch.mock.calls.at(-1);
  expect(lastCall[0]).toBe('/api/specials/saved');
  const body = JSON.parse(lastCall[1].body);
  expect(body.name).toBe('Pork Belly App');
  expect(body.ai_answer).toBe('Sear belly. Plate over slaw.');
  expect(body.ai_model).toBe('lari-the-kitchen-assistant');
  expect(body.cost_breakdown).toHaveLength(1);
  expect(body.cost_total).toBe(10);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- --testPathPattern SpecialsPageSave`
Expected: FAIL — Save button isn't rendered (it doesn't exist yet).

- [ ] **Step 3: Update `app/specials/page.jsx`**

Replace the file with:

```jsx
'use client';

import { useState, useMemo } from 'react';

const MAX_MESSAGE = 2000;

export default function SpecialsPage() {
  const [pantry, setPantry] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [answer, setAnswer] = useState('');
  const [model, setModel] = useState('');
  const [recipeScratch, setRecipeScratch] = useState('');
  const [costBreakdown, setCostBreakdown] = useState(null);
  const [costTotal, setCostTotal] = useState(null);
  const [sources, setSources] = useState(null);

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [savedId, setSavedId] = useState('');

  const combinedPrompt = useMemo(() => {
    return pantry.trim()
      ? `AVAILABLE INGREDIENTS/OVERSTOCK:\n${pantry.trim()}\n\nCHEF PROMPT:\n${prompt.trim()}`
      : prompt.trim();
  }, [pantry, prompt]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setAnswer('');
    setShowSaveForm(false);
    setSavedId('');

    if (!prompt.trim() && !pantry.trim()) return;
    if (combinedPrompt.length > MAX_MESSAGE) {
      setErr('Prompt + pantry too long — trim to under 2000 chars');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/specials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: combinedPrompt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "Couldn't generate. Try again.");
        return;
      }
      setAnswer(data.answer || '');
      setModel(data.model || '');
      setCostBreakdown(data.cost_breakdown ?? null);
      setCostTotal(data.cost_total ?? null);
      setSources(data.sources ?? null);
    } catch (ce) {
      setErr(String(ce.message || ce));
    } finally {
      setLoading(false);
    }
  };

  const submitSave = async (e) => {
    e.preventDefault();
    setSaveErr('');
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/specials/saved', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          pantry_text: pantry,
          prompt_text: prompt,
          ai_answer: answer,
          ai_model: model,
          cost_breakdown: costBreakdown,
          cost_total: costTotal,
          scratch_notes: recipeScratch,
          sources: sources,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setSaveErr('Manager PIN required to save.');
        else setSaveErr(data.error || 'Save failed.');
        return;
      }
      setSavedId(data.id);
      setShowSaveForm(false);
      setSaveName('');
    } catch (ce) {
      setSaveErr(String(ce.message || ce));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1>Specials</h1>
      <p className="subtitle">Use up overstock, price out a dish, or riff on new ideas.</p>

      <div className="grid-2">
        <div>
          <form onSubmit={submit} className="card">
            <label className="label mb-12">What you&apos;ve got to use up</label>
            <textarea
              value={pantry}
              onChange={(e) => setPantry(e.target.value)}
              rows={2}
              placeholder="e.g. 10 lbs pork belly, extra cilantro, half case of slightly soft tomatoes"
              className="input mb-16"
            />

            <label className="label mb-12">What are you thinking?</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. Create a high-margin pork belly appetizer using these tomatoes. Provide a rough costing framework."
              className="input mb-12"
            />
            <div className={`meta mb-12${combinedPrompt.length >= MAX_MESSAGE ? ' text-red' : ''}`} role="status" aria-live="polite">
              {combinedPrompt.length} / {MAX_MESSAGE}
            </div>
            <div className="flex-center-gap">
              <button type="submit" className="btn primary" disabled={loading || (!prompt.trim() && !pantry.trim()) || combinedPrompt.length > MAX_MESSAGE}>
                {loading ? 'Thinking...' : 'Run it'}
              </button>
              {model && (
                <span className="meta">
                  Model: <code>{model}</code>
                </span>
              )}
            </div>
          </form>

          {err && (
            <div className="card">
              <span style={{ color: 'var(--red)' }}>{err}</span>
            </div>
          )}

          {answer && (
            <div className="card">
              <h2 className="section-head mb-12">Here&apos;s what I&apos;ve got</h2>
              <div className="assistant-answer" style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>

              {savedId && (
                <p className="meta mb-12" style={{ marginTop: 16 }}>
                  Saved → <a href={`/specials/saved/${savedId}`}>view this special</a>
                </p>
              )}

              {!savedId && !showSaveForm && (
                <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => setShowSaveForm(true)}>
                  Save this special
                </button>
              )}

              {showSaveForm && (
                <form onSubmit={submitSave} style={{ marginTop: 16 }}>
                  <label className="label mb-12">Name this special</label>
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder="Name this special"
                    className="input mb-12"
                    maxLength={200}
                  />
                  <div className="flex-center-gap">
                    <button type="submit" className="btn primary" disabled={saving || !saveName.trim()}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button type="button" className="btn" onClick={() => { setShowSaveForm(false); setSaveErr(''); }}>
                      Cancel
                    </button>
                  </div>
                  {saveErr && <p className="meta mb-12" style={{ color: 'var(--red)', marginTop: 8 }}>{saveErr}</p>}
                </form>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="section-head mb-12">Your notes</h2>
          <p className="meta mb-12">Work out the numbers, adjust portions, clean it up before you pitch it.</p>
          <textarea
            value={recipeScratch}
            onChange={(e) => setRecipeScratch(e.target.value)}
            className="input"
            style={{ minHeight: '500px', fontFamily: 'monospace' }}
            placeholder="Start writing..."
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- --testPathPattern SpecialsPageSave`
Expected: PASS — all four tests green.

- [ ] **Step 5: Commit**

```bash
git add app/specials/page.jsx app/__tests__/SpecialsPageSave.test.jsx
git commit -m "feat(specials): save button + form on /specials page

Capture cost_breakdown / cost_total / sources from the chat response.
After an answer renders, show a 'Save this special' button that opens
an inline name form and POSTs the captured session to /api/specials/
saved. On 401 (no PIN) show a manager-PIN-required message; on success
swap the button for a 'Saved → view' link.
"
```

---

## Task 9: Saved list page

**Files:**
- Create: `app/specials/saved/page.jsx`

- [ ] **Step 1: Write the page**

Create `app/specials/saved/page.jsx`:

```jsx
import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';

export const dynamic = 'force-dynamic';

const SNIPPET_MAX = 120;

function snippet(s) {
  if (typeof s !== 'string') return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= SNIPPET_MAX ? t : t.slice(0, SNIPPET_MAX) + '…';
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString();
}

export default function SavedSpecialsPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, name, ai_answer, cost_total, last_exported_at, created_at
      FROM specials
      WHERE location_id = ? AND archived_at IS NULL
      ORDER BY created_at DESC
    `).all(loc);
  } catch (e) {
    console.error('saved-specials list query failed:', e);
  }

  return (
    <div>
      <Link href="/specials" style={{ color: 'var(--muted)', fontSize: 13 }}>← Specials sandbox</Link>
      <h1>Saved Specials</h1>
      <p className="subtitle">Sandbox sessions that someone wanted to keep around.</p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="meta mb-12">No saved specials yet.</p>
          <Link href="/specials" className="btn">Open the sandbox</Link>
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/specials/saved/${r.id}`} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
              <h2 className="section-head mb-12">{r.name}</h2>
              <p className="meta mb-12">
                {formatDate(r.created_at)}
                {r.cost_total !== null ? ` · $${r.cost_total.toFixed(2)}` : ''}
                {r.last_exported_at ? ' · Exported' : ''}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{snippet(r.ai_answer)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Manual smoke check (optional)**

Start the dev server: `npm run dev`. Visit `http://localhost:3000/specials/saved` after entering the PIN; the empty-state should render. (PIN gate is added in Task 11; until then the page renders unauthenticated, which is fine for local smoke testing.)

- [ ] **Step 4: Commit**

```bash
git add app/specials/saved/page.jsx
git commit -m "feat(specials): saved-specials list page

Server component reading from the specials table directly. Cards show
name, created date, cost-total badge, exported badge, and a 120-char
ai_answer snippet. Empty state links back to /specials.
"
```

---

## Task 10: Saved detail page + client interactions

**Files:**
- Create: `app/specials/saved/[id]/page.jsx`
- Create: `app/specials/saved/[id]/SpecialDetailClient.jsx`

- [ ] **Step 1: Write the server wrapper**

Create `app/specials/saved/[id]/page.jsx`:

```jsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import SpecialDetailClient from './SpecialDetailClient';

export const dynamic = 'force-dynamic';

export default function SavedSpecialDetail({ params, searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();
  const row = db.prepare('SELECT * FROM specials WHERE id = ? AND location_id = ?').get(params.id, loc);
  if (!row) notFound();

  let costBreakdown = [];
  if (row.cost_breakdown) {
    try { costBreakdown = JSON.parse(row.cost_breakdown); } catch { costBreakdown = []; }
  }
  let sources = [];
  if (row.sources) {
    try { sources = JSON.parse(row.sources); } catch { sources = []; }
  }

  return (
    <div>
      <Link href="/specials/saved" style={{ color: 'var(--muted)', fontSize: 13 }}>← Saved Specials</Link>
      <SpecialDetailClient
        special={{
          id: row.id,
          name: row.name,
          pantry_text: row.pantry_text,
          prompt_text: row.prompt_text,
          ai_answer: row.ai_answer,
          ai_model: row.ai_model,
          cost_breakdown: costBreakdown,
          cost_total: row.cost_total,
          scratch_notes: row.scratch_notes,
          sources,
          last_exported_at: row.last_exported_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write the client component**

Create `app/specials/saved/[id]/SpecialDetailClient.jsx`:

```jsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

function slugifyName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export default function SpecialDetailClient({ special }) {
  const router = useRouter();

  const [name, setName] = useState(special.name);
  const [scratch, setScratch] = useState(special.scratch_notes);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaErr, setMetaErr] = useState('');

  const [showExport, setShowExport] = useState(false);
  const [exportSlug, setExportSlug] = useState(slugifyName(special.name));
  const [exportYieldQty, setExportYieldQty] = useState('');
  const [exportYieldUnit, setExportYieldUnit] = useState('portions');
  const [exportCategory, setExportCategory] = useState('');
  const [exportProcedure, setExportProcedure] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState('');
  const [exportResult, setExportResult] = useState(null);

  const saveMeta = async () => {
    setMetaErr('');
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/specials/saved/${special.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scratch_notes: scratch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMetaErr(data.error || 'Save failed.');
    } catch (e) {
      setMetaErr(String(e.message || e));
    } finally {
      setSavingMeta(false);
    }
  };

  const onDelete = async () => {
    if (!confirm('Delete this saved special? It will be removed from the list.')) return;
    const res = await fetch(`/api/specials/saved/${special.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/specials/saved');
  };

  const submitExport = async (e) => {
    e.preventDefault();
    setExportErr('');
    setExportResult(null);
    setExporting(true);
    try {
      const res = await fetch(`/api/specials/saved/${special.id}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: exportSlug,
          yield_qty: Number(exportYieldQty),
          yield_unit: exportYieldUnit,
          category: exportCategory,
          procedure_override: exportProcedure || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setExportErr(data.error || 'Export failed.');
        return;
      }
      setExportResult(data);
    } catch (e) {
      setExportErr(String(e.message || e));
    } finally {
      setExporting(false);
    }
  };

  const downloadCsv = (csv) => {
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exportSlug}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div>
      <h1>{special.name}</h1>
      <p className="meta mb-12">
        Created {formatDateTime(special.created_at)}
        {special.last_exported_at ? ` · Last exported ${formatDateTime(special.last_exported_at)}` : ''}
      </p>

      <div className="grid-2">
        <div>
          <div className="card">
            <h2 className="section-head mb-12">Session</h2>
            {special.pantry_text && (
              <>
                <h3 className="label mb-12">Pantry</h3>
                <p className="mb-12" style={{ whiteSpace: 'pre-wrap' }}>{special.pantry_text}</p>
              </>
            )}
            {special.prompt_text && (
              <>
                <h3 className="label mb-12">Prompt</h3>
                <p className="mb-12" style={{ whiteSpace: 'pre-wrap' }}>{special.prompt_text}</p>
              </>
            )}
            <h3 className="label mb-12">AI answer</h3>
            <div style={{ whiteSpace: 'pre-wrap' }}>{special.ai_answer}</div>
            {special.ai_model && <p className="meta mb-12" style={{ marginTop: 12 }}>Model: <code>{special.ai_model}</code></p>}
          </div>

          {special.cost_breakdown.length > 0 && (
            <div className="card">
              <h2 className="section-head mb-12">Cost breakdown</h2>
              {special.cost_total !== null && <p className="mb-12"><strong>${special.cost_total.toFixed(2)}</strong></p>}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Ingredient</th>
                    <th style={{ textAlign: 'left' }}>Requested</th>
                    <th style={{ textAlign: 'left' }}>Vendor match</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {special.cost_breakdown.map((row, i) => (
                    <tr key={i}>
                      <td>{row.item}</td>
                      <td>{row.req_qty} {row.req_unit}</td>
                      <td>{row.match || <em>unmatched</em>}</td>
                      <td style={{ textAlign: 'right' }}>{row.cost !== null && row.cost !== undefined ? `$${Number(row.cost).toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h2 className="section-head mb-12">Edit</h2>
            <label className="label mb-12">Name</label>
            <input className="input mb-12" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <label className="label mb-12">Notes</label>
            <textarea
              className="input mb-12"
              style={{ minHeight: '300px', fontFamily: 'monospace' }}
              value={scratch}
              onChange={(e) => setScratch(e.target.value)}
            />
            <div className="flex-center-gap">
              <button type="button" className="btn primary" onClick={saveMeta} disabled={savingMeta || !name.trim()}>
                {savingMeta ? 'Saving...' : 'Save changes'}
              </button>
              <button type="button" className="btn" onClick={onDelete}>Delete</button>
            </div>
            {metaErr && <p className="meta mb-12" style={{ color: 'var(--red)' }}>{metaErr}</p>}
          </div>

          <div className="card">
            <h2 className="section-head mb-12">Export to recipe (CSV)</h2>
            <p className="meta mb-12">Generates a workbook-pasteable CSV. Doesn&apos;t modify the recipe DB — paste into the master workbook on your next ingest pass.</p>
            {!showExport ? (
              <button type="button" className="btn" onClick={() => setShowExport(true)}>Export</button>
            ) : (
              <form onSubmit={submitExport}>
                <label className="label mb-12">Slug</label>
                <input className="input mb-12" value={exportSlug} onChange={(e) => setExportSlug(e.target.value)} maxLength={80} />
                <label className="label mb-12">Yield qty</label>
                <input className="input mb-12" type="number" step="any" value={exportYieldQty} onChange={(e) => setExportYieldQty(e.target.value)} />
                <label className="label mb-12">Yield unit</label>
                <input className="input mb-12" value={exportYieldUnit} onChange={(e) => setExportYieldUnit(e.target.value)} maxLength={32} />
                <label className="label mb-12">Category (optional)</label>
                <input className="input mb-12" value={exportCategory} onChange={(e) => setExportCategory(e.target.value)} maxLength={64} />
                <label className="label mb-12">Procedure override (optional)</label>
                <textarea className="input mb-12" rows={4} value={exportProcedure} onChange={(e) => setExportProcedure(e.target.value)} />
                <div className="flex-center-gap">
                  <button type="submit" className="btn primary" disabled={exporting}>{exporting ? 'Exporting...' : 'Generate CSV'}</button>
                  <button type="button" className="btn" onClick={() => setShowExport(false)}>Cancel</button>
                </div>
                {exportErr && <p className="meta mb-12" style={{ color: 'var(--red)' }}>{exportErr}</p>}
              </form>
            )}

            {exportResult && (
              <div style={{ marginTop: 16 }}>
                {exportResult.skipped.length > 0 && (
                  <p className="meta mb-12" style={{ color: 'var(--orange, #b00)' }}>
                    {exportResult.skipped.length} unmatched ingredient(s) — pick a vendor item before pasting.
                  </p>
                )}
                <button type="button" className="btn primary" onClick={() => downloadCsv(exportResult.csv)}>Download CSV</button>
                <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', background: 'var(--bg2)', padding: 12, fontSize: 12 }}>
                  {exportResult.csv}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/specials/saved/[id]/page.jsx app/specials/saved/[id]/SpecialDetailClient.jsx
git commit -m "feat(specials): saved-special detail page

Server wrapper reads the row from SQLite and parses cost_breakdown +
sources JSON before passing to the client. Client component renders
session capture (immutable), an editable name + notes form, an export
modal that posts to /api/specials/saved/[id]/export, and a CSV
download once the response returns.
"
```

---

## Task 11: Middleware + nav registry

**Files:**
- Modify: `middleware.js`
- Modify: `app/_components/navRegistry.js`

- [ ] **Step 1: Add the gated paths**

Edit `middleware.js`. Locate the `SENSITIVE_PREFIXES` array and add two entries (preserve the existing order):

```javascript
const SENSITIVE_PREFIXES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/booking',
  '/playbook',
  '/shows',
  '/specials/saved',          // NEW
  '/api/costing',
  '/api/analytics',
  '/api/menu-engineering',
  '/api/beo',
  '/api/audit',
  '/api/compute',
  '/api/shows',
  '/api/specials/saved',      // NEW
];
```

The chat surface at `/specials` and `/api/specials` (without `/saved`) stays open — only the persistence surface is gated.

- [ ] **Step 2: Add the nav entry**

Edit `app/_components/navRegistry.js`. Locate the existing `id: 'specials'` entry around line 143 and add a sibling entry directly after it:

```javascript
  {
    id: 'specials-saved',
    href: '/specials/saved',
    name: 'Saved Specials',
    sub: 'Promoted sandbox sessions',
    group: 'Service',
    terms: 'saved specials sandbox export csv',
    locAware: t,
    surface: { sidebar: t, palette: t, shelf: f },
  },
```

- [ ] **Step 3: Smoke test**

Start dev server: `npm run dev`. Without a PIN cookie, visit `/specials/saved` — should redirect to the PIN page. Enter PIN; saved-specials list should render. Open the command palette (⌘K) — "Saved Specials" should appear and route to `/specials/saved`.

- [ ] **Step 4: Commit**

```bash
git add middleware.js app/_components/navRegistry.js
git commit -m "feat(specials): PIN-gate saved + register nav entry

/specials/saved and /api/specials/saved enter SENSITIVE_PREFIXES; the
brainstorm chat at /specials stays open. navRegistry gets a Saved
Specials entry under Service so sidebar + palette + floorplan stay in
sync.
"
```

---

## Task 12: Final verify

**Files:** none (verification only)

- [ ] **Step 1: Run the full Node test suite**

Run: `node --test --experimental-strip-types tests/js/test-specials-saved-rules.mjs tests/js/test-specials-saved-api.mjs tests/js/test-specials-export.mjs`
Expected: every describe block passes.

- [ ] **Step 2: Run the Jest unit tests**

Run: `npm run test:unit -- --testPathPattern Specials`
Expected: SpecialsPageSave tests pass.

- [ ] **Step 3: Run the schema regression**

Run: `npm run test:schema`
Expected: passes (specials table is idempotent).

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck`
Run: `npm run build`
Expected: both pass.

- [ ] **Step 5: GitNexus impact check**

Run: `npx gitnexus analyze` (refresh the index)
Run: `gitnexus_detect_changes` via the MCP tool
Expected: only the symbols introduced in this branch (table `specials`, validators, exporter, route handlers, page components, navRegistry entry, middleware update) appear in the change set.

- [ ] **Step 6: Manual e2e on dev server**

Start dev server: `npm run dev`. Walk the flow:

1. Visit `/specials` (no PIN) — chat works as before.
2. Run a chat that triggers `cost_special` (mention specific ingredients with quantities). Verify the answer renders with a cost table.
3. Click "Save this special", enter a name, click Save — expect 401 with "Manager PIN required to save."
4. Visit `/login-pin`, enter PIN, return to `/specials`, repeat the chat, save again — expect "Saved → view this special" link.
5. Click the link to `/specials/saved/<id>`. Verify session fields, cost table, edit form.
6. Edit the name and notes; click Save changes. Refresh — values stick.
7. Click Export, fill slug/yield, generate CSV, download. Open in a text editor to verify two-section format.
8. Click Delete; confirm. Land back on the list with the row gone.
9. Verify command palette (⌘K) shows "Saved Specials" and routes correctly.

- [ ] **Step 7: Push the branch**

```bash
git push -u origin feat/specials-persistence
```

Open a PR for review. Do **not** merge until the subagent-driven review loop (or CodeRabbit) has signed off.

---

## Spec coverage check

| Spec section | Covered by |
|---|---|
| Schema (specials table + indexes) | Task 1 |
| API: POST + GET list | Task 4 |
| API: GET detail + PATCH + DELETE | Task 5 |
| API: POST export | Task 6 |
| Validation rules (name, slug, yield_qty, yield_unit, category, JSON, PATCH keys) | Tasks 2, 4, 5, 6 |
| Export shape (two-section CSV, RFC-4180, mapping, skipped) | Tasks 3, 6 |
| `/specials/page.jsx` save button + form + 401 handling | Task 8 |
| `/specials/saved` list page | Task 9 |
| `/specials/saved/[id]` detail page (immutable session, edit, delete, export modal) | Task 10 |
| navRegistry entry | Task 11 |
| middleware PIN gate | Task 11 |
| Cost fields in `/api/specials` response | Task 7 |
| File audit (`logAuditAction`) for create / update / delete / export | Tasks 4, 5, 6 |
| Tests: rules, api, export, page | Tasks 2, 3, 4, 5, 6, 8 |
| Out-of-scope items deliberately not built | All — no tasks introduce promotion-to-recipes DB writes, sidecar JSON, versioning, search, auto-save, or per-user identity |

## Notes for the implementer

- The spec mentioned per-route `hasPinCookie()` re-checks. That helper does not currently exist (`lib/pin.ts` only exports `pinConfigured()` and `pinRequiredForPic()`). The middleware gate is the single layer of defense, matching every other PIN-gated route in this codebase. Do not invent `hasPinCookie` — adding a new helper for this feature alone would be inconsistent with the existing pattern. If a per-route check is wanted later, it should be added uniformly across all sensitive routes in a separate refactor.
- `setDbPathForTest()` swaps the singleton DB. Tests that touch the route must call it before the first `getDb()`.
- `--experimental-strip-types` is required because the route handlers import from `lib/specialsValidators.ts` and `lib/specialsExport.ts`. Match the existing test command pattern in `package.json`.
- The page tests use `@testing-library/react`. If the project doesn't have it installed yet, check `package.json` — Jest unit tests already exist (`app/__tests__/`), so the dep is likely there.
- Before committing, run `gitnexus_impact` on `/api/specials POST` (you're modifying its response shape). Expect callers limited to `/specials` page.
