// @ts-nocheck — pre-#250 baseline.
/** @jest-environment jsdom */

/**
 * Component tests for RecipePhotoUploader caption editing.
 *
 * Coverage:
 *   - Clicking the caption text turns it into an input.
 *   - Blurring the input fires a PATCH to
 *     /api/recipes/<slug>/photos/<id> with { caption } payload.
 *   - The PATCH is not fired if the caption is unchanged on blur.
 *   - Empty input round-trips as caption: null.
 *
 * Fetch is mocked module-globally (consistent with AckButton.test.jsx
 * and CoursePanel.test.jsx). We don't mock SQLite — the API layer is
 * exercised separately in tests/js/test-recipe-photos-caption.mjs.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import RecipePhotoUploader from '../[slug]/edit/RecipePhotoUploader';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const INITIAL_PHOTOS = [
  {
    id: 11,
    original_name: 'plated.png',
    mime: 'image/png',
    size_bytes: 87,
    caption: 'plated for service',
    uploaded_by_cook_id: null,
    uploaded_at: '2026-05-13 12:00:00',
    is_hero: 0,
  },
];

function mockListFetch() {
  global.fetch = jest.fn((url, opts) => {
    if (!opts || !opts.method || opts.method === 'GET') {
      return Promise.resolve(jsonResponse({ photos: INITIAL_PHOTOS }));
    }
    if (opts.method === 'PATCH') {
      return Promise.resolve(jsonResponse({ ok: true }));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
}

describe('RecipePhotoUploader — caption editing', () => {
  beforeEach(() => {
    mockListFetch();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('clicking caption turns it into an editable input', async () => {
    await act(async () => {
      render(<RecipePhotoUploader slug="house_ranch_dressing" />);
    });
    // Wait for initial GET to populate.
    await waitFor(() => expect(screen.getByText('plated for service')).toBeInTheDocument());

    fireEvent.click(screen.getByText('plated for service'));

    const input = screen.getByDisplayValue('plated for service');
    expect(input.tagName).toBe('INPUT');
  });

  test('blurring the input PATCHes the new caption', async () => {
    await act(async () => {
      render(<RecipePhotoUploader slug="house_ranch_dressing" />);
    });
    await waitFor(() => expect(screen.getByText('plated for service')).toBeInTheDocument());

    fireEvent.click(screen.getByText('plated for service'));
    const input = screen.getByDisplayValue('plated for service');
    fireEvent.change(input, { target: { value: 'now with chimi drizzle' } });
    fireEvent.blur(input);

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find(
        ([url, opts]) => opts && opts.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(patchCall[0]).toBe('/api/recipes/house_ranch_dressing/photos/11');
      expect(JSON.parse(patchCall[1].body)).toEqual({ caption: 'now with chimi drizzle' });
    });
  });

  test('blurring without changes does not fire a PATCH', async () => {
    await act(async () => {
      render(<RecipePhotoUploader slug="house_ranch_dressing" />);
    });
    await waitFor(() => expect(screen.getByText('plated for service')).toBeInTheDocument());

    fireEvent.click(screen.getByText('plated for service'));
    const input = screen.getByDisplayValue('plated for service');
    fireEvent.blur(input);

    // Allow any pending fetch to flush.
    await Promise.resolve();
    const patchCalls = global.fetch.mock.calls.filter(
      ([, opts]) => opts && opts.method === 'PATCH',
    );
    expect(patchCalls.length).toBe(0);
  });

  test('blank input sends caption: null', async () => {
    await act(async () => {
      render(<RecipePhotoUploader slug="house_ranch_dressing" />);
    });
    await waitFor(() => expect(screen.getByText('plated for service')).toBeInTheDocument());

    fireEvent.click(screen.getByText('plated for service'));
    const input = screen.getByDisplayValue('plated for service');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    await waitFor(() => {
      const patchCall = global.fetch.mock.calls.find(
        ([, opts]) => opts && opts.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse(patchCall[1].body)).toEqual({ caption: null });
    });
  });
});
