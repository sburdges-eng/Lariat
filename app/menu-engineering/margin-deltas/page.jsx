// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// /menu-engineering/margin-deltas — manager-facing view of dishes whose
// per-serving cost moved in the lookback window. Companion to
// /costing/price-shocks: that page surfaces vendor SKU moves; this one
// rolls them up to the dish level so a GM can see "which dishes got more
// expensive to plate this week" without reading the SKU detail.
//
// Server-rendered: no live mutation. Renders the result of
// listMarginDeltas() and groups each dish row alongside its top 3
// contributing vendor SKUs (from the helper's own ranking — we don't
// re-rank here).

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { listMarginDeltas } from '../../../lib/marginDeltas';

export const dynamic = 'force-dynamic';

const WINDOW_OPTIONS = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const MIN_PCT_OPTIONS = [2, 5, 10, 25];

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toFixed(4)}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function clampInt(s, dflt, min, max) {
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function clampNum(s, dflt, min, max) {
  const n = Number(s);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

export default function MarginDeltasPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const days = clampInt(searchParams?.days, 7, 1, 90);
  const minPct = clampNum(searchParams?.minPct, 5, 0, 1000);

  const db = getDb();
  const deltas = listMarginDeltas(db, {
    location_id: loc,
    windowDays: days,
    minPctMove: minPct,
    limit: 200,
  });

  // Decide which zero-state to show: missing snapshots, missing dish wiring,
  // or just nothing above the threshold.
  const totalHistory = db
    .prepare(`SELECT COUNT(*) AS c FROM vendor_prices_history WHERE location_id = ?`)
    .get(loc).c;
  const totalComponents = db
    .prepare(`SELECT COUNT(*) AS c FROM dish_components WHERE location_id = ?`)
    .get(loc).c;

  const locQ = (extra = {}) => {
    const params = new URLSearchParams();
    if (loc !== DEFAULT_LOCATION_ID) params.set('location', loc);
    if (extra.days !== undefined) params.set('days', String(extra.days));
    if (extra.minPct !== undefined) params.set('minPct', String(extra.minPct));
    const s = params.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div>
      <h1>Margin moves</h1>
      <p className="subtitle">
        Dishes whose per-serving cost changed in the last {days} day
        {days === 1 ? '' : 's'}. Threshold: {minPct}% move.
      </p>

      <div className="card form-row" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Window:</span>
        {WINDOW_OPTIONS.map((w) => (
          <Link
            key={w.days}
            href={`/menu-engineering/margin-deltas${locQ({ days: w.days, minPct })}`}
            className={w.days === days ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {w.label}
          </Link>
        ))}
      </div>

      <div className="card form-row" style={{ marginBottom: 16, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Threshold:</span>
        {MIN_PCT_OPTIONS.map((p) => (
          <Link
            key={p}
            href={`/menu-engineering/margin-deltas${locQ({ days, minPct: p })}`}
            className={p === minPct ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {p}%
          </Link>
        ))}
      </div>

      {deltas.length === 0 ? (
        <div className="empty" role="status">
          {totalHistory === 0
            ? 'No price history yet. Run npm run ingest:costing to capture a snapshot.'
            : totalComponents === 0
            ? 'No dishes wired up yet. Set per-serving qty in /menu-engineering.'
            : 'No dish margin moves above this threshold.'}
        </div>
      ) : (
        <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {deltas.map((d) => {
            const tone = d.direction === 'up' ? 'red' : 'green';
            return (
              <li
                key={d.dish_name}
                className="check-row"
                style={{
                  borderLeft: `3px solid var(--${tone})`,
                  paddingLeft: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ flex: '1 1 240px' }}>
                  <div className="check-name">
                    <Link href={`/menu-engineering${locQ()}`}>{d.dish_name}</Link>
                  </div>
                  <div className="meta">
                    {fmtPrice(d.baseline_cost)}{' '}
                    <time dateTime={d.baseline_at}>{fmtDate(d.baseline_at)}</time>
                    {' → '}
                    {fmtPrice(d.latest_cost)}{' '}
                    <time dateTime={d.latest_at}>{fmtDate(d.latest_at)}</time>
                    {d.top_contributors && d.top_contributors.length > 0 && (
                      <ul style={{ margin: '6px 0 0 0', padding: '0 0 0 16px', listStyle: 'disc', opacity: 0.85 }}>
                        {d.top_contributors.map((c) => (
                          <li key={`${c.vendor}|${c.sku}|${c.ingredient}`} style={{ fontSize: 13 }}>
                            {c.vendor} · {c.sku} · {c.ingredient}{' '}
                            <span
                              style={{
                                color: `var(--${c.contribution_pct >= 0 ? 'red' : 'green'})`,
                                fontWeight: 600,
                              }}
                            >
                              {fmtPct(c.contribution_pct)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: `var(--${tone})`,
                    minWidth: 80,
                    textAlign: 'right',
                  }}
                >
                  {fmtPct(d.delta_pct)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
