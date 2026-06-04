// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import DatapackSearchClient from '../datapack-search/DatapackSearchClient';
import AllergenLookupClient from '../allergen-lookup/AllergenLookupClient';

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

function unavailableStats() {
  return {
    ok: false,
    status: 503,
    json: async () => ({
      error: 'Reference data is not installed on this Mac',
      hint: 'Ask a manager to finish setup.',
    }),
  };
}

test('Data Pack Search shows unavailable state before submit and hides setup paths', async () => {
  global.fetch.mockResolvedValueOnce(unavailableStats());

  render(<DatapackSearchClient />);

  expect(await screen.findByText(/Reference data is not installed on this Mac/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Search$/i })).toBeDisabled();
  expect(screen.queryByText(/scripts\/datapack/i)).toBeNull();
  expect(global.fetch).toHaveBeenCalledWith('/api/datapack/search?op=stats');
});

test('Allergen Lookup shows unavailable state before submit and hides setup paths', async () => {
  global.fetch.mockResolvedValueOnce(unavailableStats());

  render(<AllergenLookupClient />);

  expect(await screen.findByText(/Reference data is not installed on this Mac/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Look up$/i })).toBeDisabled();
  expect(screen.queryByText(/scripts\/datapack/i)).toBeNull();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/datapack/search?op=stats'));
});
