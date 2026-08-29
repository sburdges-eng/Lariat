// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// An allergen attestation is a named, PIN-bound, fingerprinted manager
// signoff with a transactional audit row — the record a venue produces when
// a guest is harmed. RecipeAttestations GET and POSTed it with no location
// at all: a bare fetch('/api/allergens/attestations') and a body carrying
// slug/allergens/attested_by/note and nothing else.
//
// The route defaults both sides to 'default' (route.js:51/:132) and
// lib/allergenAttestations.ts:172 filters `WHERE location_id = ?`, so the
// library layer is isolated and fully tested — the drop is entirely on the
// client, which is why no server-side suite caught it. Two venues sharing an
// install pooled their signoffs: site B's manager verifying a dish marked it
// verified for site A, whose kitchen may plate it differently.
//
// CLAUDE.md section 8 names this the recurring bug class in this repo.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockSearchParams = new URLSearchParams('');

jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import RecipeAttestations from '../RecipeAttestations';

const RECIPE = {
  recipe_slug: 'pork-green-chile',
  name: 'Pork green chile',
  heuristic_allergens: ['wheat'],
  latest: null,
  stale: false,
};

function mockLoad() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ recipes: [RECIPE] }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams = new URLSearchParams('');
  mockLoad();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('RecipeAttestations carries the active location', () => {
  it('scopes the recipe list to the location in the URL', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<RecipeAttestations />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    await waitFor(() => {
      const urls = global.fetch.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.includes('location=west'))).toBe(true);
    });
  });

  it('files the signoff against that location, not the default', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<RecipeAttestations />);

    const open = await screen.findByRole('button', { name: /attest allergen list/i });
    fireEvent.click(open);

    fireEvent.change(screen.getByLabelText('Attesting manager name'), {
      target: { value: 'Sean' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm attestation/i }));

    await waitFor(() => {
      const post = global.fetch.mock.calls.find(([, init]) => init && init.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post[1].body).location_id).toBe('west');
    });
  });

  it('sends no location query on a single-venue install', async () => {
    // qsFor() returns '' for the default location, so the URL stays clean and
    // the route's own fallback still applies.
    render(<RecipeAttestations />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const urls = global.fetch.mock.calls.map(([u]) => String(u));
    expect(urls.every((u) => !u.includes('location='))).toBe(true);
  });
});
