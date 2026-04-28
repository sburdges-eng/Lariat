/**
 * Gap-aware exporter helpers for dish_components coverage.
 *
 * Scope: build a list of "fill me in" rows — one per (dish, known-component)
 * pair for every dish in the `declared_only` bucket (and optionally one
 * blank row per `unlinked` dish). These rows carry every column we can
 * infer ahead of time so the operator only has to enter the qty_per_serving
 * (and sometimes the unit).
 *
 * This module does NOT re-derive bucket logic — it reads from
 * `computeDishCoverage()` in lib/dishCostBridge.ts and decorates the
 * returned dishes with per-component gap rows.
 *
 * The output shape matches the importer's CSV columns exactly, so the
 * resulting file can be hand-filled in a spreadsheet and piped back
 * through scripts/import-dish-components.mjs without any reshaping.
 */
import { getDb, type RecipeCost } from './db';
import { getRecipes } from './data';
import {
  buildDishComponentMap,
  computeDishCoverage,
  normalizeDishName,
  type DishComponentResolved,
} from './dishCostBridge';

/**
 * One row of the gap CSV. Columns match
 * scripts/import-dish-components.mjs REQUIRED_COLUMNS in order.
 *
 * `qty_per_serving` / `unit` are the two columns the operator fills.
 * Everything else is pre-populated where inferable.
 *
 * `kind` is metadata for the CLI summary — it never lands in the CSV.
 */
export type CoverageGapRow = {
  dish_name: string;
  component_type: 'recipe' | 'vendor_item' | '';
  recipe_slug: string;
  vendor_ingredient: string;
  qty_per_serving: string; // blank for operator to fill
  unit: string; // blank unless inferable from recipe yield_unit
  notes: string;
  /** Bucket this row was derived from. Not written to CSV. */
  kind: 'declared_only' | 'unlinked';
  /** Total net_sales revenue for the dish, for sorting. */
  revenue: number;
};

export interface BuildCoverageGapOpts {
  locationId?: string;
  /** When true, also emit one blank row per unlinked dish. Default false. */
  includeUnlinked?: boolean;
  /** Only include dishes with total net_sales >= this. Default 0 (include all). */
  minRevenue?: number;
}

interface SalesRow {
  item_name: string;
  qty: number;
  rev: number;
}

/**
 * Build the gap-row list. Sorted by per-dish revenue desc so the operator
 * fills the highest-value dishes first.
 *
 * For `declared_only` dishes we emit one row per declared recipe component
 * from `recipes.menu_items[]` — pre-populating `dish_name`,
 * `component_type='recipe'`, `recipe_slug`, and the recipe's `yield_unit`
 * as a suggested unit. `qty_per_serving` is always blank.
 *
 * For `unlinked` dishes (only when `includeUnlinked=true`) we emit a
 * single row per dish with `dish_name` and a revenue hint in `notes`.
 * The operator chooses component_type/slug/ingredient themselves.
 */
export function buildCoverageGapRows(
  opts: BuildCoverageGapOpts = {},
): CoverageGapRow[] {
  const locationId = opts.locationId || 'default';
  const minRevenue = Math.max(0, Number(opts.minRevenue) || 0);
  const includeUnlinked = Boolean(opts.includeUnlinked);

  const db = getDb();
  const recipes = getRecipes();

  // Coverage report gives us the exact bucket assignments.
  const report = computeDishCoverage(locationId);

  // Revenue index keyed by CANONICAL dish name so we can look up revenue
  // both for declared_only (which isn't carried on the report) and for
  // unlinked (which is carried but we re-join to keep a single source).
  const salesRows = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
         FROM sales_lines
        WHERE location_id = ?
        GROUP BY item_name`,
    )
    .all(locationId) as SalesRow[];
  const revenueByDish = new Map<string, number>();
  for (const s of salesRows) {
    const norm = normalizeDishName(s.item_name);
    if (!norm) continue;
    revenueByDish.set(norm, (revenueByDish.get(norm) || 0) + (Number(s.rev) || 0));
  }

  // Recipe yield_unit index for suggested-unit pre-fill. Prefer the cached
  // recipe_costs row (already derived by ingest-costing.mjs) but fall back
  // to the raw recipes.json yield_unit so we still get a suggestion even
  // before the costing ingest has run.
  const yieldUnitBySlug = new Map<string, string | null>();
  for (const r of recipes) {
    yieldUnitBySlug.set(r.slug, r.yield_unit ?? null);
  }
  const costRows = db
    .prepare(
      `SELECT recipe_id, yield_unit FROM recipe_costs WHERE location_id = ?`,
    )
    .all(locationId) as Pick<RecipeCost, 'recipe_id' | 'yield_unit'>[];
  for (const c of costRows) {
    if (c.yield_unit) yieldUnitBySlug.set(c.recipe_id, c.yield_unit);
  }

  // The declared-only bucket carries `component_count` but not the
  // components themselves. Re-derive the components map once — same call
  // the coverage report makes under the hood, so no extra DB cost past
  // what the report already paid.
  const componentMap = buildDishComponentMap(locationId, recipes);

  const out: CoverageGapRow[] = [];

  // ── declared_only dishes ─────────────────────────────────────────
  // Emit one row per declared component that does NOT yet have a
  // dish_components row (status === 'no_dish_component'). Components
  // whose row exists but fails downstream (missing vendor price, unit
  // convert failure, etc.) are NOT the operator's problem to fix in
  // this CSV — those are data bugs flagged elsewhere on /costing.
  for (const d of report.declared_only_dishes) {
    const norm = normalizeDishName(d.item_name);
    const revenue = revenueByDish.get(norm) || 0;
    if (revenue < minRevenue) continue;
    const components = componentMap.get(norm) || [];
    // Stable ordering within a dish so the CSV diffs cleanly across runs.
    const sorted = [...components].sort((a, b) =>
      componentSortKey(a).localeCompare(componentSortKey(b)),
    );
    for (const c of sorted) {
      // Skip components that already have a qty/unit row — they belong
      // to `partial`/`fully_linked` from a per-component perspective
      // even when the dish as a whole rolls up to `declared_only`.
      if (c.qty_per_serving != null && c.unit != null) continue;

      const ct = c.component_type;
      const row: CoverageGapRow = {
        dish_name: d.item_name,
        component_type: ct,
        recipe_slug: ct === 'recipe' ? c.recipe_slug || '' : '',
        vendor_ingredient:
          ct === 'vendor_item' ? c.vendor_ingredient || '' : '',
        qty_per_serving: '',
        unit:
          ct === 'recipe' && c.recipe_slug
            ? yieldUnitBySlug.get(c.recipe_slug) || ''
            : '',
        notes: `declared_only; revenue $${revenue.toFixed(2)}`,
        kind: 'declared_only',
        revenue,
      };
      out.push(row);
    }
  }

  // ── unlinked dishes ──────────────────────────────────────────────
  if (includeUnlinked) {
    for (const d of report.unlinked_dishes) {
      const revenue = Number(d.net_sales) || 0;
      if (revenue < minRevenue) continue;
      out.push({
        dish_name: d.item_name,
        component_type: '',
        recipe_slug: '',
        vendor_ingredient: '',
        qty_per_serving: '',
        unit: '',
        notes: `unlinked; revenue $${revenue.toFixed(2)}; qty ${d.qty}`,
        kind: 'unlinked',
        revenue,
      });
    }
  }

  // Sort by revenue desc, then by dish_name to break ties deterministically.
  // Within a dish the component order was already pinned above, so a stable
  // sort preserves it.
  out.sort((a, b) => {
    if (b.revenue !== a.revenue) return b.revenue - a.revenue;
    const dn = a.dish_name.localeCompare(b.dish_name);
    if (dn !== 0) return dn;
    return componentSortKeyForRow(a).localeCompare(componentSortKeyForRow(b));
  });

  return out;
}

function componentSortKey(c: DishComponentResolved): string {
  return c.component_type === 'recipe'
    ? `recipe:${c.recipe_slug ?? ''}`
    : `vendor:${(c.vendor_ingredient ?? '').toLowerCase().trim()}`;
}

function componentSortKeyForRow(r: CoverageGapRow): string {
  return r.component_type === 'recipe'
    ? `recipe:${r.recipe_slug}`
    : r.component_type === 'vendor_item'
    ? `vendor:${r.vendor_ingredient.toLowerCase().trim()}`
    : 'zzz_blank'; // unlinked rows float to the end within a dish
}
