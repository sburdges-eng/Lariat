// /costing/price-shocks — manager-facing view of vendor SKUs that moved
// in price recently, with the dishes they touch.
//
// Server-rendered: no live mutation. The page renders the result of
// listPriceShocks() and joins each shock's ingredient against
// dish_components to surface "this price move affects N dishes". The
// dish join is an exact-match on vendor_ingredient (with fallback to
// recipe-side bom_lines.vendor_ingredient when present) — there's no
// fuzzy matching here because mismatches between catalog spelling and
// dish_components spelling are a real signal that the bridge is
// incomplete and the operator should see the gap.

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { formatDollars } from '../../../lib/formatMoney';
import { listPriceShocks } from '../../../lib/vendorPricesRepo';
import { affectedDishes, affectedRecipes } from '../../../lib/priceShockImpact';

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
  return formatDollars(n, { decimals: 4 });
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

export default function PriceShocksPage({ searchParams }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const days = clampInt(searchParams?.days, 7, 1, 90);
  const minPct = clampNum(searchParams?.minPct, 5, 0, 1000);

  const db = getDb();
  const shocks = listPriceShocks(db, {
    location_id: loc,
    windowDays: days,
    minPctMove: minPct,
    limit: 200,
  });

  const ingredients = [...new Set(shocks.map((s) => s.ingredient))];
  const dishes = affectedDishes(db, loc, ingredients);
  const recipes = affectedRecipes(db, loc, ingredients);

  // Whether vendor_prices_history has any rows — we tell the operator
  // when a zero-state is "no movement" vs "no data ingested yet".
  const totalHistory = db
    .prepare(`SELECT COUNT(*) AS c FROM vendor_prices_history WHERE location_id = ?`)
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
      <h1>Price moves</h1>
      <p className="subtitle">
        Vendor SKUs that changed price in the last {days} day{days === 1 ? '' : 's'}.
        Threshold: {minPct}% move.
      </p>

      <div className="card form-row" style={{ marginBottom: 12, gap: 8, alignItems: 'center' }}>
        <span style={{ opacity: 0.75, marginRight: 8 }}>Window:</span>
        {WINDOW_OPTIONS.map((w) => (
          <Link
            key={w.days}
            href={`/costing/price-shocks${locQ({ days: w.days, minPct })}`}
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
            href={`/costing/price-shocks${locQ({ days, minPct: p })}`}
            className={p === minPct ? 'btn primary' : 'btn'}
            style={{ textDecoration: 'none' }}
          >
            {p}%
          </Link>
        ))}
      </div>

      {shocks.length === 0 ? (
        <div className="empty" role="status">
          {totalHistory === 0
            ? 'No price history yet. Run npm run ingest:costing to capture a snapshot.'
            : 'No vendor price moves above this threshold in the window.'}
        </div>
      ) : (
        <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shocks.map((s) => {
            const tone = s.direction === 'up' ? 'red' : 'green';
            const dishHits = dishes.get(s.ingredient) || [];
            const recipeHits = recipes.get(s.ingredient) || [];
            return (
              <li
                key={`${s.vendor}|${s.sku}|${s.ingredient}`}
                className="check-row"
                style={{
                  borderLeft: `3px solid var(--${tone === 'red' ? 'red' : 'green'})`,
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
                      href={`/costing/prices/${encodeURIComponent(s.vendor)}/${encodeURIComponent(s.sku)}${locQ()}`}
                    >
                      {s.ingredient}
                    </Link>
                    <span style={{ marginLeft: 8, opacity: 0.7, fontSize: 13 }}>
                      {s.vendor} · {s.sku}
                    </span>
                  </div>
                  <div className="meta">
                    {fmtPrice(s.baseline_unit_price)}{' '}
                    <time dateTime={s.baseline_at}>{fmtDate(s.baseline_at)}</time>
                    {' → '}
                    {fmtPrice(s.latest_unit_price)}{' '}
                    <time dateTime={s.latest_at}>{fmtDate(s.latest_at)}</time>
                    {dishHits.length > 0 && (
                      <>
                        <br />
                        Affects: {dishHits.slice(0, 5).join(', ')}
                        {dishHits.length > 5 && ` and ${dishHits.length - 5} more`}
                      </>
                    )}
                    {dishHits.length === 0 && recipeHits.length > 0 && (
                      <>
                        <br />
                        In recipe{recipeHits.length === 1 ? '' : 's'}:{' '}
                        {recipeHits.slice(0, 3).join(', ')}
                        {recipeHits.length > 3 && ` and ${recipeHits.length - 3} more`}
                      </>
                    )}
                    {dishHits.length === 0 && recipeHits.length === 0 && (
                      <>
                        <br />
                        <em>Not currently used in any costed recipe or dish.</em>
                      </>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: `var(--${tone === 'red' ? 'red' : 'green'})`,
                    minWidth: 80,
                    textAlign: 'right',
                  }}
                >
                  {fmtPct(s.delta_pct)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
