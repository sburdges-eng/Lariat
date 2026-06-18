// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// /costing/pack-changes — operator triage queue for vendor pack-size flips.
//
// During scripts/ingest-costing.mjs (T6), any vendor SKU whose pack_size
// or pack_unit changes versus the latest prior catalog row gets a
// pack_size_changes audit row and the new vendor_prices row is flagged
// `map_status='PACK_CHANGED'`. The /costing dashboard surfaces the
// unacknowledged count; this page is the per-row detail view + the
// acknowledgement surface.
//
// Server-rendered. Acknowledgement is a tiny client-side fetch handled
// in AckButton.jsx — kept narrow because the rest of the page should
// reload after ack to refresh the list.

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { listPackChanges, unacknowledgedCount } from '../../../lib/packChangesRepo';
import { formatDollars } from '../../../lib/formatMoney';
import AckButton from './AckButton.jsx';

export const dynamic = 'force-dynamic';

const FILTER_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'all', label: 'All' },
];

function fmtPrice(n) {
  return formatDollars(n);
}

function fmtPct(p) {
  if (p == null || !Number.isFinite(Number(p))) return '—';
  const v = Number(p) * 100;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default async function PackChangesPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const filterRaw =
    typeof sp?.filter === 'string' ? sp.filter : 'open';
  const filter = FILTER_OPTIONS.some((o) => o.value === filterRaw)
    ? filterRaw
    : 'open';
  const vendorFilter =
    typeof sp?.vendor === 'string' && sp.vendor.trim()
      ? sp.vendor.trim()
      : null;

  const db = getDb();
  const changes = listPackChanges(db, {
    filter,
    vendor: vendorFilter,
    limit: 200,
  });
  const counts = unacknowledgedCount(db);

  return (
    <div>
      <h1>Pack-size changes</h1>
      <p className="subtitle">
        Vendor items where the pack size or unit changed since the last cost pull.
        Each one sticks until you give it the OK. {counts.total} open.
      </p>

      <div className="card form-row" style={{ marginBottom: 16, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Show:</span>
        {FILTER_OPTIONS.map((o) => {
          const params = new URLSearchParams();
          if (o.value !== 'open') params.set('filter', o.value);
          if (vendorFilter) params.set('vendor', vendorFilter);
          const qs = params.toString();
          return (
            <Link
              key={o.value}
              href={`/costing/pack-changes${qs ? `?${qs}` : ''}`}
              className={o.value === filter ? 'btn primary' : 'btn'}
              style={{ textDecoration: 'none' }}
            >
              {o.label}
            </Link>
          );
        })}
      </div>

      {vendorFilter ? (
        <div className="card form-row" style={{ marginBottom: 16, gap: 8, alignItems: 'center' }}>
          <span style={{ opacity: 0.75 }}>Vendor:</span>
          <code>{vendorFilter}</code>
          <Link
            href={`/costing/pack-changes${filter !== 'open' ? `?filter=${filter}` : ''}`}
            className="btn"
            style={{ textDecoration: 'none', marginLeft: 8 }}
          >
            Clear
          </Link>
        </div>
      ) : null}

      {changes.length === 0 ? (
        <div className="empty" role="status">
          {filter === 'open'
            ? 'No open pack-size changes. Costing ingest will surface new ones here.'
            : 'No matching pack-size change rows.'}
        </div>
      ) : (
        <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {changes.map((c) => {
            const tone = c.acknowledged ? 'green' : 'yellow';
            return (
              <li
                key={c.id}
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
                    <Link
                      href={`/costing/prices/${encodeURIComponent(c.vendor)}/${encodeURIComponent(c.sku)}`}
                    >
                      {c.ingredient ?? <em>(SKU not in current vendor_prices)</em>}
                    </Link>
                    <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 13 }}>
                      {c.vendor} · {c.sku}
                    </span>
                  </div>
                  <div className="meta">
                    Pack: <code>{c.prev_pack ?? '—'}</code> →{' '}
                    <code>{c.new_pack ?? '—'}</code>
                    <br />
                    Price: {fmtPrice(c.prev_price)} → {fmtPrice(c.new_price)}
                    {c.price_delta_pct != null ? (
                      <span
                        style={{
                          marginLeft: 8,
                          color: c.price_delta_pct >= 0 ? 'var(--red)' : 'var(--green)',
                          fontWeight: 600,
                        }}
                      >
                        ({fmtPct(c.price_delta_pct)})
                      </span>
                    ) : null}
                    <br />
                    Detected{' '}
                    <time dateTime={c.detected_at}>{fmtDate(c.detected_at)}</time>
                    {c.acknowledged ? <em style={{ marginLeft: 8 }}> · acknowledged</em> : null}
                  </div>
                </div>
                {!c.acknowledged ? (
                  <AckButton id={c.id} />
                ) : (
                  <span style={{ opacity: 0.5, fontSize: 13 }}>✓ resolved</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
