// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BeoBoard from '../beo/BeoBoard';

// ── fetch mock helpers ────────────────────────────────────────────

const BEO_PAYLOAD = {
  location_id: 'default',
  events: [
    {
      id: 1,
      title: 'Test Party',
      event_date: null,
      event_time: null,
      contact_name: null,
      guest_count: null,
      notes: null,
      tax_rate: null,
      service_fee_pct: null,
      location_id: 'default',
    },
  ],
  line_items: [
    { id: 1, event_id: 1, item_name: 'Smoked Brisket', quantity: 2, unit_cost: 10, category: null },
  ],
  prep_tasks: [],
};

const COURSES_PAYLOAD = { courses: [] };

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((url) => {
    if (typeof url === 'string' && url.includes('/api/beo/courses')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(COURSES_PAYLOAD) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(BEO_PAYLOAD) });
  });
}

afterEach(() => {
  jest.clearAllMocks();
});

// ── tests ─────────────────────────────────────────────────────────

describe('BeoBoard tab scaffold', () => {
  test('default Sheet tab renders prep-sheet content when an event is open', async () => {
    mockFetch();
    render(<BeoBoard />);

    // Wait for the event to load and the sheet tab panel to appear
    const sheetPanel = await screen.findByTestId('beo-tabpanel-sheet');
    expect(sheetPanel).toBeInTheDocument();

    // The prep-sheet table should be visible inside the sheet panel
    expect(sheetPanel.querySelector('.beo-prep-sheet')).toBeTruthy();
  });

  test('all four tab buttons render when an event is open', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-sheet');
    expect(screen.getByTestId('beo-tab-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('beo-tab-order-guide')).toBeInTheDocument();
    expect(screen.getByTestId('beo-tab-prep')).toBeInTheDocument();
    expect(screen.getByTestId('beo-tab-fire')).toBeInTheDocument();
  });

  test('tab labels match spec exactly', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-sheet');
    expect(screen.getByTestId('beo-tab-sheet')).toHaveTextContent('Sheet');
    expect(screen.getByTestId('beo-tab-order-guide')).toHaveTextContent('Order guide');
    expect(screen.getByTestId('beo-tab-prep')).toHaveTextContent('Prep');
    expect(screen.getByTestId('beo-tab-fire')).toHaveTextContent('Fire');
  });

  test('Sheet tab has aria-current="page" by default', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-sheet');
    expect(screen.getByTestId('beo-tab-sheet')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('beo-tab-order-guide')).not.toHaveAttribute('aria-current');
  });

  test('clicking Order guide shows its placeholder and hides the sheet', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-order-guide');
    fireEvent.click(screen.getByTestId('beo-tab-order-guide'));

    expect(screen.getByTestId('beo-tabpanel-order-guide')).toBeInTheDocument();
    expect(screen.queryByTestId('beo-tabpanel-sheet')).not.toBeInTheDocument();

    // placeholder copy
    expect(screen.getByTestId('beo-tabpanel-order-guide')).toHaveTextContent('Order guide — coming soon');
  });

  test('clicking Prep shows its placeholder and hides the sheet', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-prep');
    fireEvent.click(screen.getByTestId('beo-tab-prep'));

    expect(screen.getByTestId('beo-tabpanel-prep')).toBeInTheDocument();
    expect(screen.queryByTestId('beo-tabpanel-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('beo-tabpanel-prep')).toHaveTextContent('Prep — coming soon');
  });

  test('clicking Fire shows its placeholder and hides the sheet', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-fire');
    fireEvent.click(screen.getByTestId('beo-tab-fire'));

    expect(screen.getByTestId('beo-tabpanel-fire')).toBeInTheDocument();
    expect(screen.queryByTestId('beo-tabpanel-sheet')).not.toBeInTheDocument();
    expect(screen.getByTestId('beo-tabpanel-fire')).toHaveTextContent('Fire — coming soon');
  });

  test('clicking Sheet after another tab restores the worksheet', async () => {
    mockFetch();
    render(<BeoBoard />);

    await screen.findByTestId('beo-tab-prep');
    fireEvent.click(screen.getByTestId('beo-tab-prep'));
    expect(screen.queryByTestId('beo-tabpanel-sheet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('beo-tab-sheet'));
    expect(screen.getByTestId('beo-tabpanel-sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('beo-tabpanel-prep')).not.toBeInTheDocument();
  });

  test('tab bar is absent when no event is selected', async () => {
    // Return no events so nothing opens
    global.fetch = jest.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/beo/courses')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(COURSES_PAYLOAD) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ location_id: 'default', events: [], line_items: [], prep_tasks: [] }),
      });
    });

    render(<BeoBoard />);

    // Wait for load to settle (empty state message should appear)
    await screen.findByText(/pick or add a party/i);

    expect(screen.queryByTestId('beo-tab-sheet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('beo-tab-order-guide')).not.toBeInTheDocument();
  });
});
