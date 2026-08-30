// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// app/api/gold-stars/route.ts scopes every read and write by location — :22
// locationFromRequest, :77 locationFromBody, WHERE location_id = ? on both
// selects. The board sent none of its fetches a location, so on a non-default
// venue it read the default venue's recognitions and awarded new ones there.
//
// navRegistry already marks /gold-stars locAware, so the nav was sending
// ?location=west and the board was ignoring it.

import React from 'react';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';

let mockSearchParams = new URLSearchParams('');
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

import GoldStarBoard from '../GoldStarBoard';

beforeEach(() => {
  window.localStorage.clear();
  mockSearchParams = new URLSearchParams('');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => [],
  });
});

afterEach(() => jest.restoreAllMocks());

/** Every gold-stars URL the board asked for. */
function goldStarUrls() {
  return global.fetch.mock.calls
    .map(([u]) => String(u))
    .filter((u) => u.includes('/api/gold-stars'));
}

describe('GoldStarBoard carries the active location', () => {
  it('scopes its reads to the location in the URL', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<GoldStarBoard />);

    // useLocation seeds with the default on the server render and resolves the
    // real venue in an effect, so the very first fetch is unscoped by design —
    // that hydration shape is shared by every board in the app. What matters is
    // that the board re-reads against the named venue once it resolves, which
    // is what the location deps on the loader are for.
    // Assert BOTH endpoints, not just "some call was scoped" — the board reads
    // the recognition list and the leaderboard separately, and scoping one
    // while dropping the other is exactly the half-fixed state this guards.
    await waitFor(() => {
      const scoped = goldStarUrls().filter((u) => u.includes('location=west'));
      const list = scoped.filter((u) => !u.includes('view=leaderboard'));
      const board = scoped.filter((u) => u.includes('view=leaderboard'));
      expect({ list: list.length > 0, leaderboard: board.length > 0 })
        .toEqual({ list: true, leaderboard: true });
    });
  });

  it('leaves the staff roster unscoped — it has no location column', async () => {
    mockSearchParams = new URLSearchParams('location=west');
    render(<GoldStarBoard />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const staff = global.fetch.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/api/staff'));
    expect(staff.every((u) => !u.includes('location='))).toBe(true);
  });

  it('sends no location query on a single-venue install', async () => {
    render(<GoldStarBoard />);
    await waitFor(() => expect(goldStarUrls().length).toBeGreaterThan(0));
    expect(goldStarUrls().every((u) => !u.includes('location='))).toBe(true);
  });
});
