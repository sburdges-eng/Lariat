// @ts-check
/** @typedef {import('better-sqlite3').Database} Db */

/**
 * @param {Db} db
 * @param {string} loc
 * @param {string[]} ingredients
 * @returns {Map<string, string[]>}
 */
export function affectedDishes(db, loc, ingredients) {
  if (ingredients.length === 0) return new Map();
  const placeholders = ingredients.map(() => '?').join(',');
  const rows = /** @type {{ ingredient: string, dish_name: string }[]} */ (
    db
      .prepare(
        `SELECT vendor_ingredient AS ingredient, dish_name
           FROM dish_components
          WHERE location_id = ?
            AND component_type = 'vendor_item'
            AND vendor_ingredient IN (${placeholders})`,
      )
      .all(loc, ...ingredients)
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.ingredient)) out.set(r.ingredient, []);
    out.get(r.ingredient).push(r.dish_name);
  }
  for (const [k, v] of out) {
    out.set(k, [...new Set(v)].sort());
  }
  return out;
}

/**
 * @param {Db} db
 * @param {string} loc
 * @param {string[]} ingredients
 * @returns {Map<string, string[]>}
 */
export function affectedRecipes(db, loc, ingredients) {
  if (ingredients.length === 0) return new Map();
  const placeholders = ingredients.map(() => '?').join(',');
  const rows = /** @type {{ ingredient: string, recipe_id: string }[]} */ (
    db
      .prepare(
        `SELECT vendor_ingredient AS ingredient, recipe_id
           FROM bom_lines
          WHERE location_id = ?
            AND vendor_ingredient IN (${placeholders})`,
      )
      .all(loc, ...ingredients)
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.ingredient)) out.set(r.ingredient, []);
    out.get(r.ingredient).push(r.recipe_id);
  }
  for (const [k, v] of out) {
    out.set(k, [...new Set(v)].sort());
  }
  return out;
}
