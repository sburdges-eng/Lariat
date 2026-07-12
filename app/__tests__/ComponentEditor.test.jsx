// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts.
// ComponentEditor jsdom test — the `?dish=` deep link built by
// /costing/depletion-exceptions (`/menu-engineering/components?dish=<dish
// name>&location=<loc>`) must pre-select that dish in the builder. Pre-fix
// the component read only `sp.location` — the `dish` param was never
// consulted anywhere, so the link landed on a blank "Build a dish" form
// with the target dish still buried in the "Existing components" table
// (findable via the datalist, but not pre-selected — the whole point of
// a fix-it link).

import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import ComponentEditor from '../menu-engineering/components/ComponentEditor.jsx';

let mockSearch = '';

afterEach(() => {
  mockSearch = '';
});

const existingComponents = [
  {
    id: 1,
    location_id: 'default',
    dish_name: 'rope burger',
    component_type: 'vendor_item',
    recipe_slug: null,
    vendor_ingredient: 'Brioche Bun',
    qty_per_serving: 1,
    unit: 'each',
    notes: null,
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-01 00:00:00',
  },
  {
    id: 2,
    location_id: 'default',
    dish_name: 'rope burger',
    component_type: 'recipe',
    recipe_slug: 'bacon_jam',
    vendor_ingredient: null,
    qty_per_serving: 2,
    unit: 'oz',
    notes: null,
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-01 00:00:00',
  },
];

function renderEditor() {
  return render(
    <ComponentEditor
      locationId="default"
      initialComponents={existingComponents}
      recipes={[{ slug: 'bacon_jam', name: 'Bacon Jam', menu_items: [] }]}
      distributorItems={[]}
      unlinkedDishes={[]}
      declaredOnlyDishes={[]}
    />,
  );
}

describe('ComponentEditor ?dish= deep link', () => {
  test('pre-selects the dish and loads its existing rows when ?dish= matches', () => {
    // Depletion-exceptions links with the raw Toast display name, which
    // may not match dish_components' canonical casing/punctuation exactly
    // — the match must be loose (case/punctuation-insensitive), same as
    // the dish-name input's own live "existing for this dish" match.
    mockSearch = 'dish=' + encodeURIComponent('Rope Burger!') + '&location=default';

    renderEditor();

    const dishInput = screen.getByPlaceholderText('e.g. ROPE BURGER');
    // Pre-filled with the canonical stored name (matched row), not the
    // raw URL text.
    expect(dishInput).toHaveValue('rope burger');

    // Both existing components for this dish were loaded into the builder
    // rows, not just left sitting in the read-only table below.
    expect(screen.getByDisplayValue('Brioche Bun')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Bacon Jam')).toBeInTheDocument();
  });

  test('no ?dish= param leaves the builder on a blank row (unchanged default behavior)', () => {
    mockSearch = 'location=default';

    renderEditor();

    const dishInput = screen.getByPlaceholderText('e.g. ROPE BURGER');
    expect(dishInput).toHaveValue('');
  });

  test('?dish= with no matching dish pre-fills the name but starts from a blank row', () => {
    mockSearch = 'dish=' + encodeURIComponent('Totally New Dish');

    renderEditor();

    const dishInput = screen.getByPlaceholderText('e.g. ROPE BURGER');
    expect(dishInput).toHaveValue('Totally New Dish');
    expect(screen.queryByDisplayValue('Brioche Bun')).not.toBeInTheDocument();
  });
});
