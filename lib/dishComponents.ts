import type { DishComponent } from './db';

const KNOWN_UNITS = new Set([
  // weight
  'g', 'kg', 'oz', 'lb',
  // volume
  'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'floz', 'cup', 'pt', 'qt', 'gal',
  // count
  'each', 'ea', 'piece', 'slice', 'leaf', 'sprig', 'clove',
]);

export function validateDishComponent(input: Partial<DishComponent> | null | undefined): {
  ok: boolean;
  reason?: string;
} {
  if (!input || typeof input !== 'object') {
    return { ok: false, reason: 'body must be an object' };
  }
  if (!input.dish_name || typeof input.dish_name !== 'string' || !input.dish_name.trim()) {
    return { ok: false, reason: 'dish_name is required' };
  }
  if (!input.recipe_slug || typeof input.recipe_slug !== 'string' || !input.recipe_slug.trim()) {
    return { ok: false, reason: 'recipe_slug is required' };
  }
  const qty = Number(input.qty_per_serving);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: 'qty_per_serving must be a positive number' };
  }
  if (!input.unit || typeof input.unit !== 'string' || !input.unit.trim()) {
    return { ok: false, reason: 'unit is required' };
  }
  // Soft-warn rather than hard-reject on unknown units — the unit_convert
  // layer will surface the real failure if it can't bridge to the recipe's
  // yield_unit. Allow anything string-shaped.
  return { ok: true };
}

export { KNOWN_UNITS };
