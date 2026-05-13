// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/** @jest-environment jsdom */
//
// PeersBoard jsdom test — read-only LAN-tablet board.
//
// Covers the four behaviors the spec calls out:
//   1. Renders correctly with 0 / 1 / N peers (initial-data path).
//   2. Hub badge appears on the elected peer (matched by host + started_at).
//   3. Refresh button calls /api/peers and merges the response into state.
//   4. Claim-as-hub button opens a modal whose body says
//      "Coming with cross-host sync."
//   5. Auto-refresh fires once after 30s when fake timers are used.
//
// We avoid asserting against arbitrary CSS — the test reads the visible text
// and the DOM roles, matching the StatusPill / TempPins / FireSchedule test
// idiom in this directory.

import { fireEvent, render, screen, act, within, waitFor } from '@testing-library/react';
import PeersBoard from '../management/peers/PeersBoard';

function makePeer(overrides = {}) {
  return {
    name: 'Lariat',
    host: 'host-a.local',
    addresses: ['192.168.1.10'],
    port: 3000,
    txt: {
      version: '0.1.0',
      location_id: 'default',
      started_at: '2026-05-01T12:00:00.000Z',
    },
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('PeersBoard — empty state', () => {
  test('renders an empty state when zero peers', () => {
    render(<PeersBoard initialPeers={[]} initialHub={null} />);
    expect(screen.getByText(/no tablets/i)).toBeInTheDocument();
  });
});

describe('PeersBoard — single peer with hub badge', () => {
  test('marks the elected peer as Hub', () => {
    const peer = makePeer({ name: 'Lariat', host: 'kitchen.local' });
    render(<PeersBoard initialPeers={[peer]} initialHub={peer} />);
    const row = screen.getByTestId(`peer-row-${peer.host}-${peer.txt.started_at}`);
    expect(within(row).getByText(/^Hub$/)).toBeInTheDocument();
    expect(within(row).getByText('kitchen.local')).toBeInTheDocument();
  });
});

describe('PeersBoard — multiple peers', () => {
  test('only the elected peer shows the Hub badge; others show Peer', () => {
    const elder = makePeer({
      name: 'Lariat-1',
      host: 'kitchen.local',
      txt: {
        version: '0.1.0',
        location_id: 'default',
        started_at: '2026-05-01T08:00:00.000Z',
      },
    });
    const youngA = makePeer({
      name: 'Lariat-2',
      host: 'service.local',
      txt: {
        version: '0.1.0',
        location_id: 'default',
        started_at: '2026-05-02T09:00:00.000Z',
      },
    });
    const youngB = makePeer({
      name: 'Lariat-3',
      host: 'upstairs.local',
      txt: {
        version: '0.1.0',
        location_id: 'default',
        started_at: '2026-05-03T10:00:00.000Z',
      },
    });
    render(
      <PeersBoard
        initialPeers={[elder, youngA, youngB]}
        initialHub={elder}
      />
    );

    const elderRow = screen.getByTestId(`peer-row-${elder.host}-${elder.txt.started_at}`);
    expect(within(elderRow).getByText(/^Hub$/)).toBeInTheDocument();

    const youngARow = screen.getByTestId(`peer-row-${youngA.host}-${youngA.txt.started_at}`);
    expect(within(youngARow).getByText(/^Peer$/)).toBeInTheDocument();
    expect(within(youngARow).queryByText(/^Hub$/)).not.toBeInTheDocument();

    const youngBRow = screen.getByTestId(`peer-row-${youngB.host}-${youngB.txt.started_at}`);
    expect(within(youngBRow).getByText(/^Peer$/)).toBeInTheDocument();
  });
});

describe('PeersBoard — refresh button', () => {
  test('clicking Refresh calls /api/peers and merges new peers', async () => {
    const original = makePeer({ host: 'kitchen.local' });
    const incoming = makePeer({
      host: 'service.local',
      txt: {
        version: '0.1.0',
        location_id: 'default',
        started_at: '2026-05-04T18:00:00.000Z',
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ peers: [original, incoming], hub: original }),
    });
    render(<PeersBoard initialPeers={[original]} initialHub={original} />);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/peers');
    });
    await waitFor(() => {
      expect(
        screen.getByTestId(`peer-row-${incoming.host}-${incoming.txt.started_at}`)
      ).toBeInTheDocument();
    });
  });
});

describe('PeersBoard — claim-as-hub modal', () => {
  test('clicking the per-row Claim button opens the read-only modal', () => {
    const peer = makePeer();
    render(<PeersBoard initialPeers={[peer]} initialHub={peer} />);

    expect(screen.queryByText(/coming with cross-host sync/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /claim as hub/i }));

    expect(screen.getByText(/coming with cross-host sync/i)).toBeInTheDocument();
  });

  test('Close button dismisses the modal', () => {
    const peer = makePeer();
    render(<PeersBoard initialPeers={[peer]} initialHub={peer} />);
    fireEvent.click(screen.getByRole('button', { name: /claim as hub/i }));
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByText(/coming with cross-host sync/i)).not.toBeInTheDocument();
  });
});

describe('PeersBoard — auto-refresh', () => {
  test('fetches /api/peers once after 30s when mounted', async () => {
    jest.useFakeTimers();
    const peer = makePeer();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ peers: [peer], hub: peer }),
    });
    render(<PeersBoard initialPeers={[peer]} initialHub={peer} />);

    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/peers');
  });
});
