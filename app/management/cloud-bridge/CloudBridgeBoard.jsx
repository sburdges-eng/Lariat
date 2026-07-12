// @ts-check
'use client';

// CloudBridgeBoard — manager view of cloud-bridge queue health and
// dead-letter triage. See app/management/cloud-bridge/page.jsx for the
// server-side first-paint plumbing.
//
// Actions:
//   - Inspect: expand a row to show its row payload (read-only).
//   - Requeue: clear dead_letter, reset attempts, re-arm for the drainer.
//   - Drop: DELETE the row. Requires explicit confirm (a typed click —
//           we render a "Are you sure?" inline state, not a window.confirm).
//
// The mutation routes write a management-action audit row server-side
// (see app/api/cloud-bridge/dead-letters/[id]/{requeue,drop}/route.js).
//
// Auto-refresh: every 30s, identical cadence to /management/peers.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/** @typedef {import('../../../lib/cloudBridgeQueue.ts').DeadLetterBatch} DeadLetterBatch */

/**
 * Desktop bridge-config affordance. Populated by desktop/preload.ts's
 * `window.lariat` bridge; only present when running inside the Electron
 * shell (see desktop/settings.ts for the canonical Settings shape — kept
 * minimal here rather than importing that file, which sits outside the
 * app/ TS program per tsconfig.json's `desktop/**` exclude).
 * @typedef {Object} LariatDesktopSettings
 * @property {string} [cloudBridgeUrl]
 * @property {string} [cloudBridgeSecret]
 */
/**
 * @typedef {Object} LariatDesktopApi
 * @property {() => Promise<LariatDesktopSettings | null>} getSettings
 * @property {(settings: LariatDesktopSettings) => Promise<void>} setSettings
 */

/** @param {string | null | undefined} value */
function formatTime(value) {
  if (!value) return '—';
  // SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" without a 'Z'.
  // Treat as UTC for parsing, render local.
  const iso = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

/** @param {string | null | undefined} text */
function previewError(text) {
  if (!text) return '—';
  if (text.length <= 80) return text;
  return text.slice(0, 77) + '…';
}

// Human-readable table name for the row column. The allow-listed tables
// are kitchen-meaningful when translated; an unknown table falls back to
// underscore-stripped passthrough so a future-allowed table still reads
// reasonably without a code change here.
/** @type {Record<string, string>} */
const BATCH_LABELS = {
  settlement_summaries: 'Settlement totals',
  beo_events: 'Event prep',
  spend_monthly: 'Monthly spend',
};
/** @param {string | null | undefined} table */
function batchLabel(table) {
  if (!table) return 'Batch';
  return BATCH_LABELS[table] ?? String(table).replaceAll('_', ' ');
}

// Recursively replace underscores in object keys so the inspect view
// reads as plain English ("shift date") instead of dev-shaped column
// names ("shift_date"). Arrays/primitives passed through.
/**
 * Read the desktop-shell bridge, if present. A plain function (not a
 * memoized value) so every call reflects the live global — same
 * semantics as the pre-migration direct `window.lariat` reads.
 * @returns {LariatDesktopApi | undefined}
 */
function getLariatApi() {
  if (typeof window === 'undefined') return undefined;
  return /** @type {Window & { lariat?: LariatDesktopApi }} */ (window).lariat;
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function displayPayload(value) {
  if (Array.isArray(value)) return value.map(displayPayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k.replaceAll('_', ' '),
      displayPayload(v),
    ]),
  );
}

/**
 * @param {Object} props
 * @param {boolean} props.configured
 * @param {string} props.location
 * @param {number} props.initialQueuedDepth
 * @param {number} props.initialDeadLetterTotal
 * @param {DeadLetterBatch[]} props.initialDeadLetters
 * @param {string | null} props.initialError
 */
export default function CloudBridgeBoard({
  configured,
  location,
  initialQueuedDepth,
  initialDeadLetterTotal,
  initialDeadLetters,
  initialError,
}) {
  const router = useRouter();
  const [bridgeConfigured, setBridgeConfigured] = useState(
    Boolean(configured),
  );
  const [queuedDepth, setQueuedDepth] = useState(initialQueuedDepth ?? 0);
  const [deadLetterTotal, setDeadLetterTotal] = useState(
    initialDeadLetterTotal ?? 0,
  );
  const [deadLetters, setDeadLetters] = useState(initialDeadLetters ?? []);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState(initialError || '');
  const [expandedId, setExpandedId] = useState(
    /** @type {number | null} */ (null),
  );
  const [confirmDropId, setConfirmDropId] = useState(
    /** @type {number | null} */ (null),
  );
  const [busyId, setBusyId] = useState(/** @type {number | null} */ (null));
  const [flash, setFlash] = useState('');

  // Configuration state
  const [configUrl, setConfigUrl] = useState('');
  const [configSecret, setConfigSecret] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    const api = getLariatApi();
    if (api) {
      api.getSettings().then((s) => {
        if (s) {
          setConfigUrl(s.cloudBridgeUrl || '');
          setConfigSecret(s.cloudBridgeSecret || '');
        }
      });
    }
  }, []);

  const saveConfig = async () => {
    const api = getLariatApi();
    if (!api) return;
    setSavingConfig(true);
    setErr('');
    try {
      const s = await api.getSettings();
      await api.setSettings({
        ...s,
        cloudBridgeUrl: configUrl.trim(),
        cloudBridgeSecret: configSecret.trim(),
      });
      setFlash('Settings saved. Restart Lariat to apply.');
    } catch {
      setErr('Failed to save settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setErr('');
    try {
      const url = `/api/cloud-bridge/dead-letters?location=${encodeURIComponent(location)}`;
      const res = await fetch(url);
      if (res.status === 401 || res.status === 403) {
        router.replace(
          `/login-pin?next=${encodeURIComponent('/management/cloud-bridge')}`,
        );
        return;
      }
      if (!res.ok) {
        setErr('Couldn’t load the queue — try again');
        return;
      }
      const data = await res.json();
      // The route recomputes isCloudBridgeConfigured() per request; track
      // it so the "Bridge" tile reflects reality, not just the SSR prop.
      // Fall back gracefully (keep last-known) if the field is absent.
      if (typeof data.configured === 'boolean') {
        setBridgeConfigured(data.configured);
      }
      setQueuedDepth(data.queued_depth ?? 0);
      setDeadLetterTotal(data.dead_letter_depth_total ?? 0);
      setDeadLetters(Array.isArray(data.dead_letters) ? data.dead_letters : []);
    } catch {
      setErr('Lost connection');
    } finally {
      setRefreshing(false);
    }
  }, [location, router]);

  useEffect(() => {
    const id = setInterval(() => {
      refresh();
    }, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * @param {number} id
   * @param {'requeue' | 'drop'} action
   */
  const postAction = async (id, action) => {
    setBusyId(id);
    setErr('');
    try {
      // Pass ?location= so the route's cross-location IDOR guard
      // matches against the same site the board is currently scoped to.
      const url = `/api/cloud-bridge/dead-letters/${id}/${action}?location=${encodeURIComponent(location)}`;
      const res = await fetch(url, { method: 'POST' });
      if (res.status === 401 || res.status === 403) {
        router.replace(
          `/login-pin?next=${encodeURIComponent('/management/cloud-bridge')}`,
        );
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const verb = action === 'drop' ? 'drop' : 'requeue';
        setErr(body?.error || `Couldn’t ${verb} (${res.status})`);
        return;
      }
      setFlash(action === 'drop' ? `Dropped #${id}` : `Requeued #${id}`);
      if (action === 'drop') {
        setConfirmDropId(null);
        if (expandedId === id) setExpandedId(null);
      }
      await refresh();
    } catch {
      setErr('Lost connection');
    } finally {
      setBusyId(null);
    }
  };

  const flashClear = useCallback(() => {
    setFlash('');
  }, []);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(flashClear, 4000);
    return () => clearTimeout(t);
  }, [flash, flashClear]);

  return (
    <div>
      <h1>Cloud bridge</h1>
      <p className="subtitle">
        Outage queue for snapshots heading to the corp office. Stuck batches
        land here for the manager to look at, retry, or drop.
      </p>

      {/* Configuration Form (Desktop only) */}
      {typeof window !== 'undefined' && getLariatApi() && (
        <div className="card" style={{ padding: 16, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Bridge Configuration</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                Cloud Bridge URL
              </label>
              <input
                type="text"
                value={configUrl}
                onChange={(e) => setConfigUrl(e.target.value)}
                placeholder="https://lariat-cloud.example.com"
                style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                Bridge Secret
              </label>
              <input
                type="password"
                value={configSecret}
                onChange={(e) => setConfigSecret(e.target.value)}
                placeholder="••••••••"
                style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid var(--border)' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              style={{
                padding: '8px 16px',
                background: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 14,
                cursor: savingConfig ? 'not-allowed' : 'pointer',
              }}
            >
              {savingConfig ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Status strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Bridge</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: bridgeConfigured ? 'var(--green)' : 'var(--muted)',
            }}
          >
            {bridgeConfigured ? 'Set up' : 'Not set up'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {bridgeConfigured
              ? 'URL + secret on file'
              : 'No URL or secret — drainer is idle'}
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Waiting to send</div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{queuedDepth}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            queued, not yet pushed
          </div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Stuck</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color:
                deadLetterTotal > 0 ? 'var(--red)' : 'var(--muted)',
            }}
          >
            {deadLetterTotal}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            gave up after retry
          </div>
        </div>
      </div>

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
        <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>
          Showing site: <strong>{location}</strong>
        </span>
      </div>

      {flash && (
        <div
          role="status"
          style={{
            color: 'var(--green)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {flash}
        </div>
      )}

      {err && (
        <div role="alert" style={{ color: 'var(--red)', marginBottom: 16, fontSize: 13 }}>
          {err}
        </div>
      )}

      {deadLetters.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--muted)',
            background: 'var(--panel-2)',
            borderRadius: 6,
          }}
        >
          <p>No stuck batches.</p>
        </div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>#</th>
                <th>Table</th>
                <th>Site</th>
                <th style={{ width: 70 }}>Tries</th>
                <th>Last error</th>
                <th>Queued</th>
                <th style={{ width: 240 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {deadLetters.map((row) => {
                const isExpanded = expandedId === row.id;
                const isConfirmingDrop = confirmDropId === row.id;
                const isBusy = busyId === row.id;
                return (
                  <Fragment key={row.id}>
                  <tr data-testid={`dlq-row-${row.id}`}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {row.id}
                    </td>
                    <td>{batchLabel(row.table)}</td>
                    <td>{row.locationId}</td>
                    <td>{row.attempts}</td>
                    <td
                      style={{
                        fontSize: 12,
                        color: 'var(--red)',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={row.lastError || ''}
                    >
                      {previewError(row.lastError)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {formatTime(row.enqueuedAt)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : row.id)
                          }
                          aria-expanded={isExpanded}
                          aria-controls={`dlq-detail-${row.id}`}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? 'Hide' : 'Inspect'}
                        </button>
                        <button
                          type="button"
                          onClick={() => postAction(row.id, 'requeue')}
                          disabled={isBusy}
                          style={{
                            background: 'var(--accent)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 4,
                            padding: '4px 10px',
                            fontSize: 12,
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            opacity: isBusy ? 0.6 : 1,
                          }}
                        >
                          {isBusy ? 'Working…' : 'Requeue'}
                        </button>
                        {isConfirmingDrop ? (
                          <>
                            <button
                              type="button"
                              onClick={() => postAction(row.id, 'drop')}
                              disabled={isBusy}
                              style={{
                                background: 'var(--red)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 4,
                                padding: '4px 10px',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: isBusy ? 'not-allowed' : 'pointer',
                                opacity: isBusy ? 0.6 : 1,
                              }}
                            >
                              {isBusy ? 'Dropping…' : 'Yes, drop'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDropId(null)}
                              disabled={isBusy}
                              style={{
                                background: 'none',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                padding: '4px 10px',
                                fontSize: 12,
                                cursor: isBusy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Go back
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDropId(row.id)}
                            disabled={isBusy}
                            style={{
                              background: 'none',
                              border: '1px solid var(--red)',
                              color: 'var(--red)',
                              borderRadius: 4,
                              padding: '4px 10px',
                              fontSize: 12,
                              cursor: isBusy ? 'not-allowed' : 'pointer',
                              opacity: isBusy ? 0.6 : 1,
                            }}
                          >
                            Drop
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr
                      id={`dlq-detail-${row.id}`}
                      style={{ background: 'var(--panel-2)' }}
                    >
                      <td colSpan={7} style={{ padding: 12 }}>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <strong>Full last error:</strong>{' '}
                          <span style={{ color: 'var(--red)' }}>
                            {row.lastError || '—'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 6 }}>
                          <strong>Rows ({Array.isArray(row.rows) ? row.rows.length : 0}):</strong>
                        </div>
                        <pre
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            background: 'var(--bg)',
                            padding: 10,
                            borderRadius: 4,
                            margin: 0,
                            maxHeight: 320,
                            overflow: 'auto',
                          }}
                        >
                          {JSON.stringify(displayPayload(row.rows), null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Link href="/management" style={{ color: 'var(--accent)', fontSize: 13 }}>
          ← Back to management
        </Link>
      </div>
    </div>
  );
}
