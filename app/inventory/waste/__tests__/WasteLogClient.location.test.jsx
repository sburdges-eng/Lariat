// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
// /inventory/waste reads searchParams.location and filters
// inventory_updates by location_id. The range tabs ("Today" / "7 days" /
// "30 days") navigated to ?days=N only, dropping the venue and silently
// flipping a west kitchen onto the default site's waste.

import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

import WasteLogClient from '../WasteLogClient';

const EMPTY = {
  recent: [],
  byItem: [],
  stations: [],
  days: 7,
  date: '2026-09-27',
};

describe('WasteLogClient range links keep the active location', () => {
  it('preserves ?location= on every range tab', () => {
    render(<WasteLogClient {...EMPTY} locationId="west" />);
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'href',
      '/inventory/waste?days=1&location=west',
    );
    expect(screen.getByRole('link', { name: '7 days' })).toHaveAttribute(
      'href',
      '/inventory/waste?days=7&location=west',
    );
    expect(screen.getByRole('link', { name: '30 days' })).toHaveAttribute(
      'href',
      '/inventory/waste?days=30&location=west',
    );
  });

  it('omits location on a single-venue install', () => {
    render(<WasteLogClient {...EMPTY} locationId="default" />);
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'href',
      '/inventory/waste?days=1',
    );
  });
});
