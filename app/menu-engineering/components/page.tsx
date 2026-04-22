import { getDb } from '../../../lib/db';
import { getRecipes } from '../../../lib/data';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { computeDishCoverage } from '../../../lib/dishCostBridge';
import ComponentEditor from './ComponentEditor';

export const dynamic = 'force-dynamic';

export default function ComponentEditorPage({
  searchParams,
}: {
  searchParams?: { location?: string };
}) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  const db = getDb();

  // Existing dish_components for this location.
  const components = db
    .prepare(
      `SELECT * FROM dish_components
        WHERE location_id = ?
        ORDER BY dish_name, recipe_slug`,
    )
    .all(loc) as {
    id: number;
    location_id: string;
    dish_name: string;
    recipe_slug: string;
    qty_per_serving: number;
    unit: string;
    notes: string | null;
    created_at: string;
    updated_at: string;
  }[];

  // Recipe candidates: pre-load names for the picker.
  const recipes = getRecipes()
    .map((r) => ({ slug: r.slug, name: r.name, menu_items: r.menu_items || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const coverage = computeDishCoverage(loc);

  return (
    <div>
      <h1>Dish components</h1>
      <p className="subtitle">
        Per-serving recipe quantities. Each row says "X qty of recipe Y goes into one serving of dish Z."
        These rows feed the cost roll-up on{' '}
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
        unlinkedDishes={coverage.unlinked_dishes.map((d) => d.item_name)}
        declaredOnlyDishes={coverage.declared_only_dishes.map((d) => d.item_name)}
      />
    </div>
  );
}
