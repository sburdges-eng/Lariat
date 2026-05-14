/* Supplemental chart components used by office/cross-cutting pages */
const { useState: uSc } = React;

// Donut2 — multi-segment (rename collision avoided by overriding window.Donut2)
function Donut2({ data, size=200 }) {
  const total = data.reduce((s,d)=>s+d.v,0);
  const r=80, c=2*Math.PI*r;
  let off=0;
  return (<div style={{display:'flex',gap:18,alignItems:'center'}}>
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--paper-2)" strokeWidth="22"/>
      {data.map((d,i)=>{
        const len = (d.v/total)*c;
        const seg = <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={d.c}
          strokeWidth="22" strokeDasharray={`${len} ${c}`} strokeDashoffset={-off}
          transform={`rotate(-90 ${size/2} ${size/2})`}/>;
        off += len;
        return seg;
      })}
    </svg>
    <div>{data.map(d=>(<div key={d.l} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,fontSize:12}}>
      <span style={{display:'inline-block',width:10,height:10,background:d.c,borderRadius:2}}/>
      <span style={{flex:1}}>{d.l}</span>
      <span className="mono">{d.v}%</span>
    </div>))}</div>
  </div>);
}
// Reassign window.Donut to accept either signature
const _origDonut = window.Donut;
window.Donut = function(props) {
  if (Array.isArray(props.data)) return Donut2(props);
  return _origDonut(props);
};

// DualLine — two series overlaid (cur vs prev YoY)
function DualLine({ data, w=500, h=180 }) {
  const all = data.flatMap(d=>[d.cur,d.prev]);
  const max = Math.max(...all)*1.05, min = Math.min(...all)*.92;
  const xs = i => 30 + (i/(data.length-1))*(w-50);
  const ys = v => 20 + (1-(v-min)/((max-min)||1))*(h-50);
  const line = key => data.map((d,i)=>`${i===0?'M':'L'}${xs(i)},${ys(d[key])}`).join(' ');
  return (<svg className="chart" viewBox={`0 0 ${w} ${h}`}>
    <path d={line('prev')} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="3 3"/>
    <path d={line('cur')} fill="none" stroke="var(--ember)" strokeWidth="2.2"/>
    {data.map((d,i)=>(<g key={i}>
      <circle cx={xs(i)} cy={ys(d.cur)} r="3" fill="var(--ember)"/>
      <text x={xs(i)} y={h-8} fontSize="9" textAnchor="middle" fill="currentColor" opacity=".55" fontFamily="JetBrains Mono">{d.l}</text>
    </g>))}
    <g transform={`translate(${w-130},20)`} fontSize="10" fontFamily="JetBrains Mono">
      <line x1="0" y1="4" x2="14" y2="4" stroke="var(--ember)" strokeWidth="2"/>
      <text x="20" y="8" fill="currentColor">2026</text>
      <line x1="60" y1="4" x2="74" y2="4" stroke="var(--muted)" strokeDasharray="3 3"/>
      <text x="80" y="8" fill="currentColor">2025</text>
    </g>
  </svg>);
}

// StackedBar — current vs prev period
function StackedBar({ data, w=500, h=180 }) {
  const max = Math.max(...data.map(d=>Math.max(d.cur,d.prev)))*1.2;
  const bw = (w-40)/data.length - 12;
  return (<svg className="chart" viewBox={`0 0 ${w} ${h}`}>
    {data.map((d,i)=>{
      const x = 30 + i*((w-40)/data.length);
      const ch = (d.cur/max)*(h-40);
      const ph = (d.prev/max)*(h-40);
      return (<g key={i}>
        <rect x={x} y={h-25-ph} width={bw/2-2} height={ph} fill="var(--paper-2)" stroke="var(--hair)" strokeWidth=".5"/>
        <rect x={x+bw/2} y={h-25-ch} width={bw/2-2} height={ch} fill="var(--ember)"/>
        <text x={x+bw/2} y={h-10} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".55" fontFamily="JetBrains Mono">{d.d}</text>
        <text x={x+bw/2} y={h-25-ch-4} fontSize="9" textAnchor="middle" fill="var(--ember-deep)" fontFamily="JetBrains Mono">{d.cur}%</text>
      </g>);
    })}
  </svg>);
}

// Sparkline
function Spark({ v, w=80, h=22, color='var(--ember)' }) {
  const max = Math.max(...v), min = Math.min(...v);
  const xs = i => (i/(v.length-1))*w;
  const ys = val => h - ((val-min)/((max-min)||1))*h*.85 - 2;
  const path = v.map((val,i)=>`${i===0?'M':'L'}${xs(i)},${ys(val)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{display:'block'}}>
    <path d={path} fill="none" stroke={color} strokeWidth="1.4"/>
  </svg>;
}

// Scatter
function Scatter({ data, w=320, h=180 }) {
  const xs = data.map(d=>d.x), ys = data.map(d=>d.y);
  const xmin=Math.min(...xs), xmax=Math.max(...xs), ymin=Math.min(...ys), ymax=Math.max(...ys);
  return (<svg viewBox={`0 0 ${w} ${h}`} className="chart">
    {data.map((d,i)=>{
      const x = 20 + ((d.x-xmin)/((xmax-xmin)||1))*(w-40);
      const y = h-20 - ((d.y-ymin)/((ymax-ymin)||1))*(h-40);
      return <circle key={i} cx={x} cy={y} r="3" fill="var(--ember)" opacity=".75"/>;
    })}
    <line x1="20" y1={h-20} x2={w-10} y2={h-20} stroke="var(--hair)"/>
    <line x1="20" y1="10" x2="20" y2={h-20} stroke="var(--hair)"/>
  </svg>);
}

Object.assign(window, { Donut2, DualLine, StackedBar, Spark, Scatter });
