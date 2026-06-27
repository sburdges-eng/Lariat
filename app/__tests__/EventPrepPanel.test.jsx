// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// EventPrepPanel jsdom test (T9) — cascade-driven prep demands read-only view.
// Strict TDD: written before EventPrepPanel.jsx exists.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import EventPrepPanel from '../beo/_components/EventPrepPanel';

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

const CASCADE_WITH_DATA = {
  event_id: 7,
  order_guide: [],
  prep_demands: [
    { recipe_slug: 'beer_batter', display_name: 'Beer Batter', qty: 4.0, unit: 'qt' },
    { recipe_slug: 'pico_de_gallo', display_name: 'Pico de Gallo', qty: 2.0, unit: 'lb' },
  ],
  unmapped: [
    { menu_item: 'Mystery Item', reason: 'not in beo_recipe_map and no direct recipe match' },
  ],
};

const CASCADE_EMPTY = {
  event_id: 7,
  order_guide: [],
  prep_demands: [],
  unmapped: [],
};

const CASCADE_WITH_ENGINE_ERROR = {
  event_id: 7,
  order_guide: [],
  prep_demands: [
    { recipe_slug: 'beer_batter', display_name: 'Beer Batter', qty: 4.0, unit: 'qt' },
  ],
  unmapped: [],
  error: 'engine exploded on recipe lookup',
};

// ── tests ─────────────────────────────────────────────────────────

describe('EventPrepPanel', () => {
  test('shows loading indicator while fetch is in-flight', () => {
    // Never resolves so loading persists
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    render(<EventPrepPanel eventId={7} location="default" />);
    expect(screen.getByTestId('event-prep-loading')).toBeInTheDocument();
  });

  test('renders a row per prep_demands item after successful fetch', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-prep-loading')).not.toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('event-prep-row');
    expect(rows).toHaveLength(2);
  });

  test('each row shows display_name and qty', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-prep-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Beer Batter/)).toBeInTheDocument();
    expect(screen.getByText(/Pico de Gallo/)).toBeInTheDocument();
    expect(screen.getByText(/4/)).toBeInTheDocument();
  });

  test('renders the prep list container', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-prep-list')).toBeInTheDocument();
    });
  });

  test('renders UnmappedCallout when unmapped items are present', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
    });

    expect(screen.getByText(/Mystery Item/)).toBeInTheDocument();
    expect(screen.getByText(/not in beo_recipe_map/)).toBeInTheDocument();
  });

  test('callout shows alongside data rows (not an alternative state)', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-prep-loading')).not.toBeInTheDocument();
    });

    // Both data rows AND callout present at the same time
    expect(screen.getAllByTestId('event-prep-row')).toHaveLength(2);
    expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
  });

  test('shows empty state when prep_demands is empty and no unmapped/error', async () => {
    mockFetchOk(CASCADE_EMPTY);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-prep-empty')).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId('event-prep-row')).toHaveLength(0);
    expect(screen.queryByTestId('event-cascade-unmapped')).not.toBeInTheDocument();
  });

  test('shows error state on non-200 response', async () => {
    mockFetchError();
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-prep-error')).toBeInTheDocument();
    });
  });

  test('shows error state on network failure', async () => {
    mockFetchReject();
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-prep-error')).toBeInTheDocument();
    });
  });

  test('does not fetch when eventId is null', () => {
    global.fetch = jest.fn();
    render(<EventPrepPanel eventId={null} location="default" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refetches when eventId prop changes', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount += 1;
      const payload = callCount === 1 ? CASCADE_WITH_DATA : CASCADE_EMPTY;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    });

    const { rerender } = render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-prep-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('event_id=7'));

    rerender(<EventPrepPanel eventId={8} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-prep-empty')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const lastUrl = global.fetch.mock.calls[1][0];
    expect(lastUrl).toContain('event_id=8');
  });

  test('fetches with correct URL including eventId and location', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventPrepPanel eventId={42} location="patio" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-prep-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('event_id=42'));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('location=patio'));
  });

  test('renders engine error string in the callout when error is present', async () => {
    mockFetchOk(CASCADE_WITH_ENGINE_ERROR);
    render(<EventPrepPanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
    });

    expect(screen.getByText(/engine exploded on recipe lookup/)).toBeInTheDocument();
  });

  // ── T6-fix regression: on_hand_unapplied / manifest_warnings prevent empty state ──

  test('renders callout (not empty state) when only on_hand_unapplied is present', async () => {
    mockFetchOk({
      event_id: 7,
      prep_demands: [],
      unmapped: [],
      on_hand_unapplied: [
        { ingredient: 'sysco flour', unit: 'case', on_hand: 4, reason: 'no matching order-guide leaf (ingredient/unit)' },
      ],
      manifest_warnings: [],
    });
    render(<EventPrepPanel eventId={1} />);

    expect(await screen.findByTestId('event-cascade-unmapped')).toBeInTheDocument();
    expect(screen.queryByTestId('event-prep-empty')).toBeNull();
  });

  test('renders callout (not empty state) when only manifest_warnings is present', async () => {
    mockFetchOk({
      event_id: 7,
      prep_demands: [],
      unmapped: [],
      on_hand_unapplied: [],
      manifest_warnings: [
        { recipe: 'beer_batter', warning: 'yield ratio out of range' },
      ],
    });
    render(<EventPrepPanel eventId={1} />);

    expect(await screen.findByTestId('event-cascade-unmapped')).toBeInTheDocument();
    expect(screen.queryByTestId('event-prep-empty')).toBeNull();
  });
});
