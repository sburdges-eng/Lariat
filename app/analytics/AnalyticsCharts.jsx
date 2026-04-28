'use client';
import { useState } from 'react';

/* ── palette (mirrors CSS custom props for SVG) ──────────────────── */
const C = {
  ember: '#c85a2a', emberDeep: '#9a3f1a',
  ink: '#1d1a15', ink2: '#2b2723', char: '#3a3530',
  hair: '#c9bda5', muted: '#7b7268',
  cream: '#f8f3e7', bone: '#f3ece0', paper: '#ece2cf',
  sage: '#5d7a66', brass: '#b8892f', rust: '#8b2e1f',
};

/* ── formatters ──────────────────────────────────────────────────── */
function fmtUSD(n) {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtK(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${mo[+m - 1]} ${+d}`;
}
function fmtNum(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/* ── tooltip shell ───────────────────────────────────────────────── */
function Tip({ children, style }) {
  return (
    <div style={{
      position: 'absolute', pointerEvents: 'none', zIndex: 10,
      background: C.ink, color: C.cream, padding: '8px 14px', borderRadius: 6,
      fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
      whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(29,26,21,.3)',
      ...style,
    }}>
      {children}
    </div>
  );
}

/* ── section label ───────────────────────────────────────────────── */
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, color: C.muted, textTransform: 'uppercase',
      letterSpacing: '.2em', fontWeight: 700, marginBottom: 14,
    }}>
      {children}
    </div>
  );
}

/* ================================================================
   DAILY REVENUE — area chart (last N active days)
   ================================================================ */
function DailyArea({ data }) {
  const [hov, setHov] = useState(null);
  if (!data.length) return null;

  const W = 800, H = 200;
  const p = { l: 58, r: 16, t: 16, b: 32 };
  const cw = W - p.l - p.r, ch = H - p.t - p.b;

  const max = Math.max(...data.map(d => d.net_sales || 0));
  const yMax = Math.ceil(max / 2000) * 2000 || 2000;
  const sx = i => p.l + (i / Math.max(data.length - 1, 1)) * cw;
  const sy = v => p.t + ch - ((v || 0) / yMax) * ch;

  const pts = data.map((d, i) => `${sx(i).toFixed(1)},${sy(d.net_sales).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `M${p.l},${sy(0)} L${pts.join('L')} L${sx(data.length - 1)},${sy(0)} Z`;

  const yTicks = Array.from({ length: 5 }, (_, i) => (yMax / 4) * i);
  const xStep = Math.max(1, Math.floor(data.length / 6));
  const xIdxs = [];
  for (let i = 0; i < data.length; i += xStep) xIdxs.push(i);
  if (xIdxs[xIdxs.length - 1] !== data.length - 1) xIdxs.push(data.length - 1);

  const hd = hov != null ? data[hov] : null;
  const bw = cw / data.length;

  return (
    <div style={{ position: 'relative', marginBottom: 36 }}>
      <SectionLabel>Daily revenue — last {data.length} trading days</SectionLabel>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
           preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.ember} stopOpacity=".22" />
            <stop offset="100%" stopColor={C.ember} stopOpacity=".02" />
          </linearGradient>
        </defs>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={p.l} x2={W - p.r} y1={sy(v)} y2={sy(v)}
                  stroke={C.hair} strokeWidth=".5" strokeDasharray="3,3" />
            <text x={p.l - 6} y={sy(v) + 3.5} textAnchor="end"
                  fill={C.muted} fontSize="9" fontFamily="'JetBrains Mono',monospace">
              {fmtK(v)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#ag)" />
        <path d={line} fill="none" stroke={C.ember} strokeWidth="1.8" strokeLinejoin="round" />
        {xIdxs.map(i => (
          <text key={i} x={sx(i)} y={H - 6} textAnchor="middle"
                fill={C.muted} fontSize="9" fontFamily="'JetBrains Mono',monospace">
            {fmtDate(data[i].shift_date)}
          </text>
        ))}
        {data.map((_, i) => (
          <rect key={i} x={sx(i) - bw / 2} y={p.t} width={bw} height={ch}
                fill="transparent" onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
        ))}
        {hov != null && (
          <>
            <line x1={sx(hov)} x2={sx(hov)} y1={p.t} y2={p.t + ch}
                  stroke={C.ember} strokeWidth="1" strokeDasharray="4,3" />
            <circle cx={sx(hov)} cy={sy(data[hov].net_sales)} r="4"
                    fill={C.ember} stroke={C.cream} strokeWidth="2" />
          </>
        )}
      </svg>
      {hd && (
        <Tip style={{ left: `${(hov / Math.max(data.length - 1, 1)) * 100}%`, top: 28, transform: 'translateX(-50%)' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{fmtDate(hd.shift_date)}</div>
          <div>{fmtUSD(hd.net_sales)}</div>
          <div style={{ color: C.hair, fontSize: 10 }}>{fmtNum(hd.orders)} orders · {fmtNum(hd.guests)} guests</div>
        </Tip>
      )}
    </div>
  );
}

/* ================================================================
   DAY OF WEEK — grouped bars (current vs prior)
   ================================================================ */
function DowBars({ current, prior }) {
  const [hov, setHov] = useState(null);
  if (!current.length) return null;

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byDay = (arr) => { const m = {}; arr.forEach(r => { m[r.day_of_week] = r; }); return m; };
  const cm = byDay(current), pm = byDay(prior);

  const W = 400, H = 220;
  const p = { l: 50, r: 12, t: 16, b: 32 };
  const cw = W - p.l - p.r, ch = H - p.t - p.b;

  const allVals = days.flatMap(d => [cm[d]?.net_sales || 0, pm[d]?.net_sales || 0]);
  const max = Math.max(...allVals);
  const yMax = Math.ceil(max / 200000) * 200000 || 200000;
  const sy = v => p.t + ch - ((v || 0) / yMax) * ch;

  const gw = cw / days.length;
  const barW = gw * 0.32;
  const gap = 3;

  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
      <SectionLabel>Revenue by day</SectionLabel>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
           preserveAspectRatio="xMidYMid meet">
        {[0, yMax / 2, yMax].map(v => (
          <line key={v} x1={p.l} x2={W - p.r} y1={sy(v)} y2={sy(v)}
                stroke={C.hair} strokeWidth=".5" strokeDasharray="3,3" />
        ))}
        {[0, yMax / 2, yMax].map(v => (
          <text key={`l${v}`} x={p.l - 5} y={sy(v) + 3.5} textAnchor="end"
                fill={C.muted} fontSize="8.5" fontFamily="'JetBrains Mono',monospace">
            {fmtK(v)}
          </text>
        ))}
        {days.map((d, i) => {
          const cx = p.l + gw * i + gw / 2;
          const cv = cm[d]?.net_sales || 0;
          const pv = pm[d]?.net_sales || 0;
          const isHov = hov === i;
          return (
            <g key={d} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
               style={{ cursor: 'default' }}>
              <rect x={cx - barW - gap / 2} y={sy(cv)} width={barW}
                    height={Math.max(0, sy(0) - sy(cv))}
                    fill={isHov ? C.emberDeep : C.ember} rx="2" />
              <rect x={cx + gap / 2} y={sy(pv)} width={barW}
                    height={Math.max(0, sy(0) - sy(pv))}
                    fill={isHov ? C.char : C.hair} rx="2" />
              <text x={cx} y={H - 8} textAnchor="middle"
                    fill={isHov ? C.ink : C.muted} fontSize="10" fontWeight={isHov ? 700 : 500}
                    fontFamily="'Inter Tight',sans-serif">
                {d}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: C.muted }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.ember, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Current</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: C.hair, borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Prior year</span>
      </div>
      {hov != null && (() => {
        const d = days[hov];
        const cv = cm[d]?.net_sales || 0, pv = pm[d]?.net_sales || 0;
        const chg = pv > 0 ? ((cv - pv) / pv * 100) : null;
        return (
          <Tip style={{ left: `${((hov + 0.5) / days.length) * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
            <div style={{ fontWeight: 700 }}>{d}</div>
            <div>Now {fmtK(cv)} · Prior {fmtK(pv)}</div>
            {chg != null && (
              <div style={{ color: chg >= 0 ? C.sage : C.rust, fontWeight: 700 }}>
                {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
              </div>
            )}
          </Tip>
        );
      })()}
    </div>
  );
}

/* ================================================================
   HOURLY — dual line chart (current vs prior year)
   ================================================================ */
function HourlyLines({ current, prior }) {
  const [hov, setHov] = useState(null);
  if (!current.length) return null;

  // Only show hours with meaningful data (filter very low hours)
  const active = current.filter(h => h.net_sales > 500);
  const hours = active.map(h => h.hour_24);
  const byHour = (arr) => { const m = {}; arr.forEach(r => { m[r.hour_24] = r; }); return m; };
  const cm = byHour(current), pm = byHour(prior);

  const W = 400, H = 220;
  const p = { l: 50, r: 12, t: 16, b: 32 };
  const cw = W - p.l - p.r, ch = H - p.t - p.b;

  const allVals = hours.flatMap(h => [cm[h]?.net_sales || 0, pm[h]?.net_sales || 0]);
  const max = Math.max(...allVals);
  const yMax = Math.ceil(max / 100000) * 100000 || 100000;

  const sx = i => p.l + (i / Math.max(hours.length - 1, 1)) * cw;
  const sy = v => p.t + ch - ((v || 0) / yMax) * ch;

  const mkLine = (map) => hours.map((h, i) => `${sx(i).toFixed(1)},${sy(map[h]?.net_sales || 0).toFixed(1)}`);
  const cPts = mkLine(cm), pPts = mkLine(pm);
  const cLine = `M${cPts.join('L')}`;
  const pLine = `M${pPts.join('L')}`;
  const cArea = `M${sx(0)},${sy(0)} L${cPts.join('L')} L${sx(hours.length - 1)},${sy(0)} Z`;

  const fmtHour = h => {
    if (h === 0) return '12a';
    if (h < 12) return `${h}a`;
    if (h === 12) return '12p';
    return `${h - 12}p`;
  };

  const xStep = Math.max(1, Math.floor(hours.length / 6));

  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
      <SectionLabel>Hourly revenue curve</SectionLabel>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
           preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.ember} stopOpacity=".15" />
            <stop offset="100%" stopColor={C.ember} stopOpacity=".01" />
          </linearGradient>
        </defs>
        {[0, yMax / 2, yMax].map(v => (
          <line key={v} x1={p.l} x2={W - p.r} y1={sy(v)} y2={sy(v)}
                stroke={C.hair} strokeWidth=".5" strokeDasharray="3,3" />
        ))}
        {[0, yMax / 2, yMax].map(v => (
          <text key={`l${v}`} x={p.l - 5} y={sy(v) + 3.5} textAnchor="end"
                fill={C.muted} fontSize="8.5" fontFamily="'JetBrains Mono',monospace">
            {fmtK(v)}
          </text>
        ))}
        <path d={cArea} fill="url(#hg)" />
        <path d={pLine} fill="none" stroke={C.hair} strokeWidth="1.5"
              strokeDasharray="5,4" strokeLinejoin="round" />
        <path d={cLine} fill="none" stroke={C.ember} strokeWidth="2" strokeLinejoin="round" />
        {hours.map((h, i) => {
          if (i % xStep !== 0 && i !== hours.length - 1) return null;
          return (
            <text key={h} x={sx(i)} y={H - 8} textAnchor="middle"
                  fill={C.muted} fontSize="9" fontFamily="'JetBrains Mono',monospace">
              {fmtHour(h)}
            </text>
          );
        })}
        {hours.map((_, i) => {
          const bw = cw / hours.length;
          return (
            <rect key={i} x={sx(i) - bw / 2} y={p.t} width={bw} height={ch}
                  fill="transparent" onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
          );
        })}
        {hov != null && (
          <>
            <circle cx={sx(hov)} cy={sy(cm[hours[hov]]?.net_sales || 0)} r="4"
                    fill={C.ember} stroke={C.cream} strokeWidth="2" />
            <circle cx={sx(hov)} cy={sy(pm[hours[hov]]?.net_sales || 0)} r="3.5"
                    fill={C.hair} stroke={C.cream} strokeWidth="1.5" />
          </>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 10, color: C.muted }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: C.ember, marginRight: 4, verticalAlign: 1 }} />Current</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 2, background: C.hair, marginRight: 4, verticalAlign: 1, borderTop: `1.5px dashed ${C.hair}` }} />Prior year</span>
      </div>
      {hov != null && (() => {
        const h = hours[hov];
        const cv = cm[h]?.net_sales || 0, pv = pm[h]?.net_sales || 0;
        return (
          <Tip style={{ left: `${(hov / Math.max(hours.length - 1, 1)) * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
            <div style={{ fontWeight: 700 }}>{cm[h]?.label || fmtHour(h)}</div>
            <div>Now {fmtK(cv)} · Prior {fmtK(pv)}</div>
          </Tip>
        );
      })()}
    </div>
  );
}

/* ================================================================
   SPEND — simple bars
   ================================================================ */
function SpendBars({ data }) {
  const [hov, setHov] = useState(null);
  if (!data.length) return null;

  const W = 400, H = 180;
  const p = { l: 50, r: 12, t: 16, b: 32 };
  const cw = W - p.l - p.r, ch = H - p.t - p.b;

  const max = Math.max(...data.map(d => d.shamrock_total_spend || 0));
  const yMax = Math.ceil(max / 1000) * 1000 || 1000;
  const sy = v => p.t + ch - ((v || 0) / yMax) * ch;
  const bw = (cw / data.length) * 0.6;

  return (
    <div className="card" style={{ position: 'relative', overflow: 'visible' }}>
      <SectionLabel>Monthly Shamrock spend</SectionLabel>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}
           preserveAspectRatio="xMidYMid meet">
        {[0, yMax / 2, yMax].map(v => (
          <g key={v}>
            <line x1={p.l} x2={W - p.r} y1={sy(v)} y2={sy(v)}
                  stroke={C.hair} strokeWidth=".5" strokeDasharray="3,3" />
            <text x={p.l - 5} y={sy(v) + 3.5} textAnchor="end"
                  fill={C.muted} fontSize="8.5" fontFamily="'JetBrains Mono',monospace">
              {fmtK(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = p.l + (cw / data.length) * (i + 0.5);
          const v = d.shamrock_total_spend || 0;
          const isH = hov === i;
          return (
            <g key={d.month} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
              <rect x={cx - bw / 2} y={sy(v)} width={bw}
                    height={Math.max(0, sy(0) - sy(v))}
                    fill={isH ? C.sage : C.brass} rx="2" />
              <text x={cx} y={H - 8} textAnchor="middle"
                    fill={C.muted} fontSize="9" fontFamily="'JetBrains Mono',monospace">
                {d.month.replace(/^\d{4}-/, '')}
              </text>
            </g>
          );
        })}
      </svg>
      {hov != null && (
        <Tip style={{ left: `${((hov + 0.5) / data.length) * 100}%`, top: 0, transform: 'translateX(-50%)' }}>
          <div style={{ fontWeight: 700 }}>{data[hov].month}</div>
          <div>{fmtUSD(data[hov].shamrock_total_spend)}</div>
        </Tip>
      )}
    </div>
  );
}

/* ================================================================
   TOP ITEMS — table
   ================================================================ */
function TopItems({ items }) {
  if (!items.length) return (
    <div className="card">
      <SectionLabel>Top sellers</SectionLabel>
      <p style={{ fontSize: 13, color: C.muted }}>
        No sales data yet. Run <strong>npm run ingest:analytics</strong>.
      </p>
    </div>
  );

  const maxRev = Math.max(...items.map(r => r.rev || 0));

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <SectionLabel>Top sellers by net sales</SectionLabel>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 30 }}>#</th>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Net $</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={r.item_name}>
              <td style={{ color: C.muted, fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{i + 1}</td>
              <td style={{ fontWeight: 600 }}>{r.item_name}</td>
              <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>
                {fmtNum(r.qty)}
              </td>
              <td style={{ textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontSize: 13 }}>
                {fmtUSD(r.rev)}
              </td>
              <td>
                <div style={{
                  height: 6, borderRadius: 3, background: C.paper,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${((r.rev || 0) / maxRev) * 100}%`,
                    height: '100%', background: C.ember, borderRadius: 3,
                    transition: 'width .3s',
                  }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================
   MAIN EXPORT
   ================================================================ */
export default function AnalyticsCharts({
  daily, dowCurrent, dowPrior, hourlyCurrent, hourlyPrior, spend, top,
}) {
  return (
    <>
      <DailyArea data={daily} />

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 32,
      }}>
        <DowBars current={dowCurrent} prior={dowPrior} />
        <HourlyLines current={hourlyCurrent} prior={hourlyPrior} />
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
      }}>
        <SpendBars data={spend} />
        <TopItems items={top} />
      </div>
    </>
  );
}
