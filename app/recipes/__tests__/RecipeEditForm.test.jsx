// @ts-nocheck — pre-#250 baseline.
/** @jest-environment jsdom */

/**
 * Component tests for RecipeEditForm's load/save round-trip.
 *
 * Coverage (regression tests for a real bug found migrating this file
 * off the GH #250 checkjs baseline):
 *
 *   - The form loads from GET /api/recipes/<slug> (the single-recipe
 *     detail endpoint, which returns the full document under
 *     `recipe`), NOT GET /api/recipes (the list endpoint, whose slim
 *     projection has no `procedure`/`ingredients` at all). Loading from
 *     the list endpoint meant the form always rendered blank
 *     procedures/ingredients regardless of the recipe's real content.
 *   - Ingredient rows read Ingredient.qty (the real field name per
 *     lib/data.ts and RecipeScaler.jsx), not `.quantity`.
 *   - Saving preserves yield_qty/yield_unit/station/source — fields
 *     this form has no editable UI for, but which PUT /api/recipes/<slug>
 *     defaults to null/'recipes_api' when the body omits them, silently
 *     clobbering that metadata on every save otherwise.
 *
 * Fetch is mocked module-globally (consistent with RecipePhotoUploader.
 * test.jsx / PrepParEditor.test.jsx). We don't mock SQLite — the API
 * layer is exercised separately under tests/js/.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

import { useRouter } from 'next/navigation';
import RecipeEditForm from '../[slug]/edit/RecipeEditForm';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const SLUG = 'aji_verde';

const RECIPE_DETAIL_RESPONSE = {
  success: true,
  slug: SLUG,
  recipe: {
    slug: SLUG,
    name: 'Aji Verde',
    ingredients: [
      { item: 'cilantro', qty: 1200, unit: 'g' },
      { item: 'lime juice', qty: 600, unit: 'g' },
    ],
    procedure: ['1. Blend everything.', '2. Chill.'],
    allergens: ['eggs'],
    direct_allergens: ['eggs'],
    yield_qty: 3.2,
    yield_unit: 'qt',
    station: 'saute;fry',
    source: 'excel',
  },
  message: 'Recipe loaded',
};

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockBack = jest.fn();

function mockFetch() {
  global.fetch = jest.fn((url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (url === `/api/recipes/${SLUG}` && method === 'GET') {
      return Promise.resolve(jsonResponse(RECIPE_DETAIL_RESPONSE));
    }
    if (url === `/api/recipes/${SLUG}` && method === 'PUT') {
      return Promise.resolve(
        jsonResponse({ success: true, slug: SLUG, message: 'Recipe updated successfully' }),
      );
    }
    if (typeof url === 'string' && url.endsWith('/photos')) {
      return Promise.resolve(jsonResponse({ photos: [] }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

describe('RecipeEditForm — load/save round-trip', () => {
  beforeEach(() => {
    useRouter.mockReturnValue({ push: mockPush, refresh: mockRefresh, back: mockBack });
    mockFetch();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('loads ingredient quantities and procedures from the recipe detail endpoint', async () => {
    await act(async () => {
      render(<RecipeEditForm slug={SLUG} />);
    });
    await waitFor(() => expect(screen.getByDisplayValue('Aji Verde')).toBeInTheDocument());

    // Ingredient.qty populated (was always blank when the form read the
    // wrong field / fetched the wrong endpoint).
    expect(screen.getByDisplayValue('1200')).toBeInTheDocument();
    expect(screen.getByDisplayValue('600')).toBeInTheDocument();

    // Procedure steps populated (was always blank for the same reason).
    const proceduresField = screen.getByPlaceholderText('One procedure per line');
    expect(proceduresField.value).toBe('1. Blend everything.\n2. Chill.');
  });

  test('save preserves yield/station/source metadata the form has no field for', async () => {
    await act(async () => {
      render(<RecipeEditForm slug={SLUG} />);
    });
    await waitFor(() => expect(screen.getByDisplayValue('Aji Verde')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save recipe/i }));

    await waitFor(() => {
      const putCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'PUT');
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall[1].body);
      expect(body.yield_qty).toBe(3.2);
      expect(body.yield_unit).toBe('qt');
      expect(body.station).toBe('saute;fry');
      expect(body.source).toBe('excel');
    });
  });
});
