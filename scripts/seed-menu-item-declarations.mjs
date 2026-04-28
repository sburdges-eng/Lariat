#!/usr/bin/env node
// Heuristic seeder for unlinked dishes that ALMOST match a curated
// recipes[].menu_items[] declaration but get filtered to `unlinked` by
// the strict normalizeDishName() join.
//
// What it does
//   1. Read computeDishCoverage().unlinked_dishes (only those above
//      --min-revenue, default $0).
//   2. Fuzzy-match each against recipes[].menu_items[] via
//      lib/dishMenuItemMatch.ts (accent strip, '&'↔'and', leading 'The'
//      drop, Mtn/etc abbreviations, single-direction subset, Jaccard).
//   3. Emit a CSV with the same columns the importer expects, plus
//      `confidence` and `match_reason` hint columns.
//
// What it does NOT do
//   - No DB writes. Output is review-ready CSV; operator fills qty,
//      drops bogus rows, then runs `npm run import:dish-components`.
//   - No qty/unit invention. `unit` is suggested from the recipe's
//      yield_unit (same heuristic as scripts/export-coverage-gap.mjs);
//      `qty_per_serving` is always blank.
//   - No drink seeding. Drinks are handled by separate beverage
//      tooling (PR #27 / scripts/extract-drink-skus.mjs).
//
// Usage:
//   node --experimental-strip-types scripts/seed-menu-item-declarations.mjs \
//     [--out <path>] [--location-id <id>] [--min-revenue <n>] \
//     [--min-confidence high|medium|low] [--top-n <n>]
//
// Default output: data/proposals/menu-item-seeds.csv
// Summary on stderr.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { getDb } = await import('../lib/db.ts');
const { getRecipes } = await import('../lib/data.ts');
const { computeDishCoverage } = await import('../lib/dishCostBridge.ts');
const { matchDishToMenuItems } = await import('../lib/dishMenuItemMatch.ts');

// ── Drink filter (same keyword list as scripts/propose-food-dish-components.mjs) ─
// Inlined so we don't depend on module-load order between sibling scripts.
// Keep this in sync with the parent — when PR #27 lands we should refactor
// both files to import a shared classifier.
const DRINK_KEYWORDS = [
  'high noon', 'white claw', 'truly', 'seltzer',
  'beer', 'ale', 'lager', 'ipa', 'pilsner', 'stout',
  'corona', 'coors', 'modelo', 'michelob', 'pbr', 'budweiser',
  'miller', 'heineken', 'dos equis', 'pacifico',
  'wine', 'chardonnay', 'cabernet', 'merlot', 'pinot', 'sauvignon',
  'malbec', 'prosecco', 'champagne', 'sparkling',
  'martini', 'margarita', 'mojito', 'mimosa', 'bloody',
  'paloma', 'sangria', 'cocktail',
  'tequila', 'vodka', 'whiskey', 'whisky', 'rum', 'gin',
  'bourbon', 'scotch', 'mezcal', 'rye', 'cognac', 'shot', 'well',
  // Lariat-specific drink labels
  'guinness', 'elevation', 'kolsch', 'soulcraft', 'firstcast',
  'skyfire', 'zinga', 'amber sc', 'white rascal', 'facedown',
  'tito', 'bulleit', 'espolon', 'jack daniels', 'jameson', 'tullamore',
  'mule', 'fever grass',
];

// Non-food, non-drink items (music tickets, retail, gift cards). Mirrors
// scripts/propose-food-dish-components.mjs::isObviouslyNonFood — kept tiny
// on purpose; borderline items should surface so the operator can reject
// them rather than be silently dropped.
function isObviouslyNonFood(name) {
  const lower = String(name || '').toLowerCase();
  if (/\$\s*\d/.test(lower)) return true;
  if (/\bmusic\b|\btix\b|\bticket\b/.test(lower)) return true;
  if (/\bmerch\b|\btee\b|\bhat\b|\bsticker\b/.test(lower)) return true;
  return false;
}

function looksLikeDrink(name) {
  const lower = String(name || '').toLowerCase();
  // word-ish boundary check so 'gin' doesn't fire on 'ginger'
  for (const kw of DRINK_KEYWORDS) {
    if (kw.includes(' ')) {
      if (lower.includes(kw)) return true;
    } else {
      const re = new RegExp(`\\b${kw}\\b`);
      if (re.test(lower)) return true;
    }
  }
  return false;
}

// ── CSV emit (RFC-4180; mirrors scripts/import-dish-components.mjs) ─
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
  'match_reason',
  'declared_menu_item',
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
        csvField(r.match_reason),
        csvField(r.declared_menu_item),
        csvField(r.dish_revenue),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// ── CLI ────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    'location-id': { type: 'string' },
    'min-revenue': { type: 'string' },
    'min-confidence': { type: 'string' },
    'top-n': { type: 'string' },
    'include-drinks': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  process.stdout.write(
    'Usage: node --experimental-strip-types scripts/seed-menu-item-declarations.mjs ' +
      '[--out <path>] [--location-id <id>] [--min-revenue <n>] ' +
      '[--min-confidence high|medium|low] [--top-n <n>] [--include-drinks]\n' +
      '\nDefaults: --out=data/proposals/menu-item-seeds.csv ' +
      '--min-revenue=0 --min-confidence=medium --location-id=default\n' +
      '\nOutput is REVIEW-READY — no DB writes. qty_per_serving always blank; ' +
      'unit pre-filled from the recipe yield_unit when available. ' +
      'Run `npm run import:dish-components` after the operator fills qty.\n',
  );
  process.exit(0);
}

const outPath = path.resolve(
  values.out || path.join('data', 'proposals', 'menu-item-seeds.csv'),
);
const locationId = values['location-id'] || 'default';
const minRevenue = values['min-revenue'] != null ? Number(values['min-revenue']) : 0;
const topN = values['top-n'] != null ? Number(values['top-n']) : Infinity;
const minConfidence = (values['min-confidence'] || 'medium').toLowerCase();
const includeDrinks = Boolean(values['include-drinks']);

if (!Number.isFinite(minRevenue) || minRevenue < 0) {
  process.stderr.write(
    `seed-menu-item-declarations: --min-revenue must be a non-negative number, got "${values['min-revenue']}"\n`,
  );
  process.exit(1);
}
if (!['high', 'medium', 'low'].includes(minConfidence)) {
  process.stderr.write(
    `seed-menu-item-declarations: --min-confidence must be high|medium|low, got "${values['min-confidence']}"\n`,
  );
  process.exit(1);
}
if (!(Number.isFinite(topN) && topN > 0) && topN !== Infinity) {
  process.stderr.write(
    `seed-menu-item-declarations: --top-n must be a positive number, got "${values['top-n']}"\n`,
  );
  process.exit(1);
}

// ── Pull data ─────────────────────────────────────────────────────
const recipes = getRecipes();
const recipeForMatch = recipes.map((r) => ({
  slug: r.slug,
  name: r.name,
  menu_items: r.menu_items || [],
}));

// Recipe yield_unit index for suggested-unit pre-fill — same source
// preference as buildCoverageGapRows (recipe_costs > recipes.json).
const db = getDb();
const yieldUnitBySlug = new Map();
for (const r of recipes) yieldUnitBySlug.set(r.slug, r.yield_unit ?? null);
const costRows = db
  .prepare(
    'SELECT recipe_id, yield_unit FROM recipe_costs WHERE location_id = ?',
  )
  .all(locationId);
for (const c of costRows) {
  if (c.yield_unit) yieldUnitBySlug.set(c.recipe_id, c.yield_unit);
}

// Coverage report — only unlinked needs the fuzz; declared_only already
// has its recipe_slug mapped and is handled by export-coverage-gap.
const report = computeDishCoverage(locationId);
const unlinked = report.unlinked_dishes
  .filter((d) => (d.net_sales || 0) >= minRevenue)
  .filter((d) => !isObviouslyNonFood(d.item_name))
  .filter((d) => includeDrinks || !looksLikeDrink(d.item_name));

// ── Fuzz pass ─────────────────────────────────────────────────────
const rows = [];
const perDish = [];
const zeroMatch = [];

for (const d of unlinked) {
  // Cap is per-DISH (we want every declared component, not just the best
  // recipe match). 50 is well above the largest realistic component list
  // for one menu item (FISH AND CHIPS has 5 declared sub-recipes).
  const matches = matchDishToMenuItems(d.item_name, recipeForMatch, {
    minConfidence,
    maxCandidates: 50,
  });
  if (matches.length === 0) {
    zeroMatch.push(d.item_name);
    continue;
  }
  for (const m of matches) {
    const yieldUnit = yieldUnitBySlug.get(m.recipe_slug) || '';
    rows.push({
      dish_name: d.item_name,
      component_type: 'recipe',
      recipe_slug: m.recipe_slug,
      vendor_ingredient: '',
      qty_per_serving: '',
      unit: yieldUnit,
      notes: `seeded via menu_items fuzz match (${m.reason}); declared "${m.declared_menu_item}"`,
      confidence: m.confidence,
      match_reason: m.reason,
      declared_menu_item: m.declared_menu_item,
      dish_revenue: (d.net_sales || 0).toFixed(2),
    });
  }
  perDish.push({
    dish: d.item_name,
    revenue: d.net_sales || 0,
    matches: matches.length,
    top: matches[0],
  });
}

// Sort: revenue desc (per dish), then confidence asc, then slug asc.
// Stable within a dish so the operator scans top-down by money.
rows.sort((a, b) => {
  const rd = Number(b.dish_revenue) - Number(a.dish_revenue);
  if (rd !== 0) return rd;
  const cr = confRank(a.confidence) - confRank(b.confidence);
  if (cr !== 0) return cr;
  return a.recipe_slug.localeCompare(b.recipe_slug);
});

// Apply top-N cap on DISTINCT dishes (not rows) so the cap behaves
// like the propose-food-dish-components.mjs --top-n.
if (topN !== Infinity) {
  const keepDishes = new Set();
  const orderedDishes = [];
  for (const r of rows) {
    if (!keepDishes.has(r.dish_name)) {
      if (keepDishes.size >= topN) continue;
      keepDishes.add(r.dish_name);
      orderedDishes.push(r.dish_name);
    }
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (!keepDishes.has(rows[i].dish_name)) rows.splice(i, 1);
  }
}

function confRank(c) {
  return c === 'high' ? 0 : c === 'medium' ? 1 : 2;
}

// ── Write ─────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, rowsToCsv(rows), 'utf8');

// ── Summary on stderr ─────────────────────────────────────────────
const distinctDishes = new Set(rows.map((r) => r.dish_name));
const byConf = { high: 0, medium: 0, low: 0 };
for (const r of rows) byConf[r.confidence]++;

process.stderr.write(
  `seed-menu-item-declarations: ${unlinked.length} unlinked candidates, ` +
    `${distinctDishes.size} matched (${rows.length} rows: ` +
    `${byConf.high} high / ${byConf.medium} medium / ${byConf.low} low) → ${outPath}\n`,
);
const matchRate =
  unlinked.length === 0 ? 0 : (distinctDishes.size / unlinked.length) * 100;
process.stderr.write(`  match rate: ${matchRate.toFixed(0)}% of unlinked food (drinks excluded)\n`);

for (const p of perDish.slice(0, 20)) {
  process.stderr.write(
    `  ${p.dish} ($${p.revenue.toFixed(0)}): ${p.matches} match` +
      `${p.matches === 1 ? '' : 'es'}, top → ${p.top.recipe_slug} (${p.top.confidence})\n`,
  );
}
if (zeroMatch.length) {
  const sample = zeroMatch.slice(0, 8).join(', ');
  const more = zeroMatch.length > 8 ? `, +${zeroMatch.length - 8} more` : '';
  process.stderr.write(`  no fuzz match for: ${sample}${more}\n`);
}
