/**
 * Dish → Recipe → Ingredient → Vendor bridge.
 *
 * Wires the four-layer chain that costing ultimately depends on:
 *
 *   Toast dish (sales_lines.item_name / toast_menu_items.name)
 *     → recipes.menu_items[] declarations  (canonical, hand-curated bridge)
 *     → dish_components rows               (per-serving qty + unit; hand-entered)
 *     → recipe_costs.cost_per_yield_unit   (computed by ingest-costing.mjs)
 *     → bom_lines + vendor_prices          (the actual money side)
 *
 * The previous menuEngineering implementation used fuzzy substring matching
 * between dish names and recipe names — structurally doomed because almost
 * every recipe in this repo is a SUB-recipe (sauces, batters, brines), not a
 * dish. This module replaces that with an explicit two-stage bridge:
 *
 *   1. Discovery: which recipes go into a dish?  Read from
 *      `recipes.menu_items[]` (curated in recipes.json).
 *
 *   2. Quantity: how MUCH of each recipe per serving?  Read from
 *      `dish_components` (hand-populated via /menu-engineering/components).
 *      Without this row, we can list the components but not produce a $ figure.
 *
 * Per-serving cost = Σ over components ( qty_per_serving × cost_per_yield_unit ),
 * with unit conversion via lib/unitConvert.mjs when the component unit and
 * yield_unit differ in dimension-compatible ways (volume↔volume, weight↔weight).
 *
 * Sales/menu rows whose item_name is a literal "TOTAL" / "TOTALS" (CSV
 * footer noise from Toast exports) are filtered upstream by `cleanedSalesRows`.
 */

import { getDb, type RecipeCost, type DishComponent } from './db';
import { getRecipes, type Recipe } from './data';
// Reuse the costing engine's unit converter.
import { convertQty } from './unitConvert.mjs';

const SALES_NOISE_DISH_NAMES = new Set(['total', 'totals']);

/**
 * Canonicalize a dish name for cross-source matching.
 * Lowercase, collapse non-alphanumerics to a single space, trim.
 *
 * Toast exports the same dish with surprising case/punctuation drift
 * ("Mtn Mac & Cheese", "MTN MAC AND CHEESE", "mtn mac n cheese"); we
 * collapse to a stable key. The "&"/"and" gap is intentionally NOT closed
 * here — that's a per-dish alias decision, not a normalization concern.
 */
export function normalizeDishName(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface DishComponentResolved {
  /** 'recipe' (sub-recipe) or 'vendor_item' (raw distributor item like a bun, patty, cheese slice). */
  component_type: 'recipe' | 'vendor_item';
  /** Populated when component_type='recipe'. */
  recipe_slug: string | null;
  /** Populated when component_type='vendor_item' — matches vendor_prices.ingredient. */
  vendor_ingredient: string | null;
  /** Display name (recipe.name for recipes; vendor ingredient string for vendor_items). */
  display_name: string;
  qty_per_serving: number | null;        // null = no dish_components row yet
  unit: string | null;                    // null = no dish_components row yet
  /** Per-base-unit price. For 'recipe', cost_per_yield_unit. For 'vendor_item', vendor_prices.unit_price. */
  unit_price: number | null;
  /** Base unit of unit_price. For 'recipe', yield_unit. For 'vendor_item', vendor_prices.pack_unit. */
  base_unit: string | null;
  /** Computed per-serving $ for this component, null if missing data or unit-convert failed. */
  per_serving_cost: number | null;
  /** Human-readable reason if per_serving_cost is null. */
  status:
    | 'ok'
    | 'no_dish_component'
    | 'no_recipe_cost'
    | 'no_vendor_price'
    | 'unit_convert_failed';
}

/** Vendor pricing index for vendor_item component resolution. */
interface VendorPriceLookup {
  ingredient: string;
  unit_price: number | null;
  pack_unit: string | null;
}

export interface DishCostResult {
  dish_name: string;
  /** Canonical (normalized) form. */
  dish_name_normalized: string;
  components: DishComponentResolved[];
  /** Sum of per_serving_cost across components where computable. Null if zero components or all missing. */
  total_cost: number | null;
  /** True if every component resolved to a number. */
  fully_costed: boolean;
  /** Bridge classification for UI labeling. */
  link_state:
    | 'unlinked'           // no recipes.menu_items[] entry AND no dish_components row
    | 'declared_only'      // recipe declares the link but no dish_components row exists
    | 'partial'            // some components have dish_components, some don't
    | 'fully_linked';      // all declared components have dish_components rows
}

/**
 * Build the canonical dish→recipes map.
 *
 * Two sources, in priority order:
 *   1. `dish_components` table — explicit per-serving quantities (the
 *      authoritative source once populated).
 *   2. `recipes.menu_items[]` — declarative "this recipe goes into these
 *      dishes" without quantities (the discovery layer).
 *
 * The dish_components rows take precedence: if a row exists for
 * (dish, recipe), use its qty/unit. Otherwise the recipe shows as a
 * declared-but-unmeasured component.
 */
export function buildDishComponentMap(
  locationId: string = 'default',
  recipesOverride?: Recipe[],
): Map<string, DishComponentResolved[]> {
  const db = getDb();
  const recipes = recipesOverride ?? getRecipes();

  // ── Recipe pricing index ──
  // recipe_slug → { name, cost_per_yield_unit, yield_unit }
  const recipeIndex = new Map<
    string,
    { name: string; cost_per_yield_unit: number | null; yield_unit: string | null }
  >();
  for (const r of recipes) {
    recipeIndex.set(r.slug, { name: r.name, cost_per_yield_unit: null, yield_unit: null });
  }
  const costRows = db
    .prepare(
      `SELECT recipe_id, recipe_name, cost_per_yield_unit, yield_unit
         FROM recipe_costs
        WHERE location_id = ? AND recipe_id != 'TOTAL'`,
    )
    .all(locationId) as RecipeCost[];
  for (const c of costRows) {
    const existing = recipeIndex.get(c.recipe_id) || {
      name: c.recipe_name || c.recipe_id,
      cost_per_yield_unit: null,
      yield_unit: null,
    };
    existing.cost_per_yield_unit = c.cost_per_yield_unit;
    existing.yield_unit = c.yield_unit;
    if (!existing.name && c.recipe_name) existing.name = c.recipe_name;
    recipeIndex.set(c.recipe_id, existing);
  }

  // ── Vendor pricing index ──
  // For vendor_item components: ingredient → most-recent unit_price + pack_unit.
  // We pick the latest imported_at row per ingredient (newest pricing wins).
  const vendorIndex = new Map<string, VendorPriceLookup>();
  const vpRows = db
    .prepare(
      `SELECT vp.ingredient, vp.unit_price, vp.pack_unit
         FROM vendor_prices vp
         JOIN (
           SELECT ingredient, MAX(imported_at) AS m
             FROM vendor_prices
            WHERE location_id = ?
            GROUP BY ingredient
         ) latest ON latest.ingredient = vp.ingredient AND latest.m = vp.imported_at
        WHERE vp.location_id = ?`,
    )
    .all(locationId, locationId) as VendorPriceLookup[];
  for (const vp of vpRows) {
    vendorIndex.set(vp.ingredient.toLowerCase().trim(), {
      ingredient: vp.ingredient,
      unit_price: vp.unit_price,
      pack_unit: vp.pack_unit,
    });
  }
  // Fallback: order_guide_items if vendor_prices missed it.
  // Skip rows flagged is_placeholder=1 — those carry a recipe-derived
  // placeholder cost (no real vendor invoice) that would silently
  // corrupt any dish costing that falls through to this path.
  // COALESCE guards pre-migration rows that predate the column.
  const ogRows = db
    .prepare(
      `SELECT ingredient, unit_price, unit AS pack_unit
         FROM order_guide_items
        WHERE location_id = ?
          AND COALESCE(is_placeholder, 0) = 0`,
    )
    .all(locationId) as VendorPriceLookup[];
  for (const og of ogRows) {
    const key = og.ingredient.toLowerCase().trim();
    if (!vendorIndex.has(key)) {
      vendorIndex.set(key, {
        ingredient: og.ingredient,
        unit_price: og.unit_price,
        pack_unit: og.pack_unit,
      });
    }
  }

  // Per-dish key uses a composite: 'recipe:<slug>' or 'vendor:<ingredient_lowered>'.
  // Lets the same dish hold both kinds of components without slug collisions.
  const map = new Map<string, Map<string, DishComponentResolved>>();
  const compKey = (c: { component_type: string; recipe_slug: string | null; vendor_ingredient: string | null }) =>
    c.component_type === 'recipe'
      ? `recipe:${c.recipe_slug ?? ''}`
      : `vendor:${(c.vendor_ingredient ?? '').toLowerCase().trim()}`;

  // Stage 1: declared recipe links from recipes.menu_items[].
  for (const r of recipes) {
    const slug = r.slug;
    const recipeName = recipeIndex.get(slug)?.name || r.name;
    for (const mi of r.menu_items || []) {
      if (!mi) continue;
      const key = normalizeDishName(mi);
      if (!key) continue;
      let inner = map.get(key);
      if (!inner) {
        inner = new Map<string, DishComponentResolved>();
        map.set(key, inner);
      }
      const ck = compKey({ component_type: 'recipe', recipe_slug: slug, vendor_ingredient: null });
      if (!inner.has(ck)) {
        inner.set(ck, {
          component_type: 'recipe',
          recipe_slug: slug,
          vendor_ingredient: null,
          display_name: recipeName,
          qty_per_serving: null,
          unit: null,
          unit_price: recipeIndex.get(slug)?.cost_per_yield_unit ?? null,
          base_unit: recipeIndex.get(slug)?.yield_unit ?? null,
          per_serving_cost: null,
          status: 'no_dish_component',
        });
      }
    }
  }

  // Stage 2: overlay dish_components rows (recipe + vendor_item alike).
  const dcRows = db
    .prepare(
      `SELECT * FROM dish_components WHERE location_id = ?`,
    )
    .all(locationId) as DishComponent[];
  for (const dc of dcRows) {
    const key = normalizeDishName(dc.dish_name);
    if (!key) continue;
    let inner = map.get(key);
    if (!inner) {
      inner = new Map<string, DishComponentResolved>();
      map.set(key, inner);
    }
    if (dc.component_type === 'vendor_item') {
      const lookup = vendorIndex.get((dc.vendor_ingredient || '').toLowerCase().trim());
      inner.set(compKey(dc), {
        component_type: 'vendor_item',
        recipe_slug: null,
        vendor_ingredient: dc.vendor_ingredient,
        display_name: lookup?.ingredient || dc.vendor_ingredient || '',
        qty_per_serving: dc.qty_per_serving,
        unit: dc.unit,
        unit_price: lookup?.unit_price ?? null,
        base_unit: lookup?.pack_unit ?? null,
        per_serving_cost: null,
        status: 'ok',
      });
    } else {
      // recipe path
      const recipeMeta = dc.recipe_slug ? recipeIndex.get(dc.recipe_slug) : undefined;
      inner.set(compKey(dc), {
        component_type: 'recipe',
        recipe_slug: dc.recipe_slug,
        vendor_ingredient: null,
        display_name: recipeMeta?.name || dc.recipe_slug || '',
        qty_per_serving: dc.qty_per_serving,
        unit: dc.unit,
        unit_price: recipeMeta?.cost_per_yield_unit ?? null,
        base_unit: recipeMeta?.yield_unit ?? null,
        per_serving_cost: null,
        status: 'ok',
      });
    }
  }

  // Stage 3: compute per_serving_cost per component.
  const out = new Map<string, DishComponentResolved[]>();
  for (const [dishKey, comps] of map) {
    const list: DishComponentResolved[] = [];
    for (const c of comps.values()) {
      list.push(resolveComponentCost(c));
    }
    out.set(dishKey, list);
  }
  return out;
}

function resolveComponentCost(c: DishComponentResolved): DishComponentResolved {
  if (c.qty_per_serving == null || c.unit == null) {
    return { ...c, per_serving_cost: null, status: 'no_dish_component' };
  }
  if (c.unit_price == null || !c.base_unit) {
    const missing = c.component_type === 'vendor_item' ? 'no_vendor_price' : 'no_recipe_cost';
    return { ...c, per_serving_cost: null, status: missing };
  }
  // Convert qty_per_serving from the user's input `unit` to the cost-source
  // `base_unit` so we can multiply by unit_price. convertQty returns null
  // for incompatible dimensions (e.g. volume → weight without a density).
  const qtyInBase = convertQty(c.qty_per_serving, c.unit, c.base_unit, null);
  if (qtyInBase == null || !Number.isFinite(qtyInBase)) {
    return { ...c, per_serving_cost: null, status: 'unit_convert_failed' };
  }
  return { ...c, per_serving_cost: qtyInBase * c.unit_price, status: 'ok' };
}

/**
 * Convenience: cost roll-up for a single dish.
 */
export function computeDishCost(
  dishName: string,
  locationId: string = 'default',
  precomputedMap?: Map<string, DishComponentResolved[]>,
  recipesOverride?: Recipe[],
): DishCostResult {
  const map = precomputedMap || buildDishComponentMap(locationId, recipesOverride);
  const norm = normalizeDishName(dishName);
  const components = map.get(norm) || [];

  let total = 0;
  let allOk = components.length > 0;
  let anyOk = false;
  let anyMissing = false;
  for (const c of components) {
    if (c.per_serving_cost != null) {
      total += c.per_serving_cost;
      anyOk = true;
    } else {
      allOk = false;
      anyMissing = true;
    }
  }

  let link_state: DishCostResult['link_state'];
  if (components.length === 0) {
    link_state = 'unlinked';
  } else if (allOk) {
    link_state = 'fully_linked';
  } else if (anyOk) {
    link_state = 'partial';
  } else {
    link_state = 'declared_only';
  }

  return {
    dish_name: dishName,
    dish_name_normalized: norm,
    components,
    total_cost: anyOk ? total : null,
    fully_costed: allOk,
    link_state,
  };
}

/**
 * Filter Toast CSV footer noise out of sales_lines results.
 * Toast exports a literal 'TOTAL' / 'TOTALS' summary row that leaks
 * through the analytics ingest. Anything matching these (case-insensitive,
 * trimmed) is dropped from menu-engineering computations.
 */
export interface SalesRow {
  item_name: string;
  qty: number;
  rev: number;
}

export function cleanedSalesRows<T extends { item_name: string }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const k = (r.item_name || '').trim().toLowerCase();
    return k && !SALES_NOISE_DISH_NAMES.has(k);
  });
}

/**
 * Coverage report: which sales/menu dishes are linked vs. unlinked vs.
 * declared-but-unmeasured. Drives the gap UI on /menu-engineering and
 * the dish-coverage tile on /costing.
 */
export interface DishCoverageReport {
  total_sales_dishes: number;
  fully_linked: number;
  partial: number;
  declared_only: number;
  unlinked: number;
  /** Sales dishes with no recipe link at all — these need a recipe.menu_items entry. */
  unlinked_dishes: { item_name: string; qty: number; net_sales: number }[];
  /** Sales dishes that have a declared link but no dish_components rows yet. */
  declared_only_dishes: { item_name: string; component_count: number }[];
}

export function computeDishCoverage(locationId: string = 'default'): DishCoverageReport {
  const db = getDb();
  const map = buildDishComponentMap(locationId);

  const salesRaw = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
         FROM sales_lines
        WHERE location_id = ?
        GROUP BY item_name`,
    )
    .all(locationId) as { item_name: string; qty: number; rev: number }[];
  const sales = cleanedSalesRows(salesRaw);

  let fully = 0;
  let partial = 0;
  let declared_only = 0;
  let unlinked = 0;
  const unlinkedDishes: DishCoverageReport['unlinked_dishes'] = [];
  const declaredOnlyDishes: DishCoverageReport['declared_only_dishes'] = [];
  for (const s of sales) {
    const r = computeDishCost(s.item_name, locationId, map);
    if (r.link_state === 'fully_linked') fully++;
    else if (r.link_state === 'partial') partial++;
    else if (r.link_state === 'declared_only') {
      declared_only++;
      declaredOnlyDishes.push({
        item_name: s.item_name,
        component_count: r.components.length,
      });
    } else {
      unlinked++;
      unlinkedDishes.push({
        item_name: s.item_name,
        qty: Number(s.qty) || 0,
        net_sales: Number(s.rev) || 0,
      });
    }
  }

  // Sort unlinked by net sales desc — biggest revenue dishes get filled in first.
  unlinkedDishes.sort((a, b) => (b.net_sales || 0) - (a.net_sales || 0));
  declaredOnlyDishes.sort((a, b) => a.item_name.localeCompare(b.item_name));

  return {
    total_sales_dishes: sales.length,
    fully_linked: fully,
    partial,
    declared_only,
    unlinked,
    unlinked_dishes: unlinkedDishes,
    declared_only_dishes: declaredOnlyDishes,
  };
}
