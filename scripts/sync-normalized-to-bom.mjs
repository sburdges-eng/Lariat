#!/usr/bin/env node
// Sync recipes/normalized/*.csv into the SQLite DB.
//
// Why this exists: the CSV files in recipes/normalized/ are the
// editable source of truth for BEO order pulls and the JSON cache, but
// the DB tables (entities_recipes, bom_lines) get populated by the
// workbook-driven `npm run ingest:costing`. When a CSV is hand-edited
// (e.g. a chef adds a new house recipe) and the workbook hasn't caught
// up yet, the DB stays stale — costing variance, depletion math, and
// the Kitchen Assistant won't see the new rows.
//
// This script bridges that gap. For every row in recipes/recipe_index.csv
// with a matching recipes/normalized/<slug>.csv:
//   1. UPSERT entities_recipes via resolveOrCreateRecipe(source='manual',
//      external_id=slug). Idempotent — a re-run with no changes is a no-op.
//   2. DELETE existing bom_lines WHERE recipe_id=slug AND location_id, then
//      INSERT one row per CSV ingredient row (full-refresh-per-recipe pattern).
//   3. Re-enrich each inserted bom_line with vendor columns by joining the
//      ingredient name against `vendor_prices` via the normalized ingredient
//      key (lib/ingredientKey.ts::normalizeIngredientKey — the same matcher
//      lib/costingBenchmarks.mjs::computeCostVariance uses for its fallback
//      path). When exactly one confident vendor match is found we populate
//      pack_price, pack_size, vendor, vendor_ingredient, yield_pct, master_id
//      and set map_status='mapped'. When zero matches OR multiple distinct-
//      vendor matches resolve we leave the vendor cols NULL and set
//      map_status='UNMAPPED' (vendor_columns_unmapped counter bumps).
//
// Without (3), this script's DELETE step would silently wipe the vendor
// enrichment that `ingest:costing` had populated on workbook-driven recipes.
// (3) restores equivalent state from vendor_prices on every sync so the run
// order ingest:costing → sync:normalized produces the same net DB as
// running ingest:costing alone for the workbook subset.
//
// Sub-recipe detection: an ingredient row is treated as a sub-recipe (and
// the bom_lines.sub_recipe column is populated) when the row's `notes`
// column contains "sub-recipe" / "sub_recipe" / "via <slug>.csv" AND the
// slugified ingredient name matches a recipe_id in recipe_index.csv.
//
// Scaffold skip set: 7 placeholder recipes in recipes/recipe_index.csv are
// 1-ingredient "vendor whole-buy" stubs (prime_rib, chocolate_cake, churros,
// cupcakes, mini_rellenos, philo_bites, tiramisu). They have no real BOM
// expansion and no vendor SKU yet, so we skip them here rather than create
// noisy 1-line BOMs in the DB. They still resolve as recipes via the
// ingest:costing workbook path when/if vendor SKUs land.
//
// Records a row in `ingest_runs` with kind='sync_normalized_csv'.
//
// Usage:
//   node --experimental-strip-types scripts/sync-normalized-to-bom.mjs
//   node --experimental-strip-types scripts/sync-normalized-to-bom.mjs --dry
//   node --experimental-strip-types scripts/sync-normalized-to-bom.mjs --location=west

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeIngredientKey } from '../lib/ingredientKey.ts';
import { effectivePackPrice } from '../lib/unitConvert.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INDEX_CSV = path.join(ROOT, 'recipes', 'recipe_index.csv');
const DEFAULT_NORMALIZED_DIR = path.join(ROOT, 'recipes', 'normalized');

// Recipes we deliberately do NOT promote to entities_recipes / bom_lines.
// All 7 are 1-ingredient "vendor whole-buy" placeholders: a single CSV row
// pointing at a frozen/case SKU we haven't fully mapped yet. Creating a
// real bom_line for them would be misleading — they'd show up in unmapped
// counters and skew costing aggregates without representing a real prep.
// Once a confident vendor SKU + master_id lands for these, remove the slug
// from this set and let the normal sync path take over.
export const SCAFFOLD_SKIP_SLUGS = new Set([
  'prime_rib',
  'chocolate_cake',
  'churros',
  'cupcakes',
  'mini_rellenos',
  'philo_bites',
  'tiramisu',
]);

// ── CSV parser ─────────────────────────────────────────────────────
// Quoted-field aware; tolerates embedded newlines and commas. Returns
// an array of {column → value} objects.
export function parseCsv(text) {
  const rows = [];
  let i = 0;
  while (i < text.length) {
    const row = [];
    while (i < text.length) {
      let field = '';
      if (text[i] === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            i++;
            break;
          }
          field += text[i++];
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
      }
      row.push(field);
      if (text[i] === ',') { i++; continue; }
      break;
    }
    while (text[i] === '\r' || text[i] === '\n') i++;
    rows.push(row);
  }
  if (rows.length === 0) return [];
  const header = rows.shift();
  return rows
    .filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h.trim(), (r[idx] ?? '').trim()])));
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function looksLikeSubRecipe(notes) {
  const n = String(notes ?? '').toLowerCase();
  return /\bsub[\s_-]?recipe\b/.test(n) || /\bvia\s+[a-z0-9_]+\.csv\b/.test(n);
}

function refreshRecipeFields(db, recipe) {
  db.prepare(
    `UPDATE entities_recipes
        SET display_name = ?,
            yield_qty = ?,
            yield_unit = ?,
            category = ?
      WHERE slug = ? AND location_id = ?`,
  ).run(
    recipe.display_name,
    recipe.yield_qty,
    recipe.yield_unit,
    recipe.category,
    recipe.slug,
    recipe.location_id,
  );
}

// ── Vendor-price enrichment lookup ─────────────────────────────────
//
// Build an in-memory index of vendor_prices for the given location keyed
// on `normalizeIngredientKey(vendor_prices.ingredient)`. Matches the
// fallback path inside lib/costingBenchmarks.mjs::computeCostVariance —
// when a bom_line's normalized ingredient key matches a vendor_prices row
// we re-attach the vendor columns.
//
// Two-tier lookup. The recipe-side ingredient names in
// `recipes/normalized/*.csv` are short, chef-facing (e.g. "kosher salt",
// "lime juice"), while vendor_prices.ingredient carries verbose SKU
// descriptions ("SALT, SEA WHT GRANULE 3LB KOSHER"). `ingredient_maps`
// is the production bridge between the two — workbook ingest writes
// confirmed `recipe_ingredient → vendor_ingredient` rows there.
//
// So we look up in two passes (matching computeCostVariance's "normalized
// ingredient key" matching pattern, just routed through the established
// bridge table):
//   1. Tier 1 — recipe-side: normalize the BOM ingredient and check
//      `ingredient_maps.recipe_ingredient` (normalized) for a confirmed
//      mapped row. If found, use its `vendor_ingredient` as the lookup
//      key into vendor_prices.
//   2. Tier 2 — direct: normalize the BOM ingredient and look it up
//      directly against `vendor_prices.ingredient` (normalized). This
//      is the literal computeCostVariance fallback path — useful when
//      ingredient_maps hasn't been populated for that name yet.
//
// Confidence rule: in either tier, a key is "confident" only when all
// resolved rows share a single vendor. Multi-vendor lookups are left
// unmapped — picking one would silently bias variance math. The
// preferred-vendor / mean resolution (T7) is master_id-keyed and stays
// authoritative when master_id is populated.
function buildVendorPriceIndex(db, locationId) {
  const rows = db
    .prepare(
      `SELECT ingredient, vendor, pack_price, pack_size, unit_price,
              yield_pct, master_id, id
         FROM vendor_prices
        WHERE location_id = ?
        ORDER BY imported_at DESC, id DESC`,
    )
    .all(locationId);

  // key → { rows: [...] } so we can detect multi-vendor ambiguity.
  const byKey = new Map();
  for (const r of rows) {
    const key = normalizeIngredientKey(r.ingredient ?? '');
    if (!key) continue;
    let entry = byKey.get(key);
    if (!entry) { entry = { rows: [] }; byKey.set(key, entry); }
    entry.rows.push(r);
  }
  return byKey;
}

// Build a normalized recipe_ingredient → vendor_ingredient map. Operator-
// curated `confirmed` rows and workbook `mapped` rows are both honoured.
function buildIngredientMapIndex(db, locationId) {
  const rows = db
    .prepare(
      `SELECT recipe_ingredient, vendor_ingredient
         FROM ingredient_maps
        WHERE location_id = ?
          AND status IN ('mapped', 'confirmed')
          AND vendor_ingredient IS NOT NULL
          AND vendor_ingredient != ''`,
    )
    .all(locationId);
  const byRecipeKey = new Map();
  for (const r of rows) {
    const key = normalizeIngredientKey(r.recipe_ingredient ?? '');
    if (!key) continue;
    // First mapping wins on duplicate keys; ingredient_maps is expected
    // to be deduped by ingest_costing's upsert, but defensive guard
    // doesn't hurt.
    if (!byRecipeKey.has(key)) byRecipeKey.set(key, r.vendor_ingredient);
  }
  return byRecipeKey;
}

function pickSingleVendorRow(entry) {
  if (!entry || entry.rows.length === 0) return null;
  // Pick the latest row per distinct vendor (vendor_prices was already
  // ORDERed by imported_at DESC, id DESC, so first-seen-per-vendor wins).
  const seen = new Set();
  const latestPerVendor = [];
  for (const r of entry.rows) {
    const v = r.vendor ?? '';
    if (seen.has(v)) continue;
    seen.add(v);
    latestPerVendor.push(r);
  }
  if (latestPerVendor.length !== 1) return null;
  return latestPerVendor[0];
}

// Resolve enrichment for one ingredient name. Returns either a vendor-
// columns object (mapped) or { mapped: false } (unmapped/ambiguous).
//
// `tier` distinguishes the resolution path so the caller can pick the
// right map_status: tier 1 (ingredient_maps bridge → human-confirmed →
// map_status='mapped') vs tier 2 (direct normalized-name fuzzy match →
// machine-inferred → map_status='auto_mapped'). The B2 attention queue
// in lib/costingBenchmarks.mjs treats both as "good" (no review needed)
// but downstream UIs can filter on map_status='auto_mapped' to flag rows
// that landed via the fuzzy fallback and may need confirmation. Keeping
// this distinction honest avoids the HACCP "never silently auto-correct"
// trap.
function resolveVendorEnrichment(vpIndex, imIndex, ingredientName) {
  const key = normalizeIngredientKey(ingredientName ?? '');
  if (!key) return { mapped: false };

  // Tier 1: recipe-side bridge via ingredient_maps.
  const vendorIngredient = imIndex.get(key);
  if (vendorIngredient) {
    const vendorKey = normalizeIngredientKey(vendorIngredient);
    if (vendorKey) {
      const hit = pickSingleVendorRow(vpIndex.get(vendorKey));
      if (hit) {
        return {
          mapped: true,
          tier: 1,
          vendor: hit.vendor ?? null,
          pack_price: effectivePackPrice(hit),
          pack_size: hit.pack_size ?? null,
          vendor_ingredient: hit.ingredient ?? null,
          yield_pct: hit.yield_pct ?? null,
          master_id: hit.master_id ?? null,
        };
      }
    }
  }

  // Tier 2: direct normalized-name match against vendor_prices.
  const direct = pickSingleVendorRow(vpIndex.get(key));
  if (direct) {
    return {
      mapped: true,
      tier: 2,
      vendor: direct.vendor ?? null,
      pack_price: effectivePackPrice(direct),
      pack_size: direct.pack_size ?? null,
      vendor_ingredient: direct.ingredient ?? null,
      yield_pct: direct.yield_pct ?? null,
      master_id: direct.master_id ?? null,
    };
  }

  return { mapped: false };
}

// ── Core sync function ─────────────────────────────────────────────
//
// Pure-ish: takes a DB handle + already-parsed inputs. Splitting parsing
// from DB writes makes the unit test trivial — pass in synthetic rows.
export function syncNormalizedRecipes(db, opts) {
  const {
    indexRows,
    csvByRecipeId,
    locationId = 'default',
    dryRun = false,
    resolveRecipe, // injected for testability; default below
    scaffoldSkipSlugs = SCAFFOLD_SKIP_SLUGS,
  } = opts;

  const knownSlugs = new Set(indexRows.map((r) => r.recipe_id));

  const summary = {
    recipes_in_index: indexRows.length,
    recipes_with_csv: 0,
    recipes_skipped_no_csv: 0,
    recipes_skipped_scaffold: 0,
    recipes_upserted: 0,
    bom_lines_written: 0,
    sub_recipe_links: 0,
    vendor_columns_populated: 0,
    vendor_columns_auto_mapped: 0,
    vendor_columns_unmapped: 0,
  };

  // Build vendor-price + ingredient-map indices once per call. In dry-run
  // mode the indices are still useful — counters reflect what WOULD be
  // populated.
  const vpIndex = buildVendorPriceIndex(db, locationId);
  const imIndex = buildIngredientMapIndex(db, locationId);

  let runId = null;
  if (!dryRun) {
    runId = Number(
      db.prepare(
        `INSERT INTO ingest_runs (kind, started_at, status, rows_in)
         VALUES ('sync_normalized_csv', datetime('now','subsec'), 'running', ?)`,
      ).run(indexRows.length).lastInsertRowid,
    );
  }

  try {
    db.transaction(() => {
      const insBomLine = db.prepare(`
        INSERT INTO bom_lines (
          recipe_id, ingredient, qty, unit, sub_recipe,
          vendor, pack_price, pack_size, vendor_ingredient,
          map_status, yield_pct, master_id, location_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const delBomForRecipe = db.prepare(
        `DELETE FROM bom_lines WHERE recipe_id = ? AND location_id = ?`,
      );

      for (const row of indexRows) {
        const slug = String(row.recipe_id || '').trim();
        if (!slug) continue;

        if (scaffoldSkipSlugs.has(slug)) {
          // 1-ingredient placeholder — skip both entities_recipes upsert
          // and bom_lines insert. See SCAFFOLD_SKIP_SLUGS comment for why.
          summary.recipes_skipped_scaffold++;
          continue;
        }

        const csvRows = csvByRecipeId.get(slug);
        if (!csvRows) {
          summary.recipes_skipped_no_csv++;
          continue;
        }
        summary.recipes_with_csv++;

        if (!dryRun) {
          const yieldQty = Number.parseFloat(row.yield);
          const yieldUnit = (row.yield_unit || '').trim() || null;
          const recipe = {
            source_system: 'manual',
            external_id: slug,
            slug,
            display_name: (row.recipe_name || slug).trim(),
            yield_qty: Number.isFinite(yieldQty) ? yieldQty : null,
            yield_unit: yieldUnit,
            category: (row.category || '').trim() || null,
            location_id: locationId,
          };
          resolveRecipe(db, recipe);
          refreshRecipeFields(db, recipe);
          summary.recipes_upserted++;

          delBomForRecipe.run(slug, locationId);
        }

        for (const ing of csvRows) {
          const name = String(ing.ingredient || '').trim();
          if (!name) continue;
          const qtyParsed = Number.parseFloat(ing.qty);
          const qty = Number.isFinite(qtyParsed) ? qtyParsed : null;
          const unit = (String(ing.unit || '').trim()) || null;
          const notes = ing.notes || '';

          let subRecipe = null;
          if (looksLikeSubRecipe(notes)) {
            const candidate = slugify(name);
            if (knownSlugs.has(candidate)) {
              subRecipe = candidate;
              summary.sub_recipe_links++;
            }
          }

          // Sub-recipe lines aren't matched against vendor_prices — they
          // resolve through their own recipe's BOM, not via a vendor SKU.
          // Counters track them separately (not as unmapped).
          let enrichment = { mapped: false };
          if (subRecipe == null) {
            enrichment = resolveVendorEnrichment(vpIndex, imIndex, name);
            if (enrichment.mapped) {
              summary.vendor_columns_populated++;
              if (enrichment.tier === 2) summary.vendor_columns_auto_mapped++;
            } else {
              summary.vendor_columns_unmapped++;
            }
          }

          // Tier 1 (ingredient_maps bridge, human-confirmed via ingest-costing)
          // → 'mapped'. Tier 2 (direct normalized-name fuzzy match, machine-
          // inferred) → 'auto_mapped'. Both pass GOOD_STATUSES in computeUnmapped
          // so neither shows in the B2 attention queue, but downstream UIs can
          // distinguish them by status to surface fuzzy matches for confirmation.
          const mapStatus = subRecipe != null
            ? null
            : (!enrichment.mapped
                ? 'UNMAPPED'
                : (enrichment.tier === 2 ? 'auto_mapped' : 'mapped'));

          if (!dryRun) {
            insBomLine.run(
              slug,
              name,
              qty,
              unit,
              subRecipe,
              enrichment.mapped ? enrichment.vendor : null,
              enrichment.mapped ? enrichment.pack_price : null,
              enrichment.mapped ? enrichment.pack_size : null,
              enrichment.mapped ? enrichment.vendor_ingredient : null,
              mapStatus,
              enrichment.mapped ? enrichment.yield_pct : null,
              enrichment.mapped ? enrichment.master_id : null,
              locationId,
            );
          }
          summary.bom_lines_written++;
        }
      }
    })();

    if (!dryRun && runId != null) {
      db.prepare(
        `UPDATE ingest_runs
            SET status='ok',
                finished_at=datetime('now','subsec'),
                rows_out=?
          WHERE id=?`,
      ).run(summary.bom_lines_written, runId);
    }
  } catch (err) {
    if (!dryRun && runId != null) {
      db.prepare(
        `UPDATE ingest_runs
            SET status='failed',
                finished_at=datetime('now','subsec')
          WHERE id=?`,
      ).run(runId);
    }
    throw err;
  }

  return summary;
}

// ── Filesystem-driven entry (CLI + the default for callers) ───────
export function loadNormalizedFromDisk(opts = {}) {
  const indexPath = opts.indexCsv ?? DEFAULT_INDEX_CSV;
  const normalizedDir = opts.normalizedDir ?? DEFAULT_NORMALIZED_DIR;

  const indexRows = parseCsv(fs.readFileSync(indexPath, 'utf-8'));
  const csvByRecipeId = new Map();
  for (const row of indexRows) {
    const slug = (row.recipe_id || '').trim();
    if (!slug) continue;
    const csvPath = path.join(normalizedDir, `${slug}.csv`);
    if (!fs.existsSync(csvPath)) continue;
    csvByRecipeId.set(slug, parseCsv(fs.readFileSync(csvPath, 'utf-8')));
  }
  return { indexRows, csvByRecipeId };
}

// CLI — strictly compare the resolved path so the block does NOT fire
// when the script is `import`ed (e.g. by tests/js/test-sync-normalized-to-bom.mjs,
// whose path also `endsWith('sync-normalized-to-bom.mjs')` and previously
// triggered an accidental on-disk DB write during the test run).
const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    const argUrl = new URL(`file://${path.resolve(arg)}`).href;
    return import.meta.url === argUrl;
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry') || args.includes('--dry-run');
  const locArg = args.find((a) => a.startsWith('--location='));
  const locationId = locArg ? locArg.split('=', 2)[1] : 'default';

  const [{ getDb }, { resolveOrCreateRecipe }] = await Promise.all([
    import('../lib/db.ts'),
    import('../lib/entities.ts'),
  ]);

  const db = getDb();
  const { indexRows, csvByRecipeId } = loadNormalizedFromDisk();
  const summary = syncNormalizedRecipes(db, {
    indexRows,
    csvByRecipeId,
    locationId,
    dryRun,
    resolveRecipe: resolveOrCreateRecipe,
  });

  console.log(JSON.stringify({ mode: dryRun ? 'dry' : 'apply', location: locationId, summary }, null, 2));
}
