/**
 * Recipe persistence helpers.
 *
 * Recipe storage is split across two stores by historical accident:
 *   - `data/cache/recipes.json` is the canonical recipe document
 *     (name, ingredients[], procedures, allergens, yield, etc). It is
 *     read by `lib/data.ts::getRecipes()` and consumed throughout the
 *     app — kitchen assistant, allergen rollups, dish coverage, etc.
 *   - `entities_recipes` (DB table) is the canonical entity registry —
 *     a stable UUID per (slug, location_id) plus display_name / yield /
 *     category. It does NOT carry ingredients or procedures; those
 *     live in the JSON document.
 *
 * A management edit therefore writes to BOTH stores. To keep them
 * coherent, this module exposes:
 *   - `upsertRecipeEntity()` — DB upsert into `entities_recipes`. The
 *     caller is expected to wrap this in a `db.transaction(() => {...})`
 *     so the audit row from `postAuditEvent()` rolls back together.
 *   - `writeRecipeDoc()` — atomic write of the recipes.json entry.
 *     Called AFTER the DB transaction commits; if it fails the audit
 *     row stays put, which is the right call (someone hit "save" and
 *     the entity row + audit reflect that) but the caller surfaces a
 *     500. JSON-cache mtime invalidation in `lib/data.ts` picks up the
 *     new content on the next read.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { resolveDataDir } from './dataDir.ts';
import { uuidv7 } from './uuid.ts';
import type { Recipe } from './data.ts';

// Resolve at call time so process.cwd() drift between dev (`npm run dev`
// from repo root) and prod (Electron child cwd != repo root) doesn't
// matter. The prod desktop wrapper sets LARIAT_DATA_DIR; the dev server
// falls back to process.cwd()/data. Mirrors the cacheRoot() pattern in
// lib/data.ts so this module stays consistent with getRecipeBySlug.
function recipesJsonPath(): string {
  return path.join(resolveDataDir(), 'cache', 'recipes.json');
}

export interface RecipeEntityInput {
  slug: string;
  display_name: string;
  yield_qty?: number | null;
  yield_unit?: string | null;
  category?: string | null;
  location_id?: string;
}

export interface UpsertResult {
  uuid: string;
  created: boolean;
}

/**
 * UPSERT into `entities_recipes` keyed on (slug, location_id). MUST be
 * called inside a `db.transaction(...)` — the caller is expected to
 * post the matching `audit_events` row in the same transaction.
 *
 * Returns the canonical UUID and whether the row was newly created.
 */
export function upsertRecipeEntity(
  db: Database,
  input: RecipeEntityInput,
): UpsertResult {
  const location_id = input.location_id ?? 'default';
  const existing = db
    .prepare(
      `SELECT uuid FROM entities_recipes WHERE slug = ? AND location_id = ?`,
    )
    .get(input.slug, location_id) as { uuid: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE entities_recipes
          SET display_name = ?,
              yield_qty    = ?,
              yield_unit   = ?,
              category     = ?,
              updated_at   = datetime('now')
        WHERE uuid = ?`,
    ).run(
      input.display_name,
      input.yield_qty ?? null,
      input.yield_unit ?? null,
      input.category ?? null,
      existing.uuid,
    );
    return { uuid: existing.uuid, created: false };
  }

  const uuid = uuidv7();
  db.prepare(
    `INSERT INTO entities_recipes
       (uuid, slug, display_name, yield_qty, yield_unit, category, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uuid,
    input.slug,
    input.display_name,
    input.yield_qty ?? null,
    input.yield_unit ?? null,
    input.category ?? null,
    location_id,
  );
  return { uuid, created: true };
}

/**
 * Atomically rewrite `data/cache/recipes.json` with `recipe` upserted
 * by slug. Existing recipes are preserved verbatim. The order is
 * preserved (updated entry stays at its existing index; new entries
 * are appended).
 *
 * Atomic = write to a sibling temp file + rename. A crash mid-write
 * leaves the previous file untouched.
 */
export function writeRecipeDoc(recipe: Recipe): void {
  const recipesJson = recipesJsonPath();
  const cacheDir = path.dirname(recipesJson);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  let existing: Recipe[] = [];
  if (fs.existsSync(recipesJson)) {
    try {
      const raw = fs.readFileSync(recipesJson, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed as Recipe[];
    } catch {
      // Corrupt file — fall through with empty list. The rewrite
      // produces a valid file; we accept the loss because the JSON
      // was already unparseable to readers.
      existing = [];
    }
  }

  let replaced = false;
  const next = existing.map((r) => {
    if (r.slug === recipe.slug) {
      replaced = true;
      return recipe;
    }
    return r;
  });
  if (!replaced) next.push(recipe);

  const tmp = `${recipesJson}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, recipesJson);
}

/**
 * Read a single recipe by slug from `<dataDir>/cache/recipes.json`. Returns
 * null if the cache file is missing or the slug isn't present.
 */
export function readRecipeDoc(slug: string): Recipe | null {
  const recipesJson = recipesJsonPath();
  if (!fs.existsSync(recipesJson)) return null;
  try {
    const raw = fs.readFileSync(recipesJson, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const found = (parsed as Recipe[]).find((r) => r.slug === slug);
    return found ?? null;
  } catch {
    return null;
  }
}
