// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

/**
 * Regression test for a real bug found while migrating
 * app/recipes/[slug]/RecipePhotoStrip.jsx off the GH #250 @ts-nocheck
 * baseline.
 *
 * Every handler in app/api/recipes/[slug]/photos/**\/route.js resolves
 * its location scope from `locationFromRequest(req)` — the URL's
 * `?location=` query param only (lib/location.ts). The codebase's
 * established convention for threading a non-default location onto a
 * client fetch is a `locQ` query-string suffix (e.g.
 * app/labor/breaks/BreakBoard.jsx). RecipePhotoStrip never accepted a
 * location prop and never appended it — on any non-default-location
 * install the strip always read (and linked to) the
 * DEFAULT_LOCATION_ID's photos regardless of which location the recipe
 * page itself was scoped to.
 *
 * Fetch is mocked module-globally (consistent with
 * RecipePhotoUploader.test.jsx / AckButton.test.jsx).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import RecipePhotoStrip from '../[slug]/RecipePhotoStrip';

const PHOTOS = [
  {
    id: 7,
    original_name: 'plated.png',
    mime: 'image/png',
    size_bytes: 87,
    caption: 'plated for service',
    uploaded_by_cook_id: null,
    uploaded_at: '2026-05-13 12:00:00',
    is_hero: 0,
  },
];

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function mockListFetch() {
  global.fetch = jest.fn(() => Promise.resolve(jsonResponse({ photos: PHOTOS })));
}

describe('RecipePhotoStrip — location scoping', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('appends ?location= to the list fetch for a non-default location', async () => {
    mockListFetch();
    render(<RecipePhotoStrip slug="house_ranch_dressing" loc="downtown" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/recipes/house_ranch_dressing/photos?location=downtown');
  });

  test('appends ?location= to the raw-image link and src for a non-default location', async () => {
    mockListFetch();
    render(<RecipePhotoStrip slug="house_ranch_dressing" loc="downtown" />);

    await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument());
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      '/api/recipes/house_ranch_dressing/photos/7/raw?location=downtown',
    );
    const img = link.querySelector('img');
    expect(img).toHaveAttribute(
      'src',
      '/api/recipes/house_ranch_dressing/photos/7/raw?location=downtown',
    );
  });

  test('omits the query suffix entirely for the default location', async () => {
    mockListFetch();
    render(<RecipePhotoStrip slug="house_ranch_dressing" loc="default" />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/recipes/house_ranch_dressing/photos');
  });
});
