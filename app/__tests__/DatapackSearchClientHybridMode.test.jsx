// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import DatapackSearchClient from '../datapack-search/DatapackSearchClient';

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

function availableStats() {
  return { ok: true, status: 200, json: async () => ({ ok: true, stats: {} }) };
}

function emptyHits(extra) {
  return { ok: true, status: 200, json: async () => ({ ok: true, hits: [], ...extra }) };
}

// Regression test for a bug found migrating this file off the GH #250
// checkjs baseline: onSubmit computed the search-request's bucket/source
// selector as `mode === 'semantic' ? bucket : source`, which fell through
// to `source` (the lexical dropdown's value — hidden and stuck at its
// default 'all' in hybrid mode) instead of `bucket` for mode === 'hybrid'.
// The API route 400s on `bucket=all` since it isn't in ALLOWED_BUCKETS, so
// every Hybrid search from the UI failed regardless of what the user
// picked in the visible "Bucket" dropdown.
test('Hybrid mode search sends the selected bucket, not the hidden lexical source', async () => {
  global.fetch
    .mockResolvedValueOnce(availableStats())
    .mockResolvedValueOnce(emptyHits({ bucket: 'recipes', query: 'eggs' }));

  render(<DatapackSearchClient />);

  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith('/api/datapack/search?op=stats'),
  );

  fireEvent.change(screen.getByLabelText(/^search$/i), { target: { value: 'eggs' } });
  fireEvent.change(screen.getByLabelText(/^mode$/i), { target: { value: 'hybrid' } });
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  const searchUrl = String(global.fetch.mock.calls[1][0]);

  expect(searchUrl).toContain('op=hybrid');
  // Default bucket selection is 'recipes' — must be forwarded as `bucket`.
  expect(searchUrl).toContain('bucket=recipes');
  expect(searchUrl).not.toContain('bucket=all');
});
