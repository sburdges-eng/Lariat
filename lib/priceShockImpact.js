// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
export function affectedDishes(db, loc, ingredients) {
  if (ingredients.length === 0) return new Map();
  const placeholders = ingredients.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT vendor_ingredient AS ingredient, dish_name
         FROM dish_components
        WHERE location_id = ?
          AND component_type = 'vendor_item'
          AND vendor_ingredient IN (${placeholders})`,
    )
    .all(loc, ...ingredients);
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

export function affectedRecipes(db, loc, ingredients) {
  if (ingredients.length === 0) return new Map();
  const placeholders = ingredients.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT vendor_ingredient AS ingredient, recipe_id
         FROM bom_lines
        WHERE location_id = ?
          AND vendor_ingredient IN (${placeholders})`,
    )
    .all(loc, ...ingredients);
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
