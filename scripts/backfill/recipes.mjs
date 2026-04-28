// Backfill entities_recipes from two sources:
//   1. data/cache/recipes.json — the curated, hand-written kitchen book.
//      Each recipe has a `slug` that is the canonical ID across the app.
//      Tagged source='manual', external_id=slug.
//   2. Distinct bom_lines.recipe_id values that aren't covered by (1).
//      These are recipes that have BOM data but no curated entry — we
//      still want a UUID for them so cost math has a target.
//      Tagged source='manual', external_id=recipe_id.
//
// Resolver merges by (slug, location_id), so a recipes.json entry and a
// bom_lines.recipe_id with the same slug land on the same UUID.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOrCreateRecipe } from '../../lib/entities.ts';
import { makeTally, bumpTally } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RECIPES_JSON = path.join(REPO_ROOT, 'data', 'cache', 'recipes.json');

function tableExists(db, name) {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function readRecipesJson() {
  if (!fs.existsSync(RECIPES_JSON)) return [];
  try {
    const raw = fs.readFileSync(RECIPES_JSON, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.error(`recipes: failed to parse ${RECIPES_JSON}: ${err.message}`);
    return [];
  }
}

function backfillFromJson(db, recipes, apply, tally) {
  for (const r of recipes) {
    const slug = (r?.slug ?? '').trim();
    if (!slug) {
      bumpTally(tally, 'skipped');
      continue;
    }
    const locationId = 'default';
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='recipe' AND source_system='manual'
              AND external_id=? AND location_id=?`,
        )
        .get(slug, locationId);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const result = resolveOrCreateRecipe(db, {
        source_system: 'manual',
        external_id: slug,
        slug,
        display_name: r.name ?? slug,
        yield_qty: typeof r.yield_qty === 'number' ? r.yield_qty : null,
        yield_unit: r.yield_unit ?? null,
        category: r.category ?? null,
        location_id: locationId,
        metadata: { source: r.source ?? 'recipes.json' },
      });
      bumpTally(tally, result.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`recipes: slug=${slug}: ${err.message}`);
    }
  }
}

function backfillFromBom(db, knownSlugs, apply, tally) {
  if (!tableExists(db, 'bom_lines')) return;
  const rows = db
    .prepare(
      `SELECT DISTINCT recipe_id, location_id
         FROM bom_lines
        WHERE recipe_id IS NOT NULL AND TRIM(recipe_id) != ''`,
    )
    .all();
  for (const r of rows) {
    const slug = String(r.recipe_id).trim();
    if (knownSlugs.has(slug)) {
      // Already handled by the recipes.json pass — the resolver would
      // dedupe on (slug, location_id), but counting as 'reused' here
      // gives the operator a clearer "X bom recipes were already in
      // recipes.json" signal in the report.
      bumpTally(tally, 'reused');
      continue;
    }
    const locationId = r.location_id ?? 'default';
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='recipe' AND source_system='manual'
              AND external_id=? AND location_id=?`,
        )
        .get(slug, locationId);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const result = resolveOrCreateRecipe(db, {
        source_system: 'manual',
        external_id: slug,
        slug,
        display_name: slug,
        location_id: locationId,
        metadata: { source: 'bom_lines' },
      });
      bumpTally(tally, result.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`recipes: bom slug=${slug}: ${err.message}`);
    }
  }
}

export function backfillRecipes(db, { apply = false } = {}) {
  const tally = makeTally();
  const recipes = readRecipesJson();
  const knownSlugs = new Set(
    recipes.map((r) => (r?.slug ?? '').trim()).filter(Boolean),
  );
  backfillFromJson(db, recipes, apply, tally);
  backfillFromBom(db, knownSlugs, apply, tally);
  return tally;
}
