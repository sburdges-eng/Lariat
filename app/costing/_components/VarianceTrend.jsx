// @ts-check
/** @typedef {import('../../../lib/varianceTrend.ts').VarianceTrend} VarianceTrend */
/** @typedef {import('../../../lib/varianceTrend.ts').VarianceTrendPoint} VarianceTrendPoint */

const COLOR = {
  green: 'var(--green, #2a8f3f)',
  yellow: 'var(--yellow, #b88300)',
  red: 'var(--red, #c00)',
};

/** @param {number | null | undefined} n */
function pct(n) {
  if (n === null || n === undefined) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/** @param {{ trend: VarianceTrend }} props */
export default function VarianceTrend({ trend }) {
  const { points, pCurrent, pAverage, windowDays, rowsFound } = trend;

  if (rowsFound === 0) {
    return (
      <section className="card" style={{ padding: 16 }}>
        <div className="row-meta" style={{ marginBottom: 8 }}>
          COGS variance · last {windowDays} days
        </div>
        <p className="row-meta" style={{ color: 'var(--amber, #8a5a00)' }}>
          No accounting_variance rows yet — run the compute engine to populate.
        </p>
      </section>
    );
  }

  const cellW = 14;
  const cellGap = 2;
  const maxCellH = 40;
  const numericPcts = points.map((p) => Math.abs(p.variancePct ?? 0));
  const peak = Math.max(...numericPcts, 1);
  const w = points.length * (cellW + cellGap);
  const h = maxCellH + 4;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row-meta" style={{ marginBottom: 8 }}>
        COGS variance · last {windowDays} days · {rowsFound}{' '}
        {rowsFound === 1 ? 'run' : 'runs'}
      </div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10 }}>
        <Stat label="current" value={pct(pCurrent)} />
        <Stat label="average" value={pct(pAverage)} />
      </div>
      <svg width={w} height={h} role="img" aria-label="variance sparkline">
        {points.map((p, i) => {
          const v = Math.abs(p.variancePct ?? 0);
          const cellH = peak > 0 ? Math.max(2, (v / peak) * maxCellH) : 2;
          const x = i * (cellW + cellGap);
          const y = h - cellH;
          return (
            <rect
              key={`${p.periodEnd}-${i}`}
              x={x}
              y={y}
              width={cellW}
              height={cellH}
              fill={COLOR[p.thresholdColor]}
            />
          );
        })}
      </svg>
      <p className="row-meta" style={{ marginTop: 10, fontSize: 12 }}>
        Green &lt; 2% · Yellow 2–5% · Red ≥ 5%
      </p>
    </section>
  );
}

/** @param {{ label: string, value: string }} props */
function Stat({ label, value }) {
  return (
    <div>
      <div className="row-meta">{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
