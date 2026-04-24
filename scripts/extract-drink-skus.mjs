#!/usr/bin/env node
// Extract distinct drink SKUs from sales_lines and produce a fill-me CSV
// sorted by total revenue. Does NOT write to the DB; its only output is
// the file at --out (default /tmp/drink-skus.csv).
//
// Usage:
//   node scripts/extract-drink-skus.mjs [--out <path>] [--location-id <id>]
//
// Purpose: the top-revenue menu dishes at The Lariat are drinks (Tequila
// Well, Coors, Vodka Breck, Coors Light, SOULCRAFT SKYFIRE…). vendor_prices
// has 0 rows for beer, wine, or liquor, so the dish↔vendor bridge can't
// cost any of them until a human fills in real cost data. This script
// hands the human the list of SKUs they need to price, ranked by revenue.
//
// Classifier:
//   1. Skip aggregate rows (TOTAL / TOTALS / blank item_name).
//   2. Apply keyword heuristics to item_name (see DRINK_KEYWORDS below).
//      The current sales_lines schema has no category column — if a future
//      ingest adds one, this script checks it first and only falls back to
//      keyword matching.
//   3. Assign an inferred_kind: beer, wine, liquor, cocktail, seltzer,
//      unknown. Mutually exclusive; the earliest-matching kind wins.
//   4. Suggest a pack_unit and pour_size based on inferred_kind so the
//      human has a sensible default to overwrite. These are defaults, not
//      claims — no cost data is invented.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// ── Keyword taxonomy ───────────────────────────────────────────────
// Order matters: earlier kinds win when multiple keyword buckets match.
// "bloody" before "mary" so "Bloody Mary" classifies as cocktail, not
// somebody's name. Expand cautiously — a false positive imports a food
// row as drink; a false negative leaves the dish uncosted until someone
// adds it by hand.
//
// The first block — DRINK_KEYWORDS — is the authoritative list from the
// project skill/spec. Change here and you must change it in the spec.
//
// The second block — LARIAT_DRINK_KEYWORDS — covers local brand names
// that appear in this venue's POS data (SOULCRAFT, ELEVATION, etc.) and
// would otherwise slip through. Kept separate so a future import at a
// different venue can drop it without touching the shared taxonomy.
export const DRINK_KEYWORDS = Object.freeze({
  seltzer: ['high noon', 'white claw', 'truly', 'seltzer'],
  beer: [
    'beer', 'ale', 'lager', 'ipa', 'pilsner', 'stout',
    'corona', 'coors', 'modelo', 'michelob', 'pbr', 'budweiser',
    'miller', 'heineken', 'dos equis', 'pacifico',
  ],
  wine: [
    'wine', 'red', 'white', 'rosé', 'rose',
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

// Lariat-specific brand names + taproom identifiers that don't show up
// in the generic list. Surfacing these in the fill-me CSV lets the
// operator price SOULCRAFT / ELEVATION beers without renaming them in
// Toast. "Guinness" etc. are here instead of DRINK_KEYWORDS because
// they're specific brand tokens rather than beverage categories.
export const LARIAT_DRINK_KEYWORDS = Object.freeze({
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

/**
 * Classify a menu item name into a drink kind, or null if it's food.
 * Pure function — safe to call from tests without a DB.
 *
 * "category" is looked up first; if the caller knows the POS category
 * says "Beer" we trust that over any name match. If the caller has no
 * category, we fall back to the keyword heuristic.
 */
export function classifyMenuItem(name, category) {
  const label = String(name ?? '').trim();
  if (AGGREGATE_LABELS.has(label.toUpperCase())) return null;

  // Category short-circuit (future-proofing: sales_lines currently has
  // no category column, but ingest may grow one).
  if (category) {
    const c = String(category).toLowerCase();
    if (c.includes('beer')) return 'beer';
    if (c.includes('wine')) return 'wine';
    if (c.includes('seltzer')) return 'seltzer';
    if (c.includes('cocktail') || c.includes('mixed drink')) return 'cocktail';
    if (c.includes('liquor') || c.includes('spirit')) return 'liquor';
    // Explicit food categories mean "not a drink" — trust them.
    if (/food|kitchen|burger|sandwich|salad|fry|side|dessert|app/.test(c)) {
      return null;
    }
  }

  const lower = label.toLowerCase();

  // Venue-specific brand names take priority: they're more precise than
  // the generic taxonomy ("elevation kolsch" → beer, not a liquor hit on
  // some overlap). Word-boundary check keeps "ale" from matching "salad"
  // or "gale".
  for (const [kind, words] of Object.entries(LARIAT_DRINK_KEYWORDS)) {
    for (const w of words) {
      if (matchesKeyword(lower, w)) return kind;
    }
  }
  for (const [kind, words] of Object.entries(DRINK_KEYWORDS)) {
    for (const w of words) {
      if (matchesKeyword(lower, w)) return kind;
    }
  }
  return null;
}

function matchesKeyword(haystack, needle) {
  if (needle.includes(' ')) {
    // Multi-word phrases: plain substring is fine ("dos equis").
    return haystack.includes(needle);
  }
  // Single words: require word boundaries so "ale" matches "Ale" but not
  // "salad". Lowercased haystack → test with a simple regex.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/**
 * Suggest a pack_unit + pour_size defaults for each kind. These are
 * inventory-hygiene hints to the human filling in the template — not
 * data to import.
 */
export function suggestPackDefaults(kind) {
  switch (kind) {
    case 'beer': return { pack_unit: 'bottle', pour_size: '12oz btl' };
    case 'wine': return { pack_unit: 'bottle', pour_size: '750ml bottle, 5oz pour' };
    case 'liquor': return { pack_unit: 'ml', pour_size: '1.5oz (44ml) pour from 750ml' };
    case 'cocktail': return { pack_unit: 'each', pour_size: 'built drink, cost per component' };
    case 'seltzer': return { pack_unit: 'bottle', pour_size: '12oz can' };
    default: return { pack_unit: '', pour_size: '' };
  }
}

// ── CSV emit ───────────────────────────────────────────────────────
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const HEADER = Object.freeze([
  'menu_item_name',
  'total_revenue',
  'total_qty',
  'category',
  'inferred_kind',
  'suggested_pack_unit',
  'suggested_pour_size',
  'notes',
]);

/**
 * Pure core: take raw sales_lines grouped rows, produce the writeable
 * drink-SKU report. Unit-tested without touching the DB.
 *
 * Each input row must look like { item_name, total_revenue, total_qty,
 * category? }; category is optional and comes from a future POS column.
 */
export function buildDrinkReport(rows) {
  const drinkRows = [];
  let totalRevenue = 0;
  let drinkRevenue = 0;
  for (const r of rows) {
    totalRevenue += Number(r.total_revenue) || 0;
    const kind = classifyMenuItem(r.item_name, r.category ?? null);
    if (!kind) continue;
    drinkRevenue += Number(r.total_revenue) || 0;
    const suggest = suggestPackDefaults(kind);
    drinkRows.push({
      menu_item_name: r.item_name,
      total_revenue: Number(r.total_revenue).toFixed(2),
      total_qty: Number(r.total_qty),
      category: r.category ?? '',
      inferred_kind: kind,
      suggested_pack_unit: suggest.pack_unit,
      suggested_pour_size: suggest.pour_size,
      notes: '',
    });
  }
  return { drinkRows, totalRevenue, drinkRevenue };
}

export function renderDrinkReportCsv(drinkRows) {
  const lines = [HEADER.join(',')];
  for (const r of drinkRows) {
    lines.push(HEADER.map((h) => csvField(r[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

// ── CLI entry point ────────────────────────────────────────────────
async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'location-id': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/extract-drink-skus.mjs [--out <path>] [--location-id <id>]\n',
    );
    return;
  }

  const outPath = path.resolve(values.out || '/tmp/drink-skus.csv');
  const locationId = values['location-id'] || 'default';

  register(new URL('../tests/js/resolver.mjs', import.meta.url));
  const db = await import('../lib/db.ts');
  const sqlite = db.getDb();

  // sales_lines schema: (id, period_label, item_name, quantity_sold,
  // net_sales, source, location_id, imported_at). No category column today,
  // so the SELECT leaves category NULL; classifyMenuItem handles that.
  //
  // Aggregate menu items like "TOTAL" / "TOTALS" exist in the real data
  // (items.csv footer rows) and legitimately dwarf everything else on
  // net_sales, so filtering them out is mandatory before ranking.
  const rows = sqlite
    .prepare(
      `SELECT item_name,
              COALESCE(SUM(net_sales), 0)     AS total_revenue,
              COALESCE(SUM(quantity_sold), 0) AS total_qty
         FROM sales_lines
        WHERE location_id = ?
          AND item_name IS NOT NULL
          AND TRIM(item_name) != ''
          AND UPPER(TRIM(item_name)) NOT IN ('TOTAL', 'TOTALS')
        GROUP BY item_name
        ORDER BY total_revenue DESC`,
    )
    .all(locationId);

  const { drinkRows, totalRevenue, drinkRevenue } = buildDrinkReport(rows);
  const csv = renderDrinkReportCsv(drinkRows);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv);

  // Summary: N SKUs, $X.XX total revenue. Do NOT print individual item
  // names — the real DB is the operator's live menu and the report is
  // scoped to "extractor metrics", not a menu dump.
  process.stdout.write(
    `extract-drink-skus: ${drinkRows.length} drink SKUs, ` +
      `$${drinkRevenue.toFixed(2)} total revenue ` +
      `(${totalRevenue > 0 ? ((drinkRevenue / totalRevenue) * 100).toFixed(1) : '0.0'}% of all sales) ` +
      `→ ${outPath}\n`,
  );
}

// Only run main() when invoked directly, not when imported by tests.
const invokedAsScript =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedAsScript) {
  main().catch((err) => {
    process.stderr.write(`extract-drink-skus: ${err.message}\n`);
    process.exit(1);
  });
}
