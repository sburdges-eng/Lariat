// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';

function fmtUSD(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtCompactUSD(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${mo[+m - 1]} ${+d}`;
}

function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function DailyRevenue({ rows }) {
  if (!rows.length) {
    return (
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Daily revenue</h2>
        <p className="meta">No sales data yet.</p>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => Number(r.net_sales || 0)), 1);
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Daily revenue</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.slice(-14).map((r) => {
          const pct = Math.max(2, (Number(r.net_sales || 0) / max) * 100);
          return (
            <div
              key={r.shift_date}
              style={{
                display: 'grid',
                gridTemplateColumns: '76px minmax(120px, 1fr) 86px',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span className="meta">{fmtDate(r.shift_date)}</span>
              <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
              <strong style={{ textAlign: 'right' }}>{fmtCompactUSD(r.net_sales)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopItems({ rows }) {
  if (!rows.length) {
    return (
      <div className="card">
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Top sellers</h2>
        <p className="meta">No item sales yet.</p>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => Number(r.rev || 0)), 1);
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Top sellers</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Net</th>
            <th aria-label="share" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item_name}>
              <td>{r.item_name}</td>
              <td style={{ textAlign: 'right' }}>{fmtNum(r.qty)}</td>
              <td style={{ textAlign: 'right' }}>{fmtUSD(r.rev)}</td>
              <td style={{ minWidth: 96 }}>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(Number(r.rev || 0) / max) * 100}%`,
                      height: '100%',
                      background: 'var(--accent)',
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spend({ rows }) {
  if (!rows.length) return null;
  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Monthly Shamrock spend</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <div key={r.month} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{r.month}</span>
            <strong>{fmtUSD(r.shamrock_total_spend)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function RevenueByDay({ current, prior }) {
  if (!current.length) return null;
  const priorByDay = new Map(prior.map((r) => [r.day_of_week, r]));
  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Revenue by day</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {current.map((r) => {
          const p = priorByDay.get(r.day_of_week);
          return (
            <div key={r.day_of_week} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{r.day_of_week}</span>
              <span>
                <strong>{fmtCompactUSD(r.net_sales)}</strong>
                {p && <span className="meta"> · prior {fmtCompactUSD(p.net_sales)}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hourly({ current, prior }) {
  if (!current.length) return null;
  const priorByHour = new Map(prior.map((r) => [r.hour_24, r]));
  return (
    <div className="card">
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Hourly revenue</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {current.filter((r) => Number(r.net_sales || 0) > 500).map((r) => {
          const p = priorByHour.get(r.hour_24);
          return (
            <div key={r.hour_24} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>{r.label || `${r.hour_24}:00`}</span>
              <span>
                <strong>{fmtCompactUSD(r.net_sales)}</strong>
                {p && <span className="meta"> · prior {fmtCompactUSD(p.net_sales)}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyticsCharts({
  daily,
  dowCurrent,
  dowPrior,
  hourlyCurrent,
  hourlyPrior,
  spend,
  top,
}) {
  return (
    <>
      <DailyRevenue rows={daily} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24, marginBottom: 24 }}>
        <RevenueByDay current={dowCurrent} prior={dowPrior} />
        <Hourly current={hourlyCurrent} prior={hourlyPrior} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        <Spend rows={spend} />
        <TopItems rows={top} />
      </div>
    </>
  );
}
