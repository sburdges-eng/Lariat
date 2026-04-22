#!/usr/bin/env node
// Option 5: best-effort component-list proposals for unlinked FOOD dishes.
//
// Emits a CSV for HUMAN REVIEW — no DB writes. Operator edits qty/unit
// (and drops bogus rows), then feeds the result through PR #26's
// scripts/import-dish-components.mjs for the real write.
//
// Input sources (read only, never mutated):
//   - data/cache/recipes.json      (slug + menu_items)
//   - vendor_prices.ingredient     (distinct, from data/lariat.db)
//   - order_guide_items.ingredient (distinct, from data/lariat.db)
//   - Dish list: top-revenue unlinked FOOD dishes from
//     lib/dishCostBridge.ts::computeDishCoverage, filtered through the
//     drink classifier inlined below (same keyword list as PR #27).
//
// Output (default: data/proposals/food-dish-components.csv)
//   dish_name,component_type,recipe_slug,vendor_ingredient,
//   qty_per_serving,unit,notes,confidence,dish_revenue
//
// The importer's REQUIRED_COLUMNS are a subset of these. `confidence` and
// `dish_revenue` are extra hint columns the importer ignores. qty and unit
// are ALWAYS blank from this script — by design, because we don't guess
// quantities. The importer will reject every row until the operator fills
// them in, which is exactly the review flow we want.
//
// Usage:
//   node scripts/propose-food-dish-components.mjs \
//     [--out <path>] [--top-n <n>] [--min-revenue <n>] [--location-id <id>]
//
// Exit codes:
//   0 on success (even if zero matches for a dish — that's a data signal,
//     not an error).
//   1 on missing recipes file / unreadable DB / non-array JSON.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { getDb } = await import('../lib/db.ts');
const { getRecipes } = await import('../lib/data.ts');
const { computeDishCoverage } = await import('../lib/dishCostBridge.ts');
const { proposeComponentsForDish } = await import('../lib/foodDishProposals.ts');

// ── Drink classifier (inlined copy of PR #27's scripts/extract-drink-skus.mjs) ──
// PR #27 isn't merged yet, so we can't import from that file. Keep this
// block in sync with scripts/extract-drink-skus.mjs::classifyMenuItem in
// PR #27. When PR #27 lands, refactor this to import the shared module.

const DRINK_KEYWORDS = Object.freeze({
  seltzer: ['high noon', 'white claw', 'truly', 'seltzer'],
  beer: [
    'beer', 'ale', 'lager', 'ipa', 'pilsner', 'stout',
    'corona', 'coors', 'modelo', 'michelob', 'pbr', 'budweiser',
    'miller', 'heineken', 'dos equis', 'pacifico',
  ],
  wine: [
    'wine', 'red', 'white', 'rose',
    'chardonnay', 'cabernet', 'merlot', 'pinot', 'sauvignon',
    'malbec', 'prosecco', 'champagne', 'sparkling',
  ],
  cocktail: [
    'martini', 'margarita', 'mojito', 'mimosa', 'bloody',
    'paloma', 'sangria', 'cocktail',
  ],
  liquor: [
    'tequila', 'vodka', 'whiskey', 'whisky', 'rum', 'gin',
    'bourbon', 'scotch', 'mezcal', 'rye', 'cognac', 'shot', 'well',
  ],
});

const LARIAT_DRINK_KEYWORDS = Object.freeze({
  beer: [
    'guinness', 'elevation', 'kolsch', 'soulcraft', 'firstcast',
    'skyfire', 'zinga', 'amber sc', 'white rascal', 'facedown',
  ],
  liquor: [
    'tito', 'bulleit', 'espolon', 'jack daniels', 'jameson',
    'tullamore',
  ],
  cocktail: ['mule', 'fever grass'],
});

const AGGREGATE_LABELS = new Set(['TOTAL', 'TOTALS', '']);

function matchesKeyword(haystack, needle) {
  if (needle.includes(' ')) return haystack.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/**
 * Returns the drink kind or null if the item is not a drink.
 * Mirrors PR #27 scripts/extract-drink-skus.mjs::classifyMenuItem.
 * No category here — sales_lines doesn't expose one.
 */
function classifyDrink(name) {
  const label = String(name ?? '').trim();
  if (AGGREGATE_LABELS.has(label.toUpperCase())) return 'aggregate';
  const lower = label.toLowerCase();
  for (const [kind, words] of Object.entries(LARIAT_DRINK_KEYWORDS)) {
    for (const w of words) if (matchesKeyword(lower, w)) return kind;
  }
  for (const [kind, words] of Object.entries(DRINK_KEYWORDS)) {
    for (const w of words) if (matchesKeyword(lower, w)) return kind;
  }
  return null;
}

/**
 * Non-food, non-drink items we still want to filter OUT of the food
 * proposal list. Music tickets, retail, gift cards — anything that
 * wouldn't have a recipe or ingredient at all. Keep this list tiny;
 * err on the side of surfacing borderline items so the operator can
 * reject them manually.
 */
function isObviouslyNonFood(name) {
  const lower = String(name || '').toLowerCase();
  if (/\$\s*\d/.test(lower)) return true;                 // "$15 Music Tix"
  if (/\bmusic\b|\btix\b|\bticket\b/.test(lower)) return true;
  if (/\bmerch\b|\btee\b|\bhat\b|\bsticker\b/.test(lower)) return true;
  return false;
}

// ── CSV emit (RFC-4180, mirrors scripts/import-dish-components.mjs) ──
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_HEADER = [
  'dish_name',
  'component_type',
  'recipe_slug',
  'vendor_ingredient',
  'qty_per_serving',
  'unit',
  'notes',
  'confidence',
  'dish_revenue',
];

function rowsToCsv(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.dish_name),
        csvField(r.component_type),
        csvField(r.recipe_slug),
        csvField(r.vendor_ingredient),
        csvField(r.qty_per_serving),
        csvField(r.unit),
        csvField(r.notes),
        csvField(r.confidence),
        csvField(r.dish_revenue),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'top-n': { type: 'string' },
      'min-revenue': { type: 'string' },
      'location-id': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/propose-food-dish-components.mjs ' +
        '[--out <path>] [--top-n <n>] [--min-revenue <n>] ' +
        '[--location-id <id>]\n' +
        '\nDefaults: --out=data/proposals/food-dish-components.csv ' +
        '--top-n=10 --min-revenue=400 --location-id=default\n' +
        '\nOutput is REVIEW-READY — no DB writes. qty/unit always blank; ' +
        'the operator fills them before running ' +
        '`npm run import:dish-components`.\n',
    );
    process.exit(0);
  }

  const outPath = path.resolve(
    values.out || path.join('data', 'proposals', 'food-dish-components.csv'),
  );
  const topN = values['top-n'] != null ? Number(values['top-n']) : 10;
  const minRevenue = values['min-revenue'] != null ? Number(values['min-revenue']) : 400;
  const locationId = values['location-id'] || 'default';

  if (!Number.isFinite(topN) || topN <= 0) {
    process.stderr.write(`propose-food-dish-components: --top-n must be a positive number, got "${values['top-n']}"\n`);
    process.exit(1);
  }
  if (!Number.isFinite(minRevenue) || minRevenue < 0) {
    process.stderr.write(`propose-food-dish-components: --min-revenue must be a non-negative number, got "${values['min-revenue']}"\n`);
    process.exit(1);
  }

  // 1. Get unlinked dishes from the coverage report.
  const report = computeDishCoverage(locationId);

  // 2. Filter to food (drop drinks + obvious non-food) and apply revenue floor.
  const foodCandidates = report.unlinked_dishes
    .filter((d) => {
      if (d.net_sales < minRevenue) return false;
      if (isObviouslyNonFood(d.item_name)) return false;
      const kind = classifyDrink(d.item_name);
      if (kind) return false;
      return true;
    })
    .slice(0, topN);

  if (foodCandidates.length === 0) {
    process.stderr.write(
      `propose-food-dish-components: no unlinked food dishes found above ` +
        `min-revenue=$${minRevenue} (coverage report had ${report.unlinked_dishes.length} unlinked total)\n`,
    );
    // Still write an empty CSV so downstream "file exists" tooling works.
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, CSV_HEADER.join(',') + '\n', 'utf8');
    process.exit(0);
  }

  // 3. Load sources: recipes + distinct vendor/order_guide ingredients.
  const recipes = getRecipes();
  const db = getDb();
  const vendorIngredients = db
    .prepare(`SELECT DISTINCT ingredient FROM vendor_prices WHERE ingredient IS NOT NULL AND ingredient != '' AND location_id = ?`)
    .all(locationId)
    .map((r) => r.ingredient);
  const orderGuideIngredients = db
    .prepare(`SELECT DISTINCT ingredient FROM order_guide_items WHERE ingredient IS NOT NULL AND ingredient != '' AND location_id = ?`)
    .all(locationId)
    .map((r) => r.ingredient);

  const sources = {
    recipes: recipes.map((r) => ({ slug: r.slug, name: r.name, menu_items: r.menu_items })),
    vendorIngredients,
    orderGuideIngredients,
  };

  // 4. Run inference per dish, collect rows.
  const allRows = [];
  const zeroMatchDishes = [];
  const perDishCounts = [];
  for (const d of foodCandidates) {
    const { rows, diagnostics } = proposeComponentsForDish(d.item_name, sources);
    if (rows.length === 0) {
      zeroMatchDishes.push(d.item_name);
    }
    for (const r of rows) {
      allRows.push({ ...r, dish_revenue: d.net_sales.toFixed(2) });
    }
    perDishCounts.push({
      dish: d.item_name,
      revenue: d.net_sales,
      total: rows.length,
      medium: rows.filter((r) => r.confidence === 'medium').length,
      low: rows.filter((r) => r.confidence === 'low').length,
      tokens: diagnostics.tokens.length,
    });
  }

  // 5. Write CSV. Order: dish_revenue desc (same order as foodCandidates),
  // then within a dish preserve the insertion order from composeRows().
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, rowsToCsv(allRows), 'utf8');

  // 6. Summary on stderr; stdout reserved for pipeable future use.
  const totalMedium = allRows.filter((r) => r.confidence === 'medium').length;
  const totalLow = allRows.filter((r) => r.confidence === 'low').length;
  process.stderr.write(
    `propose-food-dish-components: ${foodCandidates.length} dishes, ` +
      `${allRows.length} rows proposed (medium=${totalMedium} low=${totalLow}) → ${outPath}\n`,
  );
  for (const p of perDishCounts) {
    process.stderr.write(
      `  ${p.dish} ($${p.revenue.toFixed(0)}): ${p.total} rows ` +
        `(${p.medium} medium, ${p.low} low) from ${p.tokens} tokens\n`,
    );
  }
  if (zeroMatchDishes.length) {
    process.stderr.write(
      `  no matches for: ${zeroMatchDishes.join(', ')} — hand-wire these\n`,
    );
  }
}
