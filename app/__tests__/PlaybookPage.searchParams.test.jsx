// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
//
// Regression for a bug found during the GH #250 checkjs migration of
// app/playbook/page.jsx: the page read `searchParams` synchronously, but
// under Next 16's app router `searchParams` is a Promise. Reading it
// without `await` meant `sp` was the Promise object itself — `sp.show`
// and `sp.tab` were always `undefined` — so every link the tab-switcher
// and "switch show" nav in PlaybookHeader render (`/playbook?show=X&tab=Y`)
// silently did nothing: the page always fell back to nextUpcoming() and
// the Ads tab, regardless of what was in the URL.
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('../../lib/db', () => ({
  getDb: () => ({}),
}));

jest.mock('../../lib/showsRepo', () => ({
  getShowById: (_db, _locationId, id) =>
    id === 7
      ? { id: 7, band_name: 'Requested Band', show_date: '2026-08-01', price: 10, door_tix: 'y', status: {} }
      : null,
  nextUpcoming: () => ({
    id: 1, band_name: 'Default Next Band', show_date: '2026-07-01', price: 10, door_tix: 'y', status: {},
  }),
}));

import PlaybookPage from '../playbook/page.jsx';

describe('PlaybookPage', () => {
  test('awaits Promise searchParams to select the requested show and tab', async () => {
    render(
      await PlaybookPage({
        searchParams: Promise.resolve({ show: '7', tab: 'dayof' }),
      }),
    );

    // Requested show (id=7), not the nextUpcoming() fallback.
    expect(screen.getByText('Requested Band')).toBeInTheDocument();
    expect(screen.queryByText('Default Next Band')).not.toBeInTheDocument();

    // Requested tab (dayof), not the 'ads' default — DayOfTab renders a
    // "DICE email (tix, DOS)" row that no other tab renders (the nav
    // header always shows a "Day of event" link regardless of active tab,
    // so that text alone isn't a reliable signal).
    expect(screen.getByText('DICE email (tix, DOS)')).toBeInTheDocument();
  });

  test('falls back to nextUpcoming() + ads tab with no searchParams', async () => {
    render(await PlaybookPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText('Default Next Band')).toBeInTheDocument();
    expect(screen.queryByText('DICE email (tix, DOS)')).not.toBeInTheDocument();
  });
});
