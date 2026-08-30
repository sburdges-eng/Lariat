// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// /purchasing hardcoded `const loc = DEFAULT_LOCATION_ID` and never read
// searchParams at all. Every other board threads ?location= through; this one
// structurally could not, so /purchasing?location=west showed the DEFAULT
// venue's order guide with nothing on screen to say so.
//
// It is a PIN-gated manager surface (middleware SENSITIVE_PREFIXES), and what
// it shows is what somebody orders from.

import React from 'react';
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';

const locationsQueried = [];

jest.mock('../../../lib/db', () => ({
  getDb: () => ({
    prepare: () => ({
      all: (...args) => { locationsQueried.push(args[0]); return []; },
      get: (...args) => { locationsQueried.push(args[0]); return { c: 0 }; },
    }),
  }),
}));

jest.mock('../../../lib/orderGuideEnrichment.ts', () => ({
  enrichOrderGuideRows: (_db, rows) => rows,
}));

import PurchasingPage from '../page';

beforeEach(() => {
  locationsQueried.length = 0;
});

describe('/purchasing carries the active location', () => {
  it('queries the location named in the URL', async () => {
    render(await PurchasingPage({ searchParams: { location: 'west' } }));
    expect(locationsQueried.length).toBeGreaterThan(0);
    for (const loc of locationsQueried) {
      expect(loc).toBe('west');
    }
  });

  it('falls back to the default location when none is named', async () => {
    render(await PurchasingPage({ searchParams: {} }));
    expect(locationsQueried.length).toBeGreaterThan(0);
    for (const loc of locationsQueried) {
      expect(loc).toBe('default');
    }
  });

  it('tolerates searchParams being absent entirely', async () => {
    render(await PurchasingPage({}));
    for (const loc of locationsQueried) {
      expect(loc).toBe('default');
    }
  });
});
