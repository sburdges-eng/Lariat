// Backfill entities_ingredients from existing source tables.
//
// Two passes:
//   1. ingredient_masters — the existing canonical table. master_id is
//      already a normalized slug, so use it as both ingredient_key and
//      external_id. canonical_name → display_name.
//   2. Distinct ingredient TEXT from bom_lines + vendor_prices. We
//      normalize each via lib/ingredientKey.normalizeIngredientKey()
//      and create a row only if that key isn't already covered by (1).
//
// The resolver dedupes on UNIQUE(ingredient_key) globally, so the same
// key from two different sources (Sysco SKU + Shamrock SKU) lands on
// one entity UUID and registers two external_ids rows.

import { resolveOrCreateIngredient } from '../../lib/entities.ts';
import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';
import { makeTally, bumpTally } from './lib.mjs';

const INGREDIENT_TEXT_TABLES = [
  ['bom_lines', 'ingredient'],
  ['vendor_prices', 'ingredient'],
  ['order_guide_items', 'ingredient'],
];

function tableExists(db, name) {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function backfillFromMasters(db, apply, tally) {
  if (!tableExists(db, 'ingredient_masters')) return new Set();
  const rows = db
    .prepare(
      `SELECT master_id, canonical_name, category
         FROM ingredient_masters
        WHERE master_id IS NOT NULL AND TRIM(master_id) != ''`,
    )
    .all();
  const seenKeys = new Set();
  for (const r of rows) {
    const key = String(r.master_id).trim();
    seenKeys.add(key);
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='ingredient' AND source_system='manual'
              AND external_id=? AND location_id='default'`,
        )
        .get(key);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const result = resolveOrCreateIngredient(db, {
        source_system: 'manual',
        external_id: key,
        ingredient_key: key,
        display_name: r.canonical_name ?? key,
        category: r.category ?? null,
        metadata: { source: 'ingredient_masters' },
      });
      bumpTally(tally, result.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`ingredients: master_id=${key}: ${err.message}`);
    }
  }
  return seenKeys;
}

function backfillFromTextColumns(db, knownKeys, apply, tally) {
  for (const [t, col] of INGREDIENT_TEXT_TABLES) {
    if (!tableExists(db, t)) continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols.includes(col)) continue;
    const rows = db
      .prepare(`SELECT DISTINCT ${col} AS v FROM ${t} WHERE ${col} IS NOT NULL AND TRIM(${col}) != ''`)
      .all();
    for (const r of rows) {
      const original = String(r.v).trim();
      const key = normalizeIngredientKey(original);
      if (!key) {
        bumpTally(tally, 'skipped');
        continue;
      }
      if (knownKeys.has(key)) {
        bumpTally(tally, 'reused');
        continue;
      }
      // Mark seen so subsequent tables in the loop don't double-count.
      knownKeys.add(key);
      if (!apply) {
        const exists = db
          .prepare(
            `SELECT 1 FROM external_ids
              WHERE entity_type='ingredient' AND source_system='manual'
                AND external_id=? AND location_id='default'`,
          )
          .get(key);
        bumpTally(tally, exists ? 'reused' : 'created');
        continue;
      }
      try {
        const result = resolveOrCreateIngredient(db, {
          source_system: 'manual',
          external_id: key,
          ingredient_key: key,
          display_name: original,
          metadata: { source: t, original },
        });
        bumpTally(tally, result.created ? 'created' : 'reused');
      } catch (err) {
        bumpTally(tally, 'error');
        console.error(`ingredients: ${t}.${col}=${key}: ${err.message}`);
      }
    }
  }
}

export function backfillIngredients(db, { apply = false } = {}) {
  const tally = makeTally();
  const seenKeys = backfillFromMasters(db, apply, tally);
  backfillFromTextColumns(db, seenKeys, apply, tally);
  return tally;
}
