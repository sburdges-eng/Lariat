// @ts-check
'use client';

// PeersBoard — read-only client view of LAN tablets (Lariat instances).
//
// Initial peers + hub are passed in from the server component (page.jsx)
// so first paint is already populated. The Refresh button and the 30-second
// auto-poll both go through GET /api/peers (the public face of
// `lib/peers.ts::loadPeersAndHub`). No mutations: the per-row
// "Claim as hub" button only opens an informational modal — real
// hub-claim wiring lands with cross-host sync.
//
// Hub identity uses the same key as `lib/hubFailover.ts`: (host, started_at).
// Service `name` is NOT a stable identifier on mDNS (bonjour appends
// conflict suffixes), so don't match on it.
//
// UI copy: "LAN tablets" / "tablets" in user-facing strings. Internal
// column names (Host, Started) stay technical because they're identifiers
// a manager needs to read off when calling support.

import { useCallback, useEffect, useState } from 'react';

/** @typedef {import('../../../lib/mdnsDiscovery.ts').DiscoveredInstance} DiscoveredInstance */

/**
 * Response shape a caller with a valid PIN cookie gets from GET /api/peers
 * (see `app/api/peers/route.js::buildPeersResponse`). This board is only
 * reachable via the PIN-gated `/management/peers` page, so the browser's
 * same-origin fetch always carries the cookie and this is the branch it
 * lands in — the redacted `{ peers: RedactedPeer[], hub: null, redacted:
 * true }` shape (unauth callers) is not modeled here.
 * @typedef {{ peers: DiscoveredInstance[], hub: DiscoveredInstance | null }} PeersResponse
 */

/**
 * Stable identity for a peer — matches `lib/hubFailover.ts::peerKey`.
 * @param {DiscoveredInstance | null | undefined} p
 * @returns {string}
 */
function peerKey(p) {
  const host = p?.host || '';
  const startedAt = p?.txt?.started_at || '';
  if (host && startedAt) return `${host}-${startedAt}`;
  if (host) return `host-${host}`;
  if (startedAt) return `started-${startedAt}`;
  return `name-${p?.name || ''}`;
}

/**
 * @param {DiscoveredInstance} peer
 * @param {DiscoveredInstance | null} hub
 * @returns {boolean}
 */
function isHub(peer, hub) {
  if (!hub || !peer) return false;
  return peer.host === hub.host && peer.txt?.started_at === hub.txt?.started_at;
}

/**
 * @param {string | undefined} iso
 * @returns {string}
 */
function formatStarted(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * @param {{
 *   initialPeers: DiscoveredInstance[],
 *   initialHub: DiscoveredInstance | null,
 * }} props
 */
export default function PeersBoard({ initialPeers, initialHub }) {
  const [peers, setPeers] = useState(
    /** @type {DiscoveredInstance[]} */ (initialPeers ?? [])
  );
  const [hub, setHub] = useState(
    /** @type {DiscoveredInstance | null} */ (initialHub ?? null)
  );
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState('');
  const [claimTarget, setClaimTarget] = useState(
    /** @type {DiscoveredInstance | null} */ (null)
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setErr('');
    try {
      const res = await fetch('/api/peers');
      if (!res.ok) {
        setErr('Couldn’t reach the network — try again');
        return;
      }
      /** @type {PeersResponse} */
      const data = await res.json();
      setPeers(Array.isArray(data?.peers) ? data.peers : []);
      setHub(data?.hub ?? null);
    } catch {
      setErr('Lost connection');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Auto-refresh every 30s. The server component's first-paint data is
    // up-to-the-second, so we wait a full interval before the first poll.
    const id = setInterval(() => {
      refresh();
    }, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div>
      <h1>LAN tablets</h1>
      <p className="subtitle">
        Lariat instances on this network. The Hub is the oldest tablet —
        it stays in charge until it goes offline.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            padding: '10px 14px',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && (
        <div role="alert" style={{ color: 'var(--red)', marginBottom: 16, fontSize: 13 }}>
          {err}
        </div>
      )}

      {peers.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--muted)',
            background: 'var(--panel-2)',
            borderRadius: 6,
          }}
        >
          <p>No tablets found on the network.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Host</th>
                <th>Version</th>
                <th>Started</th>
                <th>Fingerprint</th>
                <th>Role</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((peer) => {
                const role = isHub(peer, hub) ? 'Hub' : 'Peer';
                const key = peerKey(peer);
                return (
                  <tr
                    key={key}
                    data-testid={`peer-row-${peer.host}-${peer.txt?.started_at || ''}`}
                  >
                    <td>{peer.name || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {peer.host || '—'}
                    </td>
                    <td>{peer.txt?.version || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {formatStarted(peer.txt?.started_at)}
                    </td>
                    <td
                      style={{ fontFamily: 'monospace', fontSize: 12 }}
                      title={peer.txt?.pubkey_fp || 'No fingerprint advertised'}
                    >
                      {peer.txt?.pubkey_fp || '?'}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          background:
                            role === 'Hub'
                              ? 'rgba(200, 90, 42, 0.2)'
                              : 'rgba(120, 120, 120, 0.15)',
                          color:
                            role === 'Hub' ? 'var(--ember)' : 'var(--muted)',
                          padding: '2px 8px',
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {role}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setClaimTarget(peer)}
                        aria-label={`Claim as hub: ${peer.name || peer.host}`}
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Claim as hub
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {claimTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="claim-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: 'var(--panel)',
              padding: 24,
              borderRadius: 8,
              maxWidth: 480,
              width: '90%',
            }}
          >
            <h2 id="claim-modal-title" style={{ marginTop: 0 }}>
              Claim as hub
            </h2>
            <p>Coming with cross-host sync.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setClaimTarget(null)}
                style={{
                  padding: '8px 14px',
                  background: 'var(--accent)',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
