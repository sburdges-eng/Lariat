// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// /costing/depletion-exceptions — operator triage queue for Toast sales
// lines that can't auto-deplete inventory.
//
// The auto-depletion path (lib/salesDepletion.ts → applyDepletionsForPeriod)
// runs from the analytics ingest. Lines that don't resolve are counted
// (sales_depletion_runs.unresolved_dish_count) but the dish names aren't
// persisted — this page recomputes the queue on demand by replaying the
// resolver against current sales_lines + dish_components for the
// location.
//
// Server-rendered, read-only. The fix-it link sends operators to the
// dish-components editor; once they map a dish, it disappears from the
// queue automatically on the next page load.

import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { formatDollars } from '../../../lib/formatMoney';
import {
  listDepletionExceptions,
  REASON_LABELS,
} from '../../../lib/depletionExceptions';

export const dynamic = 'force-dynamic';

function fmtCurrency(n) {
  return formatDollars(n);
}

function fmtQty(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function reasonTone(reason) {
  // Tone matches the operator's likely effort to fix:
  //  red = blocking the dish entirely (no_dish_components, invalid_qty)
  //  yellow = recipe-side data gap (recipe_missing_yield, unknown_unit)
  //  blue = needs a density to convert volume↔weight
  if (reason === 'no_dish_components' || reason === 'invalid_qty') return 'red';
  if (reason === 'cross_dim_unit_mismatch') return 'blue';
  return 'yellow';
}

export default async function DepletionExceptionsPage({ searchParams }) {
  const sp = (await searchParams) || {};

  const loc =
    typeof sp?.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const periodFilter =
    typeof sp?.period === 'string' && sp.period.trim()
      ? sp.period.trim()
      : null;

  const db = getDb();
  const exceptions = listDepletionExceptions(db, {
    location_id: loc,
    period_label: periodFilter,
    limit: 200,
  });

  const totalSalesRows = db
    .prepare(`SELECT COUNT(*) AS c FROM sales_lines WHERE location_id = ?`)
    .get(loc).c;

  const locQ = (extra = {}) => {
    const params = new URLSearchParams();
    if (loc !== DEFAULT_LOCATION_ID) params.set('location', loc);
    if (extra.period !== undefined) {
      if (extra.period) params.set('period', extra.period);
    } else if (periodFilter) {
      params.set('period', periodFilter);
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div>
      <h1>Depletion exceptions</h1>
      <p className="subtitle">
        Sales whose dish didn&rsquo;t pull from inventory. Add the dish&rsquo;s
        ingredients in <Link href="/menu-engineering/components">what&rsquo;s in dishes</Link>{' '}
        and it drops off this list after the next reload.
      </p>

      {periodFilter ? (
        <div className="card form-row" style={{ marginBottom: 16, gap: 8, alignItems: 'center' }}>
          <span style={{ opacity: 0.75 }}>Filtered to period:</span>
          <code>{periodFilter}</code>
          <Link
            href={`/costing/depletion-exceptions${locQ({ period: '' })}`}
            className="btn"
            style={{ textDecoration: 'none', marginLeft: 8 }}
          >
            Clear filter
          </Link>
        </div>
      ) : null}

      {exceptions.length === 0 ? (
        <div className="empty" role="status">
          {totalSalesRows === 0
            ? 'No Toast sales ingested yet for this location. Run npm run ingest:analytics.'
            : 'Every dish currently sold maps cleanly to dish_components. Nothing to triage.'}
        </div>
      ) : (
        <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {exceptions.map((e) => {
            const tone = reasonTone(e.reason);
            return (
              <li
                key={e.dish_name}
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
                      href={`/menu-engineering/components?dish=${encodeURIComponent(e.dish_name)}${
                        loc !== DEFAULT_LOCATION_ID ? `&location=${encodeURIComponent(loc)}` : ''
                      }`}
                    >
                      {e.dish_name}
                    </Link>
                  </div>
                  <div className="meta">
                    <span style={{ color: `var(--${tone})` }}>
                      {REASON_LABELS[e.reason]}
                    </span>
                    {e.detail ? (
                      <>
                        {' · '}
                        <code style={{ fontSize: 12 }}>{e.detail}</code>
                      </>
                    ) : null}
                    <br />
                    {e.affected_sales_count} sales row{e.affected_sales_count === 1 ? '' : 's'}
                    {' · '}
                    {fmtQty(e.total_quantity_sold)} sold
                    {' · '}
                    {fmtCurrency(e.total_net_sales)} net
                    {e.latest_imported_at ? (
                      <>
                        {' · last seen '}
                        <time dateTime={e.latest_imported_at}>
                          {fmtDate(e.latest_imported_at)}
                        </time>
                      </>
                    ) : null}
                    {e.sample_period_labels.length > 0 ? (
                      <>
                        <br />
                        Periods:{' '}
                        {e.sample_period_labels.map((p, i) => (
                          <span key={p}>
                            <Link
                              href={`/costing/depletion-exceptions${locQ({ period: p })}`}
                            >
                              <code style={{ fontSize: 12 }}>{p}</code>
                            </Link>
                            {i < e.sample_period_labels.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </>
                    ) : null}
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
                  {fmtCurrency(e.total_net_sales)}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
