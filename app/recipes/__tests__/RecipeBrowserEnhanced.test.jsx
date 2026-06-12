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
import { render, screen, fireEvent } from '@testing-library/react';
import RecipeBrowserEnhanced from '../RecipeBrowserEnhanced';
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
// — here we only care that the cookbook renders without it.
jest.mock('../../_components/RoleProvider', () => ({
  useRole: () => ({ canEditRecipes: false, canViewFinancials: false, isLoading: false, role: 'staff' }),
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
    // Expected: appetizer, entree, sauce, dressing — in CATEGORY_ORDER.
    expect(knownEmitted).toEqual(['appetizer', 'entree', 'sauce', 'dressing']);
  });

  test('unknown categories sort alphabetically after known ones', () => {
    const groups = groupRecipesByCategory([
      ...RECIPES,
      { slug: 'limeade', name: 'Limeade', category: 'beverage', ingredient_count: 3, allergens: [] },
    ]);
    const cats = groups.map(([cat]) => cat);
    // Known come first (in CATEGORY_ORDER). Unknowns: 'beverage' then 'family_meal' alpha.
    expect(cats).toEqual([
      'appetizer',
      'entree',
      'sauce',
      'dressing',
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
    // Expected: Appetizer, Entree, Sauce, Dressing, Family_meal (unknown last).
    expect(titles).toEqual([
      'appetizer',
      'entree',
      'sauce',
      'dressing',
      'family_meal',
    ]);
  });
});
