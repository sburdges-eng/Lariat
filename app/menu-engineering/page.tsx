import Link from 'next/link';
import { computeMenuEngineering } from '../../lib/menuEngineering';
import type { MenuEngineeringRow } from '../../lib/menuEngineering';
import { computeDishCoverage } from '../../lib/dishCostBridge';
import { DEFAULT_LOCATION_ID } from '../../lib/location';
import { getDb } from '../../lib/db';
import { getPrepMedianForItems } from '../../lib/beoPrepHistory';

export const dynamic = 'force-dynamic';

const Q: Record<string, { label: string; desc: string; color: string }> = {
  star:      { label: 'Star',      desc: 'High margin & popularity. Protect availability — never 86 a star.', color: 'var(--green)' },
  plowhorse: { label: 'Plowhorse', desc: 'Low margin, high popularity. Reprice or sub a cheaper component before margin drift sinks the night.', color: 'var(--yellow)' },
  puzzle:    { label: 'Puzzle',    desc: 'High margin, low popularity. Push it on specials boards — the room does not know it exists.', color: 'var(--blue)' },
  dog:       { label: 'Dog',       desc: 'Low margin & popularity. Cut from the menu unless it anchors a category.', color: 'var(--muted)' },
  unknown:   { label: 'Unknown',   desc: 'Need cost data — wire dish_components first.', color: 'var(--border)' },
};

const LINK_BADGE: Record<MenuEngineeringRow['link_state'], { label: string; color: string }> = {
  fully_linked:  { label: 'linked',           color: 'var(--green)' },
  partial:       { label: 'partial',          color: 'var(--yellow)' },
  declared_only: { label: 'no qty entered',   color: 'var(--yellow)' },
  unlinked:      { label: 'no recipe link',   color: 'var(--red)' },
};

export default function MenuEngineeringPage({ searchParams }: { searchParams?: { location?: string } }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;
  const locQ = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';

  let data;
  try {
    data = computeMenuEngineering(loc);
  } catch (err) {
    console.error('menu-engineering compute failed:', err);
    data = {
      rows: [],
      medianMargin: 0,
      medianPop: 0.5,
      coverage: { fully_linked: 0, partial: 0, declared_only: 0, unlinked: 0, total: 0 },
    };
  }

  const { rows, medianMargin, coverage } = data;
  const coverageReport = computeDishCoverage(loc);

  // Sort: linked rows first by net sales desc, unlinked at the bottom.
  rows.sort((a, b) => {
    if (a.link_state === 'unlinked' && b.link_state !== 'unlinked') return 1;
    if (b.link_state === 'unlinked' && a.link_state !== 'unlinked') return -1;
    return (b.net_sales || 0) - (a.net_sales || 0);
  });

  const hazards = rows.filter(
    (r) => r.quadrant === 'plowhorse' && r.margin_pct != null && r.margin_pct < 20.0,
  );

  // Past-prep medians from beo_prep_history — second-opinion baseline next
  // to sales qty. Exact case-insensitive match on item_name; misses where
  // BEO sheet typo'd a different name (no fuzzy here — this column needs
  // to be precise to be useful as a planning number).
  let prepMedians: ReturnType<typeof getPrepMedianForItems> = new Map();
  try {
    prepMedians = getPrepMedianForItems(
      getDb(),
      loc,
      rows.map((r) => r.item_name).filter((n): n is string => typeof n === 'string'),
    );
  } catch (err) {
    console.error('menu-engineering prep-median compute failed:', err);
  }

  return (
    <div>
      <h1>Menu engineering</h1>
      <p className="subtitle">
        Per-dish cost from <strong>dish_components</strong> rows × <strong>recipe_costs</strong>.
        Margin = (avg sale price − per-serving cost) / avg sale price.
        Quadrants split on median margin and popularity (share of max qty).
        <br />
        {(() => {
          const v = getDb()
            .prepare(
              'SELECT snapshot_at FROM margin_snapshots WHERE location_id = ? ORDER BY id DESC LIMIT 1',
            )
            .get(loc) as { snapshot_at: string } | undefined;
          return v ? (
            <span style={{ color: 'var(--accent)' }}>
              Compute Engine Last Ran: {v.snapshot_at}
            </span>
          ) : null;
        })()}
      </p>

      {/* ── Coverage banner ─────────────────────────────────────── */}
      <div
        className="card mb-20"
        style={{ borderColor: coverage.unlinked > coverage.fully_linked ? 'var(--red)' : 'var(--border)' }}
      >
        <div className="meta" style={{ marginBottom: 8 }}>
          <strong>Bridge coverage:</strong>{' '}
          {coverage.fully_linked} fully linked · {coverage.partial} partial ·{' '}
          {coverage.declared_only} no qty · {coverage.unlinked} no recipe link
          {' '}
          <span style={{ opacity: 0.7 }}>({coverage.total} dishes total)</span>
        </div>
        {(coverage.declared_only > 0 || coverage.unlinked > 0) && (
          <div className="meta">
            <Link href={`/menu-engineering/components${locQ}`} style={{ color: 'var(--blue)' }}>
              → Open the dish-components editor to fill in per-serving quantities
            </Link>
          </div>
        )}
      </div>

      {/* ── Top unlinked dishes call-out (biggest revenue first) ── */}
      {coverageReport.unlinked_dishes.length > 0 && (
        <div className="card mb-20 border-yellow">
          <div className="alert-label">No recipe link — biggest revenue gaps</div>
          <p className="meta" style={{ margin: '4px 0 8px' }}>
            These dishes appear in sales but no recipe declares them in
            <code> menu_items[]</code>. Add the recipe → dish link in
            <code> data/cache/recipes.json</code>, OR add a dish_components row directly.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {coverageReport.unlinked_dishes.slice(0, 10).map((d) => (
              <li key={d.item_name} className="meta">
                <strong>{d.item_name}</strong> — ${d.net_sales.toFixed(0)} ({d.qty.toFixed(0)} sold)
              </li>
            ))}
            {coverageReport.unlinked_dishes.length > 10 && (
              <li className="meta" style={{ opacity: 0.7 }}>
                + {coverageReport.unlinked_dishes.length - 10} more
              </li>
            )}
          </ul>
        </div>
      )}

      {hazards.length > 0 && (
        <div className="alert-banner">
          <div>
            <div className="alert-label">Critical Margin Hazards</div>
            <div className="alert-items">
              High-volume Plowhorses below 20% margin. Consider catalog alternatives for these heavy movers.
            </div>
          </div>
          <div className="stack">
            {hazards.map((h) => (
              <span key={h.item_name} className="meta font-bold">
                {h.item_name} ({h.margin_pct?.toFixed(1)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card mb-20">
        <div className="meta">
          Median margin (matched items): {medianMargin != null ? `${medianMargin.toFixed(1)}%` : '—'}
        </div>
        <div className="flex-center-gap mt-12">
          {Object.entries(Q).map(([k, v]) => (
            <span key={k} style={{ fontSize: 13 }}>
              <span className="font-bold" style={{ color: v.color }}>{v.label}</span> — {v.desc}
            </span>
          ))}
        </div>
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Bridge</th>
              <th>Qty</th>
              <th title="Typical amount prepped at past events.">Prep median</th>
              <th>Net $</th>
              <th>Avg $</th>
              <th>Cost/u</th>
              <th>Margin %</th>
              <th>Quadrant</th>
              <th>Components</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const badge = LINK_BADGE[r.link_state];
              return (
                <tr key={r.item_name}>
                  <td>{r.item_name}</td>
                  <td>
                    <span className="font-bold" style={{ color: badge.color, fontSize: 12 }}>
                      {badge.label}
                    </span>
                  </td>
                  <td>{r.qty != null ? Number(r.qty).toFixed(0) : '—'}</td>
                  <td>
                    {(() => {
                      // Match the helper's key shape: trim() THEN toLowerCase().
                      // A Toast item with stray whitespace would otherwise miss
                      // even when matching prep history exists for it.
                      const key = typeof r.item_name === 'string'
                        ? r.item_name.trim().toLowerCase()
                        : null;
                      const m = key ? prepMedians.get(key) : undefined;
                      if (!m) return <span style={{ color: 'var(--muted)' }}>—</span>;
                      return (
                        <span title={`${m.samples} event${m.samples === 1 ? '' : 's'} contributed`}>
                          {m.median.toFixed(0)}
                          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 4 }}>
                            ({m.samples})
                          </span>
                        </span>
                      );
                    })()}
                  </td>
                  <td>{r.net_sales != null ? `$${Number(r.net_sales).toFixed(2)}` : '—'}</td>
                  <td>{r.avg_price != null ? `$${r.avg_price.toFixed(2)}` : '—'}</td>
                  <td>{r.cost_per_unit != null ? `$${r.cost_per_unit.toFixed(2)}` : '—'}</td>
                  <td className={r.margin_pct != null && r.margin_pct < 20 ? 'text-red font-bold' : ''}>
                    {r.margin_pct != null ? `${r.margin_pct.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ color: Q[r.quadrant || 'unknown']?.color || 'inherit' }}>
                    {Q[r.quadrant || 'unknown']?.label || r.quadrant}
                  </td>
                  <td style={{ fontSize: 12, opacity: 0.85 }}>
                    {r.components.length === 0
                      ? '—'
                      : r.components.map((c) => {
                          const key =
                            c.component_type === 'recipe'
                              ? `r:${c.recipe_slug}`
                              : `v:${c.vendor_ingredient}`;
                          return (
                            <div key={key}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: c.component_type === 'vendor_item' ? 'var(--blue)' : 'var(--green)',
                                  marginRight: 4,
                                }}
                              >
                                {c.component_type === 'vendor_item' ? 'D' : 'R'}
                              </span>
                              {c.display_name}
                              {c.qty_per_serving != null && c.unit
                                ? ` · ${c.qty_per_serving} ${c.unit}`
                                : ' · (no qty)'}
                              {c.per_serving_cost != null && (
                                <span style={{ color: 'var(--muted)' }}>
                                  {' '}= ${c.per_serving_cost.toFixed(2)}
                                </span>
                              )}
                              {c.status !== 'ok' && c.status !== 'no_dish_component' && (
                                <span style={{ color: 'var(--red)' }}> [{c.status}]</span>
                              )}
                            </div>
                          );
                        })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
