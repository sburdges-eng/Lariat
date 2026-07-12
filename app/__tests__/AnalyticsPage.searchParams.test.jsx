// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
//
// Regression for a bug found during the GH #250 checkjs migration of
// app/analytics/page.jsx: the page took no props at all and hardcoded
// `loc = DEFAULT_LOCATION_ID`, so `?location=` was never read. Every
// sibling tile on /command builds its href as `` `/analytics${locQ}` ``
// (same pattern used for /eighty-six, /inventory/par,
// /costing/price-shocks, /prep, /labor, /food-safety, /beo,
// /reservations) where `locQ` is `?location=<id>` for a non-default
// location, and every one of those sibling pages reads
// `searchParams.location` and scopes its queries to it. This page alone
// silently discarded it — a manager at a non-default location clicking
// the Sales tile would see another location's revenue numbers.
import React from 'react';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

const calls = [];

jest.mock('../../lib/db', () => ({
  getDb: () => ({
    prepare: (sql) => ({
      all: (...args) => {
        calls.push({ method: 'all', sql, args });
        return [];
      },
      get: (...args) => {
        calls.push({ method: 'get', sql, args });
        return undefined;
      },
    }),
  }),
}));

import AnalyticsPage from '../analytics/page.jsx';

describe('AnalyticsPage', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  test('awaits Promise searchParams and scopes every query to the requested location', async () => {
    render(await AnalyticsPage({ searchParams: Promise.resolve({ location: 'uptown' }) }));

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.args[0]).toBe('uptown');
    }
  });

  test('falls back to the default location with no searchParams', async () => {
    render(await AnalyticsPage({ searchParams: Promise.resolve({}) }));

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.args[0]).toBe('default');
    }
  });
});
