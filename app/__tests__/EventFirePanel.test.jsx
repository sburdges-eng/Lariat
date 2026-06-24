// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// EventFirePanel jsdom test (T3) — per-event fire schedule read-only view.
// Strict TDD: written before EventFirePanel.jsx exists.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import EventFirePanel from '../beo/_components/EventFirePanel';

// ── fetch helpers ─────────────────────────────────────────────────

function mockFetchOk(payload) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function mockFetchError() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 500,
    json: () => Promise.resolve({ error: 'server error' }),
  });
}

function mockFetchReject() {
  global.fetch = jest.fn().mockRejectedValue(new Error('network failure'));
}

afterEach(() => {
  jest.clearAllMocks();
});

// ── fixture data ──────────────────────────────────────────────────

// Use a fixed ISO fire_at that is well in the future relative to the test run
// so ageBucketFor will return 'green'.
const FAR_FUTURE = '2099-06-18T19:30:00.000Z';

const TWO_STATION_PAYLOAD = {
  date: '2099-06-18',
  location_id: 'default',
  stations: [
    {
      station_id: 'grill',
      courses: [
        {
          id: 1,
          event_id: 7,
          event_title: 'Smith Wedding',
          course_label: 'Entree',
          fire_at: FAR_FUTURE,
          lines: [
            { id: 9, item_name: 'Brisket', quantity: 80, prep_notes: 'no sauce' },
          ],
        },
      ],
    },
    {
      station_id: 'unassigned',
      courses: [
        {
          id: 2,
          event_id: 7,
          event_title: 'Smith Wedding',
          course_label: 'Dessert',
          fire_at: FAR_FUTURE,
          lines: [
            { id: 10, item_name: 'Cake', quantity: 2, prep_notes: null },
          ],
        },
      ],
    },
  ],
};

const EMPTY_PAYLOAD = {
  date: '2099-06-18',
  location_id: 'default',
  stations: [],
};

// ── tests ─────────────────────────────────────────────────────────

describe('EventFirePanel', () => {
  test('shows loading indicator while fetch is in-flight', () => {
    // Never resolves so loading persists
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    render(<EventFirePanel eventId={7} location="default" />);
    expect(screen.getByTestId('event-fire-loading')).toBeInTheDocument();
  });

  test('renders both stations with correct names after successful fetch', async () => {
    mockFetchOk(TWO_STATION_PAYLOAD);
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-fire-loading')).not.toBeInTheDocument();
    });

    const stations = screen.getAllByTestId('event-fire-station');
    expect(stations).toHaveLength(2);

    // First station: grill
    expect(stations[0]).toHaveTextContent('grill');

    // Second station: unassigned → displays as "Unassigned"
    expect(stations[1]).toHaveTextContent('Unassigned');
    expect(stations[1]).not.toHaveTextContent('unassigned');
  });

  test('renders course labels within each station', async () => {
    mockFetchOk(TWO_STATION_PAYLOAD);
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-fire-loading')).not.toBeInTheDocument();
    });

    const courses = screen.getAllByTestId('event-fire-course');
    expect(courses).toHaveLength(2);
    expect(courses[0]).toHaveTextContent('Entree');
    expect(courses[1]).toHaveTextContent('Dessert');
  });

  test('renders line items with item_name and quantity', async () => {
    mockFetchOk(TWO_STATION_PAYLOAD);
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-fire-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Brisket/)).toBeInTheDocument();
    expect(screen.getByText(/80/)).toBeInTheDocument();
    expect(screen.getByText(/no sauce/)).toBeInTheDocument();
    expect(screen.getByText(/Cake/)).toBeInTheDocument();
  });

  test('shows empty state when stations array is empty', async () => {
    mockFetchOk(EMPTY_PAYLOAD);
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-fire-empty')).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId('event-fire-station')).toHaveLength(0);
  });

  test('shows error state on non-200 response', async () => {
    mockFetchError();
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-fire-error')).toBeInTheDocument();
    });
  });

  test('shows error state on network failure', async () => {
    mockFetchReject();
    render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-fire-error')).toBeInTheDocument();
    });
  });

  test('does not fetch when eventId is null', () => {
    global.fetch = jest.fn();
    render(<EventFirePanel eventId={null} location="default" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refetches when eventId prop changes', async () => {
    // Use a single mock that returns different payloads per call
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount += 1;
      const payload = callCount === 1 ? TWO_STATION_PAYLOAD : EMPTY_PAYLOAD;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    });

    const { rerender } = render(<EventFirePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-fire-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('event_id=7'));

    // Rerender with a different eventId — should trigger a second fetch
    rerender(<EventFirePanel eventId={8} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-fire-empty')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    // Verify new URL used eventId=8
    const lastUrl = global.fetch.mock.calls[1][0];
    expect(lastUrl).toContain('event_id=8');
  });

  test('fetches with correct URL including eventId and location', async () => {
    mockFetchOk(TWO_STATION_PAYLOAD);
    render(<EventFirePanel eventId={42} location="patio" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-fire-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('event_id=42'),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('location=patio'),
    );
  });
});
