// @ts-check
// /costing/variance-attribution — "the variance moved, what did we
// change?" Server-rendered evidence board: baseline → current variance
// header plus one table per evidence section (price moves, dish
// composition edits, count corrections, unresolved depletions).
// Read-only; PIN-gated by middleware via the /costing/* prefix.

import Link from 'next/link';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  buildVarianceAttribution,
  listRecentVariancePeriods,
} from '../../../lib/varianceAttribution';

/** @typedef {Record<string, string | string[] | undefined>} PageSearchParams */
/** @typedef {import('../../../lib/varianceAttribution.ts').VariancePeriod} VariancePeriod */
/** @typedef {import('../../../lib/varianceAttribution.ts').CountCorrectionItem} CountCorrectionItem */

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Same buckets as the T9 dashboard / variance-trend tile (< 2 / 2–5 / >= 5).
/** @param {'green' | 'yellow' | 'red'} color */
function toneVar(color) {
  return `var(--${color})`;
}

/** @param {number | null | undefined} n */
function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}%`;
}

/** @param {number | null | undefined} n */
function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

/** @param {{ p: VariancePeriod | null, title: string }} props */
function PeriodBadge({ p, title }) {
  if (!p) return <span className="meta">{title}: —</span>;
  return (
    <span>
      <span className="meta">{title} ({p.period_end}): </span>
      <strong style={{ color: toneVar(p.threshold_color) }}>{fmtPct(p.variance_pct)}</strong>
      <span className="meta"> · {fmtMoney(p.variance_amount)}</span>
    </span>
  );
}

/** @param {{ title: string, sub: string, count: number, children: import('react').ReactNode }} props */
function Section({ title, sub, count, children }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginBottom: 4 }}>
        {title} <span className="meta">({count})</span>
      </h2>
      <div className="muted" style={{ marginBottom: 12 }}>{sub}</div>
      {children}
    </section>
  );
}

/** @param {CountCorrectionItem} row */
function describeCorrection(row) {
  if (row.kind === 'count_closed') {
    return `Count closed — ${row.label || row.count_date || `#${row.count_id}`} (${row.lines ?? 0} lines)`;
  }
  const what = row.entity === 'inventory_count_lines' ? 'count line' : 'count';
  const verb = row.transition || row.action || 'changed';
  const who = row.actor_cook_id ? ` by ${row.actor_cook_id}` : '';
  return `${what} ${verb}${who}`;
}

/** @param {{ searchParams: Promise<PageSearchParams> }} props */
export default async function VarianceAttributionPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  const from = typeof sp.from === 'string' && DATE_RE.test(sp.from) ? sp.from : undefined;
  const to = typeof sp.to === 'string' && DATE_RE.test(sp.to) ? sp.to : undefined;

  /** @type {{ from?: string, to?: string }} */
  const opts = {};
  if (from) opts.from = from;
  if (to) opts.to = to;
  const attr = buildVarianceAttribution(loc, opts);

  // Period picker: consecutive recent period pairs as window links.
  const recent = listRecentVariancePeriods(loc, 7);
  /** @type {{ from: string, to: string }[]} */
  const pairs = [];
  for (let i = 0; i + 1 < recent.length; i += 1) {
    const cur = recent[i];
    const prev = recent[i + 1];
    if (cur && prev) pairs.push({ from: prev.period_end, to: cur.period_end });
  }

  /** @param {{ from: string, to: string }} [win] */
  const linkQ = (win) => {
    const params = new URLSearchParams();
    if (loc !== DEFAULT_LOCATION_ID) params.set('location', loc);
    if (win) {
      params.set('from', win.from);
      params.set('to', win.to);
    }
    const s = params.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div>
      <h1>Variance attribution</h1>
      <p className="subtitle">The variance moved — what did we change?</p>

      {pairs.length > 0 ? (
        <div className="card form-row" style={{ marginBottom: 12, gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ opacity: 0.75, marginRight: 8 }}>Window:</span>
          <Link href={`/costing/variance-attribution${linkQ()}`} className={!from && !to ? 'btn primary' : 'btn'} style={{ textDecoration: 'none' }}>
            Latest
          </Link>
          {pairs.map((w) => (
            <Link
              key={`${w.from}-${w.to}`}
              href={`/costing/variance-attribution${linkQ(w)}`}
              className={w.from === attr.window.from && w.to === attr.window.to && (from || to) ? 'btn primary' : 'btn'}
              style={{ textDecoration: 'none' }}
            >
              {w.from} → {w.to}
            </Link>
          ))}
        </div>
      ) : null}

      {!attr.ok ? (
        <div className="empty" role="status">{attr.reason}</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <PeriodBadge p={attr.variance.baseline} title="Baseline" />
              <span className="meta">→</span>
              <PeriodBadge p={attr.variance.current} title="Current" />
              <span>
                <span className="meta">Move: </span>
                <strong>{fmtPct(attr.variance.delta_pct)}</strong>
                <span className="meta"> · {fmtMoney(attr.variance.delta_amount)}</span>
              </span>
            </div>
            <div className="meta" style={{ marginTop: 8 }}>{attr.caveat}</div>
            {attr.unattributed ? (
              <div className="meta" style={{ marginTop: 4 }}>
                No in-window evidence found — nothing in price history, dish components,
                count corrections, or unresolved depletions for this window.
              </div>
            ) : null}
          </div>

          <Section
            title="Price moves"
            sub={`Vendor unit prices that changed between ${attr.window.from} and ${attr.window.to}.`}
            count={attr.price_moves.count}
          >
            {attr.price_moves.items.length === 0 ? (
              <p>No vendor price moves inside this window.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Move</th>
                    <th scope="col">Price change</th>
                    <th scope="col">On menu</th>
                  </tr>
                </thead>
                <tbody>
                  {attr.price_moves.items.map((m) => (
                    <tr key={`${m.vendor}|${m.sku}|${m.ingredient}`}>
                      <td>
                        <strong>{m.ingredient}</strong>
                        <div className="meta">{m.vendor} · {m.sku}</div>
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtPct(m.pct_move)}</td>
                      <td className="meta">
                        {m.first_price ?? '—'} → {m.last_price ?? '—'} ({m.snapshots} snapshots)
                      </td>
                      <td className="meta">{m.linked_to_menu ? 'linked to a dish' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Dish composition changes"
            sub="dish_components rows created or edited inside the window."
            count={attr.composition_changes.count}
          >
            {attr.composition_changes.items.length === 0 ? (
              <p>No dish composition edits inside this window.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">Dish</th>
                    <th scope="col">Component</th>
                    <th scope="col">Change</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {attr.composition_changes.items.map((c, idx) => (
                    <tr key={`${c.dish_name}-${c.component}-${idx}`}>
                      <td><strong>{c.dish_name}</strong></td>
                      <td className="meta">{c.component} ({c.component_type})</td>
                      <td className="meta">{c.change_kind}</td>
                      <td className="meta">{c.changed_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Count corrections"
            sub="Inventory counts closed/reopened and count-line corrections inside the window."
            count={attr.count_corrections.count}
          >
            {attr.count_corrections.items.length === 0 ? (
              <p>No count activity inside this window.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {attr.count_corrections.items.map((row, idx) => (
                    <tr key={`${row.kind}-${row.at}-${idx}`}>
                      <td>{describeCorrection(row)}</td>
                      <td className="meta">{row.at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section
            title="Unresolved depletions"
            sub="Items sold with no dish_components link — sales the theoretical COGS never depleted."
            count={attr.unresolved_depletions.count}
          >
            {attr.unresolved_depletions.note ? (
              <p className="meta">{attr.unresolved_depletions.note}</p>
            ) : null}
            {attr.unresolved_depletions.items.length === 0 ? (
              <p>No unresolved sales lines inside this window.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Period</th>
                    <th scope="col">Qty sold</th>
                    <th scope="col">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {attr.unresolved_depletions.items.map((u, idx) => (
                    <tr key={`${u.item_name}-${u.period_label}-${idx}`}>
                      <td><strong>{u.item_name}</strong></td>
                      <td className="meta">{u.period_label || '—'}</td>
                      <td className="meta">{u.qty_sold ?? '—'}</td>
                      <td className="meta">{fmtMoney(u.net_sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
