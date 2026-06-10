// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('../../lib/data', () => ({
  getStations: () => [],
  getLineCheckTemplate: () => [],
  getRecipes: () => [],
}));

jest.mock('../../lib/db', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [],
      get: () => null,
    }),
  }),
  todayISO: () => '2026-06-09',
  getPreshiftNote: () => '',
  todayServiceLabel: () => 'Dinner',
}));

jest.mock('../../lib/lineSummary', () => ({
  activeLineCheckStations: (stations) => stations,
  lineSummaryText: () => 'No line check',
}));

jest.mock('../../lib/subRecipeGraph', () => ({
  cascadedFromEightySix: () => [],
}));

jest.mock('../_components/PreshiftNotes', () => function MockPreshiftNotes(props) {
  return React.createElement('div', {
    'data-testid': 'preshift-notes',
    'data-location-id': props.locationId,
  });
});

import TodayPage from '../page.jsx';

describe('TodayPage', () => {
  test('awaits Promise searchParams before deriving the location id', async () => {
    render(await TodayPage({ searchParams: Promise.resolve({ location: 'perf-ipad' }) }));

    expect(screen.getByTestId('preshift-notes')).toHaveAttribute('data-location-id', 'perf-ipad');
  });
});
