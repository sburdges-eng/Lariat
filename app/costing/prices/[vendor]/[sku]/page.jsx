// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// /costing/prices/[vendor]/[sku] — single-SKU price history.
//
// Renders the full snapshot timeline as an SVG sparkline + table. The
// timeline data already has a JSON endpoint (/api/vendor-prices/history),
// but a dedicated page is easier to deep-link from /costing/price-shocks
// and from the future "this dish's cost moved" notification.
//
// Vendor and sku are URL-encoded by the caller — Next.js gives us the
// decoded value in params automatically.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '../../../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../../../lib/location';
import { listPriceSeries } from '../../../../../lib/vendorPricesRepo';
import { formatDollars } from '../../../../../lib/formatMoney';

export const dynamic = 'force-dynamic';

function fmtPrice(n) {
  return formatDollars(n, { decimals: 4 });
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function Sparkline({ series, width = 600, height = 140, padding = 16 }) {
  if (!series || series.length < 2) return null;
  const ys = series.map((p) => Number(p.unit_price));
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const points = series.map((_, i) => {
    const x = padding + (i / (series.length - 1)) * innerW;
    const y = padding + innerH - ((ys[i] - minY) / span) * innerH;
    return [x, y];
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const last = points[points.length - 1];
  const first = points[0];
  const direction = ys[ys.length - 1] >= ys[0] ? 'up' : 'down';
  const stroke = direction === 'up' ? 'var(--red, #ef4444)' : 'var(--green, #16a34a)';

  return (
    <svg
      role="img"
      aria-label="Price trend"
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', maxWidth: width, height: 'auto', display: 'block' }}
    >
      <line
        x1={padding} y1={padding + innerH} x2={padding + innerW} y2={padding + innerH}
        stroke="var(--border, #2a2a2a)" strokeWidth={1}
      />
      <path d={path} fill="none" stroke={stroke} strokeWidth={2} />
      <circle cx={first[0]} cy={first[1]} r={3} fill={stroke} />
      <circle cx={last[0]} cy={last[1]} r={4} fill={stroke} />
      <text
        x={padding} y={padding - 4}
        fontSize={11} fill="var(--muted, #888)"
      >
        {fmtPrice(maxY)}
      </text>
      <text
        x={padding} y={padding + innerH + 12}
        fontSize={11} fill="var(--muted, #888)"
      >
        {fmtPrice(minY)}
      </text>
    </svg>
  );
}

export default async function SkuHistoryPage({ params, searchParams }) {
  const p = (await params) || {};
  const sp = (await searchParams) || {};
  const vendor = (p.vendor || '').trim();
  const sku = (p.sku || '').trim();
  if (!vendor || !sku) return notFound();
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const db = getDb();
  const series = listPriceSeries(db, { vendor, sku, location_id: loc, limit: 500 });

  // Pull current vendor_prices row for the page subhead (ingredient name,
  // current pack info). If the SKU has been deleted from vendor_prices
  // but history persists, we still want the page to render.
  const current = db
    .prepare(
      `SELECT ingredient, category, pack_size, pack_unit, pack_price, unit_price
         FROM vendor_prices
        WHERE location_id = ? AND vendor = ? AND sku = ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(loc, vendor, sku);
  // Fall back to the most recent ingredient name from the history table
  // when the row no longer exists in vendor_prices (e.g. SKU dropped).
  const histIngredient = db
    .prepare(
      `SELECT ingredient FROM vendor_prices_history
        WHERE location_id = ? AND vendor = ? AND sku = ?
        ORDER BY snapshot_at DESC, id DESC LIMIT 1`,
    )
    .get(loc, vendor, sku)?.ingredient;
  const ingredient = current?.ingredient || histIngredient || sku;

  const first = series[0];
  const last = series[series.length - 1];
  const delta =
    series.length >= 2 && first?.unit_price > 0
      ? ((last.unit_price - first.unit_price) / first.unit_price) * 100
      : null;

  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  return (
    <div>
      <p style={{ marginBottom: 4, fontSize: 13, opacity: 0.75 }}>
        <Link href={`/costing/price-shocks${locQ}`}>← All price moves</Link>
      </p>
      <h1>{ingredient}</h1>
      <p className="subtitle">
        {vendor} · {sku}
        {current?.category && <> · {current.category}</>}
      </p>

      {series.length === 0 ? (
        <div className="empty" role="status">No history yet for this SKU.</div>
      ) : (
        <>
          <div className="card mb-20" style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
              <div>
                <div className="kpi-label">Current</div>
                <div className="kpi-value">{fmtPrice(last?.unit_price)}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  per {current?.pack_unit || last?.pack_unit || 'unit'}
                </div>
              </div>
              <div>
                <div className="kpi-label">Earliest</div>
                <div className="kpi-value">{fmtPrice(first?.unit_price)}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  <time dateTime={first?.snapshot_at}>{fmtDate(first?.snapshot_at)}</time>
                </div>
              </div>
              {delta != null && (
                <div>
                  <div className="kpi-label">Change</div>
                  <div
                    className="kpi-value"
                    style={{ color: delta > 0 ? 'var(--red)' : 'var(--green)' }}
                  >
                    {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {series.length} snapshots
                  </div>
                </div>
              )}
            </div>
            <Sparkline series={series} />
          </div>

          <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>Snapshots</h2>
          <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...series].reverse().map((s, i) => (
              <li key={`${s.snapshot_at}-${i}`} className="check-row">
                <div>
                  <div className="check-name">{fmtPrice(s.unit_price)}</div>
                  <div className="meta">
                    <time dateTime={s.snapshot_at}>{fmtDate(s.snapshot_at)}</time>
                    {' · pack '}
                    {s.pack_size != null ? `${s.pack_size} ${s.pack_unit || ''}` : '—'}
                    {' · '}
                    {fmtPrice(s.pack_price)}/pack
                    {s.run_id != null && <> · run #{s.run_id}</>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
