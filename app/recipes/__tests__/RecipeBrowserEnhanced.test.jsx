// @ts-nocheck — pre-#250 baseline.
/** @jest-environment jsdom */

/**
 * Cookbook browser unit tests — pure logic only.
 *
 * The component takes `recipes` as a prop (no SQLite), so this is a
 * render test. We exercise:
 *   - case-insensitive name search
 *   - allergen chip is XOR (clicking active chip clears, clicking
 *     a different chip switches)
 *   - category grouping order via the pure helper
 *
 * The grouping helper lives at lib/recipeCookbookGrouping.ts so we can
 * assert ordering directly (no DOM scraping for sort proof).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RecipeBrowserEnhanced from '../RecipeBrowserEnhanced';
import { useRole } from '../../_components/RoleProvider';
import {
  groupRecipesByCategory,
  CATEGORY_ORDER,
} from '../../../lib/recipeCookbookGrouping';

// next/navigation isn't available under jsdom — stub the hook the
// component uses (only useRouter().push() is called, on sign-out).
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

// Bypass the management-PIN gate so the staff-view code path renders.
// useRole's behavior is exercised in app/__tests__/RoleProvider.test.jsx
// — here we only care that the cookbook renders without it. `jest.fn()`
// (rather than a fixed object) so individual tests can override the
// return value to exercise the management-mode UI (sign-out button).
jest.mock('../../_components/RoleProvider', () => ({
  useRole: jest.fn(() => ({ canEditRecipes: false, canViewFinancials: false, isLoading: false, role: 'staff' })),
}));

const RECIPES = [
  {
    slug: 'house_ranch',
    name: 'House Ranch Dressing',
    category: 'dressing',
    ingredient_count: 7,
    allergens: ['Dairy'],
  },
  {
    slug: 'baja_tacos',
    name: 'Baja Fish Tacos',
    category: 'entree',
    ingredient_count: 12,
    allergens: ['Fish', 'Gluten'],
  },
  {
    slug: 'queso_fundido',
    name: 'Queso Fundido',
    category: 'appetizer',
    ingredient_count: 5,
    allergens: ['Dairy'],
  },
  {
    slug: 'staff_meal',
    name: 'Staff Meal Rice',
    category: 'family_meal', // not in CATEGORY_ORDER
    ingredient_count: 3,
    allergens: [],
  },
  {
    slug: 'chimichurri',
    name: 'Chimichurri Sauce',
    category: 'sauce',
    ingredient_count: 6,
    allergens: [],
  },
];

describe('RecipeBrowserEnhanced — search', () => {
  test('search is case-insensitive', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    const input = screen.getByPlaceholderText(/recipe name or ingredient/i);
    fireEvent.change(input, { target: { value: 'BAJA' } });
    expect(screen.getByText('Baja Fish Tacos')).toBeInTheDocument();
    expect(screen.queryByText('Queso Fundido')).toBeNull();

    fireEvent.change(input, { target: { value: 'queso' } });
    expect(screen.getByText('Queso Fundido')).toBeInTheDocument();
    expect(screen.queryByText('Baja Fish Tacos')).toBeNull();
  });

  test('empty search restores all recipes', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    const input = screen.getByPlaceholderText(/recipe name or ingredient/i);
    fireEvent.change(input, { target: { value: 'baja' } });
    fireEvent.change(input, { target: { value: '' } });
    for (const r of RECIPES) {
      expect(screen.getByText(r.name)).toBeInTheDocument();
    }
  });
});

describe('RecipeBrowserEnhanced — allergen chip XOR', () => {
  test('clicking an inactive allergen chip filters to that allergen', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fish' }));
    expect(screen.getByText('Baja Fish Tacos')).toBeInTheDocument();
    expect(screen.queryByText('House Ranch Dressing')).toBeNull();
    expect(screen.queryByText('Queso Fundido')).toBeNull();
  });

  test('clicking the active allergen chip clears the filter (XOR)', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    const dairyChip = screen.getByRole('button', { name: 'Dairy' });
    fireEvent.click(dairyChip); // activate
    expect(screen.getByText('House Ranch Dressing')).toBeInTheDocument();
    expect(screen.queryByText('Baja Fish Tacos')).toBeNull();
    fireEvent.click(dairyChip); // click again -> XOR clear
    // After clear, all recipes are visible again.
    for (const r of RECIPES) {
      expect(screen.getByText(r.name)).toBeInTheDocument();
    }
  });

  test('clicking a different allergen chip switches the filter, does not stack', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dairy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gluten' }));
    expect(screen.getByText('Baja Fish Tacos')).toBeInTheDocument();
    expect(screen.queryByText('House Ranch Dressing')).toBeNull();
  });
});

// ── Pure grouping helper ─────────────────────────────────────────

describe('groupRecipesByCategory', () => {
  test('known categories appear in CATEGORY_ORDER', () => {
    const groups = groupRecipesByCategory(RECIPES);
    const knownEmitted = groups
      .map(([cat]) => cat)
      .filter((c) => CATEGORY_ORDER.includes(c));
    // Line-prep CATEGORY_ORDER: sauce, dressing, entree, appetizer
    // (prep/mother-sauces before passed apps/plates — not catering order).
    expect(knownEmitted).toEqual(['sauce', 'dressing', 'entree', 'appetizer']);
  });

  test('unknown categories sort alphabetically after known ones', () => {
    const groups = groupRecipesByCategory([
      ...RECIPES,
      { slug: 'limeade', name: 'Limeade', category: 'beverage', ingredient_count: 3, allergens: [] },
    ]);
    const cats = groups.map(([cat]) => cat);
    // Known come first (line-prep CATEGORY_ORDER). Unknowns: 'beverage' then 'family_meal' alpha.
    expect(cats).toEqual([
      'sauce',
      'dressing',
      'entree',
      'appetizer',
      'beverage',
      'family_meal',
    ]);
  });

  test('recipes without a category bucket under _unknown and sort with other unknowns', () => {
    const groups = groupRecipesByCategory([
      { slug: 'no_cat', name: 'No Category', allergens: [] },
      { slug: 'staff', name: 'Staff Meal', category: 'family_meal', allergens: [] },
    ]);
    const cats = groups.map(([cat]) => cat);
    // '_unknown' sorts before 'family_meal' alphabetically (underscore < f).
    expect(cats).toEqual(['_unknown', 'family_meal']);
  });

  test('preserves input order within each bucket (stable)', () => {
    const input = [
      { slug: 'a', name: 'Alfa Sauce', category: 'sauce', allergens: [] },
      { slug: 'b', name: 'Bravo Sauce', category: 'sauce', allergens: [] },
      { slug: 'c', name: 'Charlie Sauce', category: 'sauce', allergens: [] },
    ];
    const groups = groupRecipesByCategory(input);
    expect(groups[0][1].map((r) => r.slug)).toEqual(['a', 'b', 'c']);
  });

  test('empty input returns empty groups', () => {
    expect(groupRecipesByCategory([])).toEqual([]);
  });
});

describe('RecipeBrowserEnhanced — rendered category section order', () => {
  test('section headers appear in CATEGORY_ORDER then unknowns', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    const headers = screen.getAllByRole('heading', { level: 2 });
    const titles = headers.map((h) => h.textContent.toLowerCase());
    // Line-prep order: Sauce, Dressing, Entree, Appetizer, then Family_meal (unknown last).
    expect(titles).toEqual([
      'sauce',
      'dressing',
      'entree',
      'appetizer',
      'family_meal',
    ]);
  });
});

// ── Bug fix: sign-out hit a route that never existed ────────────────
//
// Prior version called `fetch('/api/auth/management-pin/logout', { method:
// 'POST' })`. No such route exists anywhere in app/api (grep confirms —
// the real session-clearing endpoint is `DELETE /api/auth/pin`, used by
// app/_components/PinLogout.jsx and defined in app/api/auth/pin/route.ts).
// fetch() does not reject on a 404 response, so the try/catch never
// caught it: the button appeared to work (redirected to /recipes) while
// silently leaving the `lariat_pin_ok` cookie — and management access —
// fully intact.
describe('RecipeBrowserEnhanced — sign-out endpoint', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }),
    );
    /** @type {jest.Mock} */ (useRole).mockReturnValue({
      canEditRecipes: true,
      canViewFinancials: true,
      isLoading: false,
      role: 'management',
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    // clearAllMocks() wipes call history but NOT the mockReturnValue set
    // above — restore the module's staff-mode default so later describe
    // blocks aren't left seeing a stale management-mode role.
    /** @type {jest.Mock} */ (useRole).mockReturnValue({
      canEditRecipes: false,
      canViewFinancials: false,
      isLoading: false,
      role: 'staff',
    });
  });

  test('Sign out calls DELETE /api/auth/pin — the real session-clearing route', async () => {
    render(<RecipeBrowserEnhanced recipes={RECIPES} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/pin', { method: 'DELETE' });
  });
});

// ── Bug fix: card links + photo thumbnails dropped `?location=` ─────
//
// The recipe-detail page (app/recipes/[slug]/page.jsx) and the photo
// `/raw` route both resolve their own location purely from the request's
// `?location=` query. This card grid never threaded the resolved
// location back onto its outgoing links/fetches, so browsing
// `/recipes?location=uptown` and clicking a card (or loading a
// thumbnail) silently reverted to the default location's data.
describe('RecipeBrowserEnhanced — location-scoped links', () => {
  const RECIPE_WITH_PHOTO = [
    {
      slug: 'house_ranch',
      name: 'House Ranch Dressing',
      category: 'dressing',
      ingredient_count: 7,
      allergens: ['Dairy'],
      photo_id: 42,
    },
  ];

  test('card link and photo src carry ?location= for a non-default location', () => {
    const { container } = render(
      <RecipeBrowserEnhanced recipes={RECIPE_WITH_PHOTO} locationId="uptown" />,
    );
    const link = screen.getByRole('link', { name: /house ranch dressing/i });
    expect(link.getAttribute('href')).toBe('/recipes/house_ranch?location=uptown');
    // alt="" gives the <img> an implicit "presentation" role, so it isn't
    // reachable via getByRole('img') — query the DOM directly instead.
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      '/api/recipes/house_ranch/photos/42/raw?location=uptown',
    );
  });

  test('card link omits the query for the default location', () => {
    render(<RecipeBrowserEnhanced recipes={RECIPE_WITH_PHOTO} locationId="default" />);
    const link = screen.getByRole('link', { name: /house ranch dressing/i });
    expect(link.getAttribute('href')).toBe('/recipes/house_ranch');
  });
});
