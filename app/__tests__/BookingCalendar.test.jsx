// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingCalendar from '../booking/BookingCalendar';

const ROWS = [
  {
    id: 1, band_name: 'armchair boogie', show_date: '2026-05-15',
    price: 15.0, door_tix: 'y', status: { announce_date: 'y', meta_ads: 'y' }, source_row: 4,
  },
  {
    id: 2, band_name: 'the bramble hollow', show_date: '2026-05-22',
    price: 12.0, door_tix: '-', status: {}, source_row: 5,
  },
];

describe('BookingCalendar', () => {
  test('renders one <tr> per row', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getAllByRole('row')).toHaveLength(ROWS.length + 1); // +header
  });

  test('shows placeholder for missing cap/sold', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  test('shows footer note about ticketing data', () => {
    render(<BookingCalendar rows={ROWS} />);
    expect(screen.getByText(/ticketing data not yet wired/i)).toBeInTheDocument();
  });

  test('renders empty-state banner when no rows', () => {
    render(<BookingCalendar rows={[]} />);
    expect(screen.getByText(/no shows on the books yet/i)).toBeInTheDocument();
  });

  test('row link points to /playbook?show=<id>', () => {
    render(<BookingCalendar rows={ROWS} />);
    const link = screen.getByRole('link', { name: /armchair boogie/i });
    expect(link).toHaveAttribute('href', '/playbook?show=1');
  });
});
