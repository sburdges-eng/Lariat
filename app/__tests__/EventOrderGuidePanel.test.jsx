// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
// EventOrderGuidePanel jsdom test (T9) — cascade-driven order guide read-only view.
// Strict TDD: written before EventOrderGuidePanel.jsx exists.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import EventOrderGuidePanel from '../beo/_components/EventOrderGuidePanel';

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
  order_guide: [
    { ingredient: 'flour', unit: 'lb', total_needed: 10.0, on_hand: 0, to_order: 10.0 },
    { ingredient: 'butter', unit: 'lb', total_needed: 2.0, on_hand: 1.0, to_order: 1.0 },
  ],
  prep_demands: [],
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
  order_guide: [
    { ingredient: 'flour', unit: 'lb', total_needed: 10.0, on_hand: 0, to_order: 10.0 },
  ],
  prep_demands: [],
  unmapped: [],
  error: 'engine exploded on recipe lookup',
};

const CASCADE_WITH_MANIFEST_WARNINGS = {
  event_id: 7,
  order_guide: [
    { ingredient: 'flour', unit: 'lb', total_needed: 10.0, on_hand: 0, to_order: 10.0 },
  ],
  prep_demands: [],
  unmapped: [],
  manifest_warnings: [
    { recipe: 'beer_batter', issue: "declares sub-recipe 'beer_flour' but no BOM row references it" },
  ],
};

const CASCADE_WITH_WARNINGS = {
  event_id: 7,
  order_guide: [
    { ingredient: 'flour', unit: 'lb', total_needed: 10.0, on_hand: 0, to_order: 10.0 },
  ],
  prep_demands: [],
  unmapped: [],
  // Graceful-degradation channel: a recipe was skipped (bad unit / unknown sub /
  // cycle), so the order guide may be short — must be shown, never dropped.
  warnings: ["recipe 'birria' yields in 'qt' but demand asked for 5.0 'lb'"],
};

// ── tests ─────────────────────────────────────────────────────────

describe('EventOrderGuidePanel', () => {
  test('shows loading indicator while fetch is in-flight', () => {
    // Never resolves so loading persists
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
    render(<EventOrderGuidePanel eventId={7} location="default" />);
    expect(screen.getByTestId('event-order-guide-loading')).toBeInTheDocument();
  });

  test('renders a row per order_guide item after successful fetch', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-order-guide-loading')).not.toBeInTheDocument();
    });

    const rows = screen.getAllByTestId('event-order-guide-row');
    expect(rows).toHaveLength(2);
  });

  test('each row shows ingredient name and to_order quantity', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-order-guide-loading')).not.toBeInTheDocument();
    });

    expect(screen.getByText(/flour/)).toBeInTheDocument();
    expect(screen.getAllByText(/10/).length).toBeGreaterThan(0);
    expect(screen.getByText(/butter/)).toBeInTheDocument();
  });

  test('renders the order_guide table container', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-order-guide-table')).toBeInTheDocument();
    });
  });

  test('renders UnmappedCallout when unmapped items are present', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
    });

    expect(screen.getByText(/Mystery Item/)).toBeInTheDocument();
    expect(screen.getByText(/not in beo_recipe_map/)).toBeInTheDocument();
  });

  test('callout shows alongside data rows (not an alternative state)', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-order-guide-loading')).not.toBeInTheDocument();
    });

    // Both data rows AND callout present at the same time
    expect(screen.getAllByTestId('event-order-guide-row')).toHaveLength(2);
    expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
  });

  test('shows empty state when order_guide is empty and no unmapped/error', async () => {
    mockFetchOk(CASCADE_EMPTY);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-order-guide-empty')).toBeInTheDocument();
    });

    expect(screen.queryAllByTestId('event-order-guide-row')).toHaveLength(0);
    expect(screen.queryByTestId('event-cascade-unmapped')).not.toBeInTheDocument();
  });

  test('shows error state on non-200 response', async () => {
    mockFetchError();
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-order-guide-error')).toBeInTheDocument();
    });
  });

  test('shows error state on network failure', async () => {
    mockFetchReject();
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-order-guide-error')).toBeInTheDocument();
    });
  });

  test('does not fetch when eventId is null', () => {
    global.fetch = jest.fn();
    render(<EventOrderGuidePanel eventId={null} location="default" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refetches when eventId prop changes', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount += 1;
      const payload = callCount === 1 ? CASCADE_WITH_DATA : CASCADE_EMPTY;
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) });
    });

    const { rerender } = render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-order-guide-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('event_id=7'));

    rerender(<EventOrderGuidePanel eventId={8} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-order-guide-empty')).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const lastUrl = global.fetch.mock.calls[1][0];
    expect(lastUrl).toContain('event_id=8');
  });

  test('fetches with correct URL including eventId and location', async () => {
    mockFetchOk(CASCADE_WITH_DATA);
    render(<EventOrderGuidePanel eventId={42} location="patio" />);

    await waitFor(() => {
      expect(screen.queryByTestId('event-order-guide-loading')).not.toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('event_id=42'));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('location=patio'));
  });

  test('renders engine error string in the callout when error is present', async () => {
    mockFetchOk(CASCADE_WITH_ENGINE_ERROR);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-unmapped')).toBeInTheDocument();
    });

    expect(screen.getByText(/engine exploded on recipe lookup/)).toBeInTheDocument();
  });

  test('renders manifest warnings (declared-but-unreferenced sub-recipe) in the callout', async () => {
    mockFetchOk(CASCADE_WITH_MANIFEST_WARNINGS);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-manifest-warnings')).toBeInTheDocument();
    });

    expect(screen.getByText(/beer_batter/)).toBeInTheDocument();
    expect(screen.getByText(/no BOM row references it/)).toBeInTheDocument();
  });

  test('surfaces manifest warnings even when order_guide is empty (not swallowed by empty state)', async () => {
    mockFetchOk({
      event_id: 7,
      order_guide: [],
      prep_demands: [],
      unmapped: [],
      manifest_warnings: [
        { recipe: 'beer_batter', issue: 'declares sub-recipe beer_flour but no BOM row references it' },
      ],
    });
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-manifest-warnings')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('event-order-guide-empty')).not.toBeInTheDocument();
  });

  test('renders graceful-degradation warnings (skipped recipe) in the callout', async () => {
    mockFetchOk(CASCADE_WITH_WARNINGS);
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-warnings')).toBeInTheDocument();
    });

    expect(screen.getByText(/birria/)).toBeInTheDocument();
  });

  test('surfaces degradation warnings even when order_guide is empty (not swallowed by empty state)', async () => {
    mockFetchOk({
      event_id: 7,
      order_guide: [],
      prep_demands: [],
      unmapped: [],
      warnings: ["recipe 'birria' yields in 'qt' but demand asked for 5.0 'lb'"],
    });
    render(<EventOrderGuidePanel eventId={7} location="default" />);

    await waitFor(() => {
      expect(screen.getByTestId('event-cascade-warnings')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('event-order-guide-empty')).not.toBeInTheDocument();
  });
});
