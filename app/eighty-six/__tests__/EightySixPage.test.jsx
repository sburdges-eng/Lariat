// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

import React from 'react';

jest.mock('../../../lib/db', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [],
    }),
  }),
  todayISO: () => '2026-06-09',
}));

jest.mock('../../../lib/data', () => ({
  getStations: () => [],
  getRecipes: () => [],
}));

jest.mock('../../../lib/subRecipeGraph', () => ({
  cascadedFromEightySix: () => [],
}));

jest.mock('../EightySixBoard.jsx', () => function MockEightySixBoard() {
  return React.createElement('div', null, 'mock board');
});

import EightySixPage from '../page.jsx';

describe('EightySixPage', () => {
  test('awaits Promise searchParams before deriving the location id', async () => {
    const element = await EightySixPage({
      searchParams: Promise.resolve({ location: 'perf-ipad' }),
    });

    expect(element.props.locationId).toBe('perf-ipad');
  });

  test('falls back to the default location when Promise searchParams has no usable location', async () => {
    const element = await EightySixPage({
      searchParams: Promise.resolve({ location: '   ' }),
    });

    expect(element.props.locationId).toBe('default');
  });
});
