// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
//
// CloudBridgeBoard — "Bridge: Set up / Not set up" status tile staleness (T8).
//
// The GET /api/cloud-bridge/dead-letters response includes a `configured`
// field (freshly computed via isCloudBridgeConfigured() per request). The
// tile must track that live value on refresh, not just the initial SSR
// prop. Also: if a response omits `configured` (older shape), the tile
// must keep its last-known value rather than flipping.

import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import CloudBridgeBoard from '../management/cloud-bridge/CloudBridgeBoard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

function makeResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        configured: false,
        queued_depth: 0,
        dead_letter_depth_total: 0,
        dead_letters: [],
        ...overrides.body,
      }),
    ...overrides.response,
  };
}

function renderBoard(props = {}) {
  return render(
    <CloudBridgeBoard
      configured={true}
      location="default"
      initialQueuedDepth={0}
      initialDeadLetterTotal={0}
      initialDeadLetters={[]}
      initialError={null}
      {...props}
    />
  );
}

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('CloudBridgeBoard — bridge status tile tracks refresh', () => {
  test('tile flips Set up → Not set up when refresh returns configured:false', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse());
    renderBoard({ configured: true });

    expect(screen.getByText('Set up')).toBeInTheDocument();
    expect(screen.queryByText('Not set up')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Not set up')).toBeInTheDocument();
    });
    expect(screen.queryByText('Set up')).not.toBeInTheDocument();
  });

  test('tile flips Not set up → Set up when refresh returns configured:true', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeResponse({ body: { configured: true } }));
    renderBoard({ configured: false });

    expect(screen.getByText('Not set up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(screen.getByText('Set up')).toBeInTheDocument();
    });
  });

  test('the 30s auto-refresh also updates the tile', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(makeResponse());
    renderBoard({ configured: true });

    expect(screen.getByText('Set up')).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not set up')).toBeInTheDocument();
  });

  test('a response without `configured` leaves the tile unchanged', async () => {
    // Older / degraded response shape: no configured field at all.
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse({
        body: { configured: undefined },
      })
    );
    renderBoard({ configured: true });

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Set up')).toBeInTheDocument();
    expect(screen.queryByText('Not set up')).not.toBeInTheDocument();
  });
});
