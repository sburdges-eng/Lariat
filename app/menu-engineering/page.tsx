import { computeMenuEngineering } from '../../lib/menuEngineering';
import { DEFAULT_LOCATION_ID } from '../../lib/location';

export const dynamic = 'force-dynamic';

const Q: Record<string, { label: string; desc: string; color: string }> = {
  star: { label: 'Star', desc: 'High margin & popularity', color: 'var(--green)' },
  plowhorse: { label: 'Plowhorse', desc: 'Low margin, high popularity', color: 'var(--yellow)' },
  puzzle: { label: 'Puzzle', desc: 'High margin, low popularity', color: 'var(--blue)' },
  dog: { label: 'Dog', desc: 'Low margin & popularity', color: 'var(--muted)' },
  unknown: { label: 'Unknown', desc: 'Need cost match', color: 'var(--border)' },
};

export interface MenuEngineeringRow {
  item_name: string;
  qty?: number;
  net_sales?: number;
  avg_price?: number;
  cost_per_unit?: number;
  margin_pct?: number;
  quadrant: string;
}

export interface MenuEngineeringData {
  rows: MenuEngineeringRow[];
  medianMargin: number;
  medianPop: number;
}

export default function MenuEngineeringPage({ searchParams }: { searchParams?: { location?: string } }) {
  const loc =
    typeof searchParams?.location === 'string' && searchParams.location.trim()
      ? searchParams.location.trim()
      : DEFAULT_LOCATION_ID;

  let data: MenuEngineeringData;
  try {
    data = computeMenuEngineering(loc) as MenuEngineeringData;
  } catch {
    data = { rows: [], medianMargin: 0, medianPop: 0.5 };
  }

  const { rows, medianMargin } = data;

  const hazards = rows.filter(r => r.quadrant === 'plowhorse' && r.margin_pct != null && r.margin_pct < 20.0);

  return (
    <div>
      <h1>Menu engineering</h1>
      <p className="subtitle">
        Joins imported <strong>Toast item sales</strong> with <strong>recipe cost</strong> (matched by normalized name). Quadrants use median margin split; popularity is share of max
        quantity.
      </p>

      {!rows.length && (
        <div className="card mb-20 border-yellow">
          Need both <code>npm run ingest:analytics</code> and <code>npm run ingest:costing</code>, with overlapping menu item / recipe names.
        </div>
      )}

      {hazards.length > 0 && (
        <div className="alert-banner">
          <div>
            <div className="alert-label">Critical Margin Hazards</div>
            <div className="alert-items">
              Warning: High-volume Plowhorses rendering below 20% margin. Consider catalog alternatives for these heavy movers.
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
              <th>Qty</th>
              <th>Net $</th>
              <th>Avg $</th>
              <th>Cost/u</th>
              <th>Margin %</th>
              <th>Quadrant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item_name}>
                <td>{r.item_name}</td>
                <td>{r.qty != null ? Number(r.qty).toFixed(0) : '—'}</td>
                <td>{r.net_sales != null ? `$${Number(r.net_sales).toFixed(2)}` : '—'}</td>
                <td>{r.avg_price != null ? `$${r.avg_price.toFixed(2)}` : '—'}</td>
                <td>{r.cost_per_unit != null ? `$${r.cost_per_unit.toFixed(2)}` : '—'}</td>
                <td className={r.margin_pct != null && r.margin_pct < 20 ? 'text-red font-bold' : ''}>
                  {r.margin_pct != null ? `${r.margin_pct.toFixed(1)}%` : '—'}
                </td>
                <td style={{ color: Q[r.quadrant]?.color || 'inherit' }}>{Q[r.quadrant]?.label || r.quadrant}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
