// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
//
// EightySixBoard — resolve() must scope its fetch to the caller's
// location via `?location=`, not just `body.location_id`.
//
// /api/eighty-six/resolve's cross-location IDOR guard (see the route's
// own header comment, added 2026-05-08) derives the caller's location
// from `?location=`/`?location_id=` on the URL ONLY
// (lib/location.ts locationFromRequest) — it deliberately ignores
// body.location_id so a caller can't just assert a different site's
// location_id in the POST body to bypass the WHERE-clause guard.
//
// A prior version of EightySixBoard's resolve() sent location_id in the
// JSON body but never appended it to the URL, so every resolve request
// implicitly asserted the DEFAULT_LOCATION_ID ('default') as the caller's
// location. For any non-default site, that never matched the row's real
// location_id, so the cross-location guard rejected the request as if it
// were an IDOR attempt — resolve() always failed and 86'd items could
// never be marked back in stock at any location other than 'default'.

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));

import EightySixBoard from '../eighty-six/EightySixBoard.jsx';

const BOARD_PROPS = {
  active: [
    {
      id: 7,
      item: 'Pork Chop',
      station_id: 'grill',
      reason: 'out',
      quantity: '',
      created_at: '2026-06-12 18:00:00',
      cook_id: 'alex',
    },
  ],
  resolved: [],
  cascaded: [],
  stations: [{ id: 'grill', name: 'Grill' }],
  date: '2026-06-12',
  locationId: 'downtown',
};

describe('EightySixBoard resolve() — location scoping', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('resolving an item at a non-default location includes ?location= on the fetch URL', async () => {
    render(<EightySixBoard {...BOARD_PROPS} />);

    fireEvent.click(screen.getByRole('button', { name: /Mark Pork Chop as back in stock/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/eighty-six/resolve?location=downtown');
  });
});
