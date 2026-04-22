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
  const type = input.component_type ?? 'recipe';
  if (type !== 'recipe' && type !== 'vendor_item') {
    return { ok: false, reason: 'component_type must be "recipe" or "vendor_item"' };
  }
  if (type === 'recipe') {
    if (!input.recipe_slug || typeof input.recipe_slug !== 'string' || !input.recipe_slug.trim()) {
      return { ok: false, reason: 'recipe_slug is required for recipe components' };
    }
    if (input.vendor_ingredient) {
      return { ok: false, reason: 'vendor_ingredient must be empty for recipe components' };
    }
  } else {
    if (!input.vendor_ingredient || typeof input.vendor_ingredient !== 'string' || !input.vendor_ingredient.trim()) {
      return { ok: false, reason: 'vendor_ingredient is required for vendor_item components' };
    }
    if (input.recipe_slug) {
      return { ok: false, reason: 'recipe_slug must be empty for vendor_item components' };
    }
  }
  const qty = Number(input.qty_per_serving);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, reason: 'qty_per_serving must be a positive number' };
  }
  if (!input.unit || typeof input.unit !== 'string' || !input.unit.trim()) {
    return { ok: false, reason: 'unit is required' };
  }
  return { ok: true };
}

export { KNOWN_UNITS };
