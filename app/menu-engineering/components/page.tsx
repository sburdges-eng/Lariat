import { getDb } from '../../../lib/db';
import { getRecipes } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { computeDishCoverage } from '../../../lib/dishCostBridge';
import ComponentEditor from './ComponentEditor';

export const dynamic = 'force-dynamic';

interface VendorCandidate {
  ingredient: string;
  unit_price: number | null;
  pack_unit: string | null;
  source: 'vendor_prices' | 'order_guide';
  vendor: string | null;
}

export default async function ComponentEditorPage({
  searchParams,
}: {
  searchParams?: { location?: string };
}) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();

  // Existing dish_components for this location.
  const components = db
    .prepare(
      `SELECT * FROM dish_components
        WHERE location_id = ?
        ORDER BY dish_name, component_type, recipe_slug, vendor_ingredient`,
    )
    .all(loc) as {
    id: number;
    location_id: string;
    dish_name: string;
    component_type: 'recipe' | 'vendor_item';
    recipe_slug: string | null;
    vendor_ingredient: string | null;
    qty_per_serving: number;
    unit: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }[];

  // Sub-recipe candidates (the menu_items[] declarations come from recipes.json).
  const recipes = getRecipes()
    .map((r) => ({ slug: r.slug, name: r.name, menu_items: r.menu_items || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Distributor candidates: vendor_prices preferred (priced + sourced),
  // order_guide_items as fallback. Dedupe by ingredient (case-insensitive).
  // Latest pricing per ingredient via the same join used in the bridge.
  const vendorRows = db
    .prepare(
      `SELECT vp.ingredient, vp.unit_price, vp.pack_unit, vp.vendor
         FROM vendor_prices vp
         JOIN (
           SELECT ingredient, MAX(imported_at) AS m
             FROM vendor_prices
            WHERE location_id = ?
            GROUP BY ingredient
         ) latest ON latest.ingredient = vp.ingredient AND latest.m = vp.imported_at
        WHERE vp.location_id = ?
        ORDER BY vp.ingredient`,
    )
    .all(loc, loc) as { ingredient: string; unit_price: number | null; pack_unit: string | null; vendor: string | null }[];
  const orderGuideRows = db
    .prepare(
      `SELECT ingredient, unit_price, unit AS pack_unit, vendor
         FROM order_guide_items
        WHERE location_id = ?
        ORDER BY ingredient`,
    )
    .all(loc) as { ingredient: string; unit_price: number | null; pack_unit: string | null; vendor: string | null }[];

  const seen = new Set<string>();
  const distributorItems: VendorCandidate[] = [];
  for (const v of vendorRows) {
    const k = v.ingredient.toLowerCase().trim();
    if (seen.has(k)) continue;
    seen.add(k);
    distributorItems.push({ ...v, source: 'vendor_prices' });
  }
  for (const o of orderGuideRows) {
    const k = o.ingredient.toLowerCase().trim();
    if (seen.has(k)) continue;
    seen.add(k);
    distributorItems.push({ ...o, source: 'order_guide' });
  }

  const coverage = computeDishCoverage(loc);

  return (
    <div>
      <h1>Dish components</h1>
      <p className="subtitle">
        Per-serving quantities of every component a dish pulls — sub-recipes
        (bacon_jam, lariat_rub) AND raw distributor items (buns, patties, cheese
        slices). These rows feed the cost roll-up on{' '}
        <a href={`/menu-engineering${loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : ''}`}>
          /menu-engineering
        </a>{' '}
        and{' '}
        <a href={`/costing${loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : ''}`}>
          /costing
        </a>.
      </p>

      <div className="card mb-20">
        <div className="meta">
          <strong>{coverage.total_sales_dishes}</strong> dishes appear in sales.{' '}
          <strong>{coverage.fully_linked}</strong> have full per-serving data.{' '}
          <strong>{coverage.partial + coverage.declared_only}</strong> need quantities.{' '}
          <strong>{coverage.unlinked}</strong> have no recipe link at all.
        </div>
      </div>

      <ComponentEditor
        locationId={loc}
        initialComponents={components}
        recipes={recipes}
        distributorItems={distributorItems}
        unlinkedDishes={coverage.unlinked_dishes.map((d) => d.item_name)}
        declaredOnlyDishes={coverage.declared_only_dishes.map((d) => d.item_name)}
      />
    </div>
  );
}
