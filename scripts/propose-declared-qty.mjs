#!/usr/bin/env node
// Option 4: best-effort qty/unit proposals for the 6 declared_only dishes
// that still have no dish_components rows. Emits a CSV for HUMAN REVIEW —
// no DB writes. User edits the file, then feeds it into
// scripts/import-dish-components.mjs (PR #26) for the real write.
//
// Input
//   data/cache/recipes.json  — every recipe's yield_qty / yield_unit /
//                              menu_items[] (the only source this script
//                              trusts; no DB access).
//
// Output (default: data/proposals/declared-dish-qty.csv)
//   dish_name,component_type,recipe_slug,vendor_ingredient,
//   qty_per_serving,unit,notes,confidence
//
// The importer's REQUIRED_COLUMNS are a subset of these — `confidence` is
// an extra column the importer ignores via its `pick(name)` header lookup.
//
// Usage
//   node scripts/propose-declared-qty.mjs [--out <path>] [--recipes <path>]
//
// Exit code
//   0 on success — the summary line on stderr is the programmatic signal.
//   Non-zero only if --recipes can't be read or the output path is unwritable.
//
// Scope guard: no LLM / no DB / no network. Pure file-in → file-out.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

// ── Target dish list ─────────────────────────────────────────────
// These are the 6 dishes identified by PR #28's export-coverage-gap run
// against the current DB (ROPE BURGER excluded — its gap is a unit-convert
// bug, not a missing qty, tracked as its own follow-up task).
//
// Keyed by canonical (normalized) name so recipes.menu_items[] strings
// with different case / punctuation still match.
export const TARGET_DISHES = [
  { display: 'BAJA FISH TACOS', norm: 'baja fish tacos' },
  { display: 'Quesa Birria Tacos', norm: 'quesa birria tacos' },
  { display: 'Chicken Wings', norm: 'chicken wings' },
  { display: 'The Trio', norm: 'the trio' },
  { display: 'Cobb Salad', norm: 'cobb salad' },
  { display: 'Pig Wings', norm: 'pig wings' },
];

// Heuristic alias table for Tier-3 count-unit dishes. Only consulted when
// Tier 1 and Tier 2 both fail (i.e. recipe has no yield or an unusable
// yield_unit). Keys match TARGET_DISHES[].norm.
const COUNT_HEURISTICS = new Map([
  ['baja fish tacos', { qty: 2, unit: 'ea', label: '2 tacos per serving' }],
  ['quesa birria tacos', { qty: 2, unit: 'ea', label: '2 tacos per serving' }],
  ['chicken wings', { qty: 6, unit: 'ea', label: '6 wings per serving' }],
  ['pig wings', { qty: 6, unit: 'ea', label: '6 pig wings per serving' }],
  ['cobb salad', { qty: 1, unit: 'ea', label: '1 salad per serving' }],
  ['the trio', { qty: 1, unit: 'ea', label: '1 plate per serving' }],
]);

/**
 * Canonicalize a dish name the same way lib/dishCostBridge.ts does.
 * Lowercase, collapse non-alphanumerics to spaces, trim. The intent is
 * a stable key so "Baja Fish Tacos", "BAJA FISH TACOS", and
 * "Baja Fish Tacos (cabbage topping)" all land on the same bucket.
 * Mirrored inline — script is standalone and never imports TS.
 */
export function normalizeDishName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Return true if a recipe's menu_items[] contains any form of `dishNorm`.
 * Substring match on the normalized string — recipes.json uses loose
 * phrasings like "Baja Fish Tacos (cabbage topping)" that must still
 * count as BAJA FISH TACOS.
 */
function recipeMentionsDish(recipe, dishNorm) {
  const items = Array.isArray(recipe.menu_items) ? recipe.menu_items : [];
  for (const mi of items) {
    const miNorm = normalizeDishName(mi);
    if (!miNorm) continue;
    if (miNorm === dishNorm) return true;
    if (miNorm.includes(dishNorm)) return true;
    if (dishNorm.includes(miNorm)) return true;
  }
  return false;
}

/**
 * Apply the tiered inference rules for one (dish, recipe) pair.
 * Returns { qty, unit, confidence, notes } — any of qty/unit may be ''
 * when confidence='blank'.
 *
 * Tier order:
 *   1. Explicit per-serving field on the recipe (`per_serving_qty`,
 *      `portion_size`, `per_serving`). confidence=high.
 *   2. yield_qty / menu_items.length with yield_unit. Requires BOTH a
 *      finite positive yield_qty AND a non-empty yield_unit AND a
 *      menu_items[] list of length 1..6. confidence=medium.
 *   3. Known count-unit heuristics (tacos/wings/salad). Only when
 *      yield_unit is count-dimensional OR there is no yield at all.
 *      confidence=low.
 *   4. blank — operator fills manually. confidence=blank.
 *
 * `dishDisplay` is passed only for richer notes text.
 */
export function inferQtyForRecipe(recipe, dishNorm, dishDisplay) {
  // ── Tier 1: explicit per-serving field ────────────────────────
  for (const key of ['per_serving_qty', 'portion_size', 'per_serving']) {
    const v = recipe[key];
    if (v && typeof v === 'object' && v.qty != null && v.unit) {
      const qty = Number(v.qty);
      if (Number.isFinite(qty) && qty > 0) {
        return {
          qty,
          unit: String(v.unit),
          confidence: 'high',
          notes: `explicit recipe.${key}=${qty} ${v.unit}`,
        };
      }
    }
  }

  // ── Tier 2: yield_qty / menu_items.length ────────────────────
  const yq = Number(recipe.yield_qty);
  const yu = recipe.yield_unit ? String(recipe.yield_unit).trim() : '';
  const menuItems = Array.isArray(recipe.menu_items) ? recipe.menu_items : [];
  const nItems = menuItems.length;
  if (Number.isFinite(yq) && yq > 0 && yu && nItems >= 1 && nItems <= 6) {
    // Only Tier-2 if the yield_unit is NOT count — count heuristics
    // (Tier 3) are more reliable for tacos/wings, and we want the
    // Tier-3 "N per serving" semantics over yield-split.
    const yuLower = yu.toLowerCase();
    const countMarkers = new Set(['ea', 'each', 'ct', 'count', 'pc', 'pcs', 'piece', 'pieces']);
    if (!countMarkers.has(yuLower)) {
      const qty = yq / nItems;
      return {
        qty,
        unit: yu,
        confidence: 'medium',
        notes: `inferred: yield_qty / menu_items.length (${yq} ${yu} / ${nItems})`,
      };
    }
  }

  // ── Tier 3: count-unit heuristic (only if dish name matches) ──
  const heuristic = COUNT_HEURISTICS.get(dishNorm);
  if (heuristic) {
    // Apply Tier 3 when yield_unit itself is count-dimensional OR when
    // we couldn't apply Tier 2 above. We get here only when Tier 2
    // didn't return — either because yield_unit IS count, or because
    // yield data was missing / out of range.
    return {
      qty: heuristic.qty,
      unit: heuristic.unit,
      confidence: 'low',
      notes: `heuristic: ${heuristic.label} (verify with BOH)`,
    };
  }

  // ── Tier 4: blank ─────────────────────────────────────────────
  return {
    qty: '',
    unit: '',
    confidence: 'blank',
    notes: `could not infer — fill manually (dish=${dishDisplay})`,
  };
}

/**
 * Build the full proposal list from a loaded recipes array.
 * One row per (target dish, matching sub-recipe). Sorted by dish display
 * order then by recipe_slug so CSV diffs cleanly across runs.
 *
 * Exported for the unit test.
 */
export function buildProposalRows(recipes) {
  const rows = [];
  for (const target of TARGET_DISHES) {
    const matches = recipes.filter((r) => recipeMentionsDish(r, target.norm));
    // Stable order for a dish: by recipe slug.
    matches.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
    for (const r of matches) {
      const inf = inferQtyForRecipe(r, target.norm, target.display);
      rows.push({
        dish_name: target.display,
        component_type: 'recipe',
        recipe_slug: r.slug,
        vendor_ingredient: '',
        qty_per_serving: inf.qty === '' ? '' : String(inf.qty),
        unit: inf.unit || '',
        notes: inf.notes,
        confidence: inf.confidence,
      });
    }
  }
  return rows;
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
];

export function rowsToCsv(rows) {
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
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

// ── CLI ──────────────────────────────────────────────────────────
// Skip CLI execution when imported by the test harness (test file loads
// this as a module and calls buildProposalRows / inferQtyForRecipe
// directly). Detected via import.meta.url === process.argv[1].
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      recipes: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/propose-declared-qty.mjs ' +
        '[--out <path>] [--recipes <path>]\n' +
        '\nDefault --out: data/proposals/declared-dish-qty.csv\n' +
        'Default --recipes: data/cache/recipes.json\n' +
        'Output is REVIEW-READY — no DB writes. Edit, then run ' +
        '`npm run import:dish-components` to commit.\n',
    );
    process.exit(0);
  }

  const recipesPath = path.resolve(
    values.recipes || path.join('data', 'cache', 'recipes.json'),
  );
  const outPath = path.resolve(
    values.out || path.join('data', 'proposals', 'declared-dish-qty.csv'),
  );

  if (!fs.existsSync(recipesPath)) {
    process.stderr.write(
      `propose-declared-qty: recipes file not found: ${recipesPath}\n`,
    );
    process.exit(1);
  }

  let recipes;
  try {
    recipes = JSON.parse(fs.readFileSync(recipesPath, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `propose-declared-qty: failed to parse ${recipesPath}: ${err.message}\n`,
    );
    process.exit(1);
  }
  if (!Array.isArray(recipes)) {
    process.stderr.write(
      `propose-declared-qty: ${recipesPath} must contain a JSON array\n`,
    );
    process.exit(1);
  }

  const rows = buildProposalRows(recipes);
  const csv = rowsToCsv(rows);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csv, 'utf8');

  // Summary on stderr — stdout stays empty so the script is pipeable.
  const byConfidence = { high: 0, medium: 0, low: 0, blank: 0 };
  for (const r of rows) byConfidence[r.confidence] = (byConfidence[r.confidence] || 0) + 1;

  const dishesCovered = new Set(rows.map((r) => r.dish_name)).size;
  process.stderr.write(
    `propose-declared-qty: ${TARGET_DISHES.length} dishes, ` +
      `${rows.length} rows proposed (${dishesCovered} dishes had matches), ` +
      `tier breakdown: high=${byConfidence.high} medium=${byConfidence.medium} ` +
      `low=${byConfidence.low} blank=${byConfidence.blank} → ${outPath}\n`,
  );

  // Flag any target dishes that had zero matching recipes so the operator
  // sees them in the output without having to diff.
  const covered = new Set(rows.map((r) => normalizeDishName(r.dish_name)));
  const missing = TARGET_DISHES.filter((t) => !covered.has(t.norm));
  if (missing.length) {
    process.stderr.write(
      `  no recipe matches for: ${missing.map((m) => m.display).join(', ')}\n`,
    );
  }

  process.exit(0);
}
