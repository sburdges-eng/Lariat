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
//      The vendor-side costing fields (vendor, pack_price, pack_size,
//      vendor_ingredient, map_status, yield_pct, loss_factor) are LEFT NULL —
//      `npm run ingest:costing` is still authoritative for those, and writes
//      them on its next pass.
//
// Sub-recipe detection: an ingredient row is treated as a sub-recipe (and
// the bom_lines.sub_recipe column is populated) when the row's `notes`
// column contains "sub-recipe" / "sub_recipe" / "via <slug>.csv" AND the
// slugified ingredient name matches a recipe_id in recipe_index.csv.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_INDEX_CSV = path.join(ROOT, 'recipes', 'recipe_index.csv');
const DEFAULT_NORMALIZED_DIR = path.join(ROOT, 'recipes', 'normalized');

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
  } = opts;

  const knownSlugs = new Set(indexRows.map((r) => r.recipe_id));

  const summary = {
    recipes_in_index: indexRows.length,
    recipes_with_csv: 0,
    recipes_skipped_no_csv: 0,
    recipes_upserted: 0,
    bom_lines_written: 0,
    sub_recipe_links: 0,
  };

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
        INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, location_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const delBomForRecipe = db.prepare(
        `DELETE FROM bom_lines WHERE recipe_id = ? AND location_id = ?`,
      );

      for (const row of indexRows) {
        const slug = String(row.recipe_id || '').trim();
        if (!slug) continue;
        const csvRows = csvByRecipeId.get(slug);
        if (!csvRows) {
          summary.recipes_skipped_no_csv++;
          continue;
        }
        summary.recipes_with_csv++;

        if (!dryRun) {
          const yieldQty = Number.parseFloat(row.yield);
          const yieldUnit = (row.yield_unit || '').trim() || null;
          resolveRecipe(db, {
            source_system: 'manual',
            external_id: slug,
            slug,
            display_name: (row.recipe_name || slug).trim(),
            yield_qty: Number.isFinite(yieldQty) ? yieldQty : null,
            yield_unit: yieldUnit,
            category: (row.category || '').trim() || null,
            location_id: locationId,
          });
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

          if (!dryRun) {
            insBomLine.run(slug, name, qty, unit, subRecipe, locationId);
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
