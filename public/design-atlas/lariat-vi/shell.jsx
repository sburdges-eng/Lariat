/* Shell + Components — shared by all pages */
const { useState, useEffect, useMemo, useRef } = React;
const D = window.LARIAT_DATA;

// ─── Nav registry — every page in the spec ───
const NAV = [
  { sec: 'Today', items: [
    { id: 'cockpit', label: 'Cockpit', dept: 'CHEF', mode: 'kitchen', icon: '◐' },
    { id: 'canvas',  label: 'Feature Atlas', dept: 'ALL', icon: '⊞' },
  ]},
  { sec: 'Back of House', items: [
    { id: 'dish', label: 'Dish Pit', dept: 'BOH', role:'Dishwasher', mode:'kitchen', icon:'◇' },
    { id: 'prep', label: 'Prep Cook', dept:'BOH', role:'Prep', mode:'kitchen', icon:'◇' },
    { id: 'line', label: 'Line — KDS', dept:'BOH', role:'Line Cook', mode:'kitchen', icon:'◆' },
    { id: 'eightySix', label: '86 Board', dept:'BOH', mode:'kitchen', icon:'✕' },
    { id: 'sous', label: 'Sous Chef', dept:'BOH', role:'Sous', mode:'kitchen', icon:'◇' },
    { id: 'menuEng', label: 'Menu Engineering', dept:'BOH', icon:'⊟' },
    { id: 'specials', label: 'Specials Sandbox', dept:'BOH', icon:'✦' },
    { id: 'foodCost', label: 'Food Cost Center', dept:'BOH', icon:'$' },
    { id: 'beo', label: 'BEO Manager', dept:'BOH', icon:'⊡' },
    { id: 'allergen', label: 'Allergen Matrix', dept:'BOH', icon:'⚠' },
  ]},
  { sec: 'Front of House', items: [
    { id: 'host', label: 'Host Stand', dept:'FOH', role:'Host', icon:'◇' },
    { id: 'server', label: 'Server', dept:'FOH', role:'Server', icon:'◇' },
    { id: 'runner', label: 'Runner / Busser', dept:'FOH', role:'Runner', icon:'◇' },
    { id: 'mod', label: 'Floor Manager', dept:'FOH', role:'MOD', icon:'◆' },
    { id: 'closeout', label: 'Nightly Closeout', dept:'FOH', icon:'⊟' },
  ]},
  { sec: 'Bar', items: [
    { id: 'bar', label: 'Bar Recipes & Pour', dept:'BAR', role:'Bartender', icon:'◇' },
    { id: 'barInv', label: 'Bar Inventory', dept:'BAR', icon:'⊟' },
    { id: 'barBack', label: 'Bar Back', dept:'BAR', role:'Bar Back', icon:'◇' },
  ]},
  { sec: 'Entertainment', items: [
    { id: 'tonight', label: 'Tonight · Live', dept:'EVENT', icon:'●' },
    { id: 'booking', label: 'Booking & Calendar', dept:'EVENT', icon:'⊞' },
    { id: 'boxOffice', label: 'Box Office', dept:'EVENT', role:'Box Office', icon:'$' },
    { id: 'sound', label: 'Sound Engineer', dept:'EVENT', role:'Sound', icon:'♫' },
    { id: 'stage', label: 'Stage / Run of Show', dept:'EVENT', icon:'⊡' },
    { id: 'promo', label: 'Promo & Marketing', dept:'EVENT', icon:'◐' },
    { id: 'talent', label: 'Talent Pipeline', dept:'EVENT', icon:'★' },
  ]},
  { sec: 'Office', items: [
    { id: 'gm', label: 'GM Command Center', dept:'OFFICE', role:'GM', icon:'◆' },
    { id: 'pl', label: 'P&L Dashboard', dept:'OFFICE', icon:'$' },
    { id: 'labor', label: 'Labor Suite', dept:'OFFICE', icon:'⊟' },
    { id: 'hiring', label: 'Hiring & HR', dept:'OFFICE', icon:'◇' },
    { id: 'vendors', label: 'Vendors', dept:'OFFICE', icon:'⊟' },
    { id: 'marketing', label: 'Marketing', dept:'OFFICE', icon:'◐' },
    { id: 'feedback', label: 'Guest Feedback', dept:'OFFICE', icon:'☆' },
    { id: 'maint', label: 'Maintenance', dept:'OFFICE', icon:'⚙' },
    { id: 'compliance', label: 'Compliance Cal.', dept:'OFFICE', icon:'⊡' },
    { id: 'owner', label: 'Owner / Investor', dept:'OFFICE', role:'Owner', icon:'◆' },
    { id: 'scenario', label: 'Scenario Modeler', dept:'OFFICE', icon:'∿' },
    { id: 'accounting', label: 'Accounting / Books', dept:'OFFICE', icon:'$' },
  ]},
  { sec: 'Cross-Cutting', items: [
    { id: 'inventory', label: 'Inventory & Pars', dept:'X', icon:'⊟' },
    { id: 'haccp', label: 'HACCP Logs', dept:'X', icon:'⚠' },
    { id: 'analytics', label: 'Sales Analytics', dept:'X', icon:'∿' },
    { id: 'guests', label: 'Guest Experience', dept:'X', icon:'☆' },
    { id: 'comms', label: 'Team Comms', dept:'X', icon:'✉' },
    { id: 'assistant', label: 'Kitchen Assistant', dept:'X', mode:'kitchen', icon:'✦' },
  ]},
];

const ALL_PAGES = NAV.flatMap(s => s.items);
const findPage = id => ALL_PAGES.find(p => p.id === id) || ALL_PAGES[0];

// ── Service phases ──
const PHASES = [
  { k:'Open',  t:'10:00' },
  { k:'Lunch', t:'11:30' },
  { k:'Mid',   t:'2:30' },
  { k:'Dinner',t:'5:00', now:true },
  { k:'Late',  t:'9:30' },
];

// ── Logo ──
const Logo = () => (
  <svg className="logo" viewBox="0 0 28 28" fill="none">
    <path d="M4 14 q5 -10 14 -8 q9 2 6 12 q-3 8 -12 6 q-9 -2 -8 -10z" stroke="currentColor" strokeWidth="1.4"/>
    <circle cx="14" cy="14" r="3" fill="currentColor"/>
  </svg>
);

// ── Top strip ──
function ServiceStrip({ now, role, kitchen }) {
  const time = now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true});
  return (
    <header className="strip">
      <div className="mark">
        <Logo />
        <div>
          <b>The Lariat</b>
          <i>Cockpit · Buena Vista</i>
        </div>
      </div>
      <div className="strip-mid">
        {PHASES.map((p,i) => (
          <div key={i} className={`strip-phase ${p.now?'now':i<3?'past':''}`}>
            <span className="pdot"></span>
            <span>{p.k}</span>
            <span className="mono" style={{opacity:.6,fontSize:10}}>{p.t}</span>
          </div>
        ))}
      </div>
      <div className="strip-right">
        <span className="heat">In service</span>
        <span className="clock">{time}</span>
        <span>{role}</span>
      </div>
    </header>
  );
}

// ── Sidebar rail ──
function Rail({ active, onNav }) {
  return (
    <aside className="rail">
      {NAV.map(sec => (
        <div key={sec.sec}>
          <div className="rail-section">{sec.sec}</div>
          {sec.items.map(it => (
            <a key={it.id} href="#" className={active===it.id?'active':''}
               onClick={e=>{e.preventDefault();onNav(it.id)}}>
              <span className="ic">{it.icon}</span>
              <span>{it.label}</span>
            </a>
          ))}
        </div>
      ))}
    </aside>
  );
}

// ── Dock (bottom) ──
function Dock({ pageLabel }) {
  return (
    <footer className="dock">
      <span><kbd>⌘K</kbd> command palette</span>
      <span><kbd>1-6</kbd> stations</span>
      <span><kbd>?</kbd> help</span>
      <div className="dock-spacer"></div>
      <span>· {pageLabel} ·</span>
    </footer>
  );
}

// ── Page Header helper ──
function PageHead({ eyebrow, title, em, sub, actions }) {
  return (
    <div className="page-head">
      <div>
        <div className="page-eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title} {em && <em>{em}</em>}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

// ── Bureau-specific dressing (broadsheet aesthetic) ──
function BureauFold({ left='BUREAU · OWNER LENS', right='EST. MMXXVI · DAILY' }) {
  return <div className="bureau-fold"><span>{left}</span><span>{right}</span></div>;
}

function BureauNameplate({ name='The Bureau', tagline='— filed at six forty-two · saturday morning —', stars=9 }) {
  return (
    <div className="bureau-nameplate">
      <div className="bureau-nameplate-rule">{Array(stars).fill('★').join(' ')}</div>
      <div className="bureau-nameplate-name">{name}</div>
      <div className="bureau-nameplate-tagline">{tagline}</div>
    </div>
  );
}

function FileTab({ no='2026-129', sub='OWNER MORNING BRIEF · CLASS · 1' }) {
  return (
    <div className="bureau-filetab">FILE NO. {no}<small>{sub}</small></div>
  );
}

function BureauStamp({ children }) {
  return <div className="bureau-stamp">{children}</div>;
}

function PullNote({ label, children, who }) {
  return (
    <div className="bureau-pull">
      {label && <span className="bureau-pull-label">{label}</span>}
      {children}
      {who && <div style={{marginTop:8,fontStyle:'normal',fontFamily:'JetBrains Mono,monospace',fontSize:9.5,letterSpacing:'.18em',color:'#7b6a52',textTransform:'uppercase'}}>— {who}</div>}
    </div>
  );
}

function BureauTicker({ items }) {
  const stream = items.join('   ◆   ');
  return (
    <div className="bureau-ticker">
      <span className="bureau-ticker-label">WIRE ◀</span>
      <span style={{flex:1,whiteSpace:'nowrap',overflow:'hidden'}}>{stream}{'   ◆   '}{stream}</span>
    </div>
  );
}

function BureauSummary({ cells }) {
  return (
    <div className="bureau-summary">
      {cells.map((c,i)=>(
        <div key={i}>
          <div className="b-cell-l">{c.label}</div>
          <div className={`b-cell-v ${c.amber?'amber':''}`}>{c.value}</div>
          <div className="b-cell-s">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── KPI tile ──
function KPI({ label, value, sub, tone, big }) {
  const cls = tone ? ` ${tone}` : '';
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={big?{fontSize:48}:{}}>{value}</div>
      {sub && <div className={`kpi-sub${cls}`}>{sub}</div>}
    </div>
  );
}

// ── Bar list (horizontal) ──
function BarList({ items, max }) {
  const m = max || Math.max(...items.map(i=>i.v));
  return (
    <div>
      {items.map((it,i)=>(
        <div className="bar-row" key={i}>
          <div style={{width:130,fontSize:12,fontWeight:600}}>{it.l}</div>
          <div className="bar-track"><div className="bar-fill" style={{width:`${(it.v/m)*100}%`,background:it.color||'var(--ember)'}}></div></div>
          <div className="tnum" style={{fontSize:11,width:60,textAlign:'right'}}>{it.r||it.v}</div>
        </div>
      ))}
    </div>
  );
}

// ── Mini bar chart SVG ──
function BarChart({ data, w=520, h=160, getV, getL, color='var(--ember)' }) {
  const max = Math.max(...data.map(getV));
  const bw = (w-30)/data.length - 6;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`}>
      {data.map((d,i)=>{
        const v = getV(d), bh = (v/max)*(h-40);
        return (
          <g key={i} transform={`translate(${20+i*((w-30)/data.length)},0)`}>
            <rect x="0" y={h-25-bh} width={bw} height={bh} fill={color} rx="2"/>
            <text x={bw/2} y={h-10} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".55" fontFamily="JetBrains Mono">{getL(d)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Line chart (with area) ──
function LineChart({ data, w=520, h=160, getV, getL, color='var(--ember)' }) {
  const max = Math.max(...data.map(getV));
  const min = Math.min(...data.map(getV));
  const xs = i => 20 + (i/(data.length-1))*(w-40);
  const ys = v => 20 + (1-(v-min)/((max-min)||1))*(h-50);
  const path = data.map((d,i)=>`${i===0?'M':'L'}${xs(i)},${ys(getV(d))}`).join(' ');
  const area = path + ` L${xs(data.length-1)},${h-25} L${xs(0)},${h-25} Z`;
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={color} opacity=".12"/>
      <path d={path} fill="none" stroke={color} strokeWidth="2"/>
      {data.map((d,i)=>(
        <g key={i}>
          <circle cx={xs(i)} cy={ys(getV(d))} r="3" fill={color}/>
          <text x={xs(i)} y={h-8} fontSize="10" textAnchor="middle" fill="currentColor" opacity=".55" fontFamily="JetBrains Mono">{getL(d)}</text>
        </g>
      ))}
    </svg>
  );
}

// ── Donut ──
function Donut({ value, label, color='var(--ember)' }) {
  const r=42, c=2*Math.PI*r;
  return (
    <svg viewBox="0 0 110 110" width="120" height="120">
      <circle cx="55" cy="55" r={r} fill="none" stroke="var(--paper-2)" strokeWidth="10"/>
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${(value/100)*c} ${c}`} transform="rotate(-90 55 55)" strokeLinecap="round"/>
      <text x="55" y="56" fontSize="22" textAnchor="middle" fontFamily="Instrument Serif" fill="currentColor">{value}%</text>
      <text x="55" y="74" fontSize="8" textAnchor="middle" fill="currentColor" opacity=".6" letterSpacing="2">{label?.toUpperCase()}</text>
    </svg>
  );
}

// ── Phone frame ──
function Phone({ children, label }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
      <div className="phone">
        <div className="phone-notch"></div>
        <div className="phone-screen">{children}</div>
      </div>
      {label && <div style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'var(--muted)',fontWeight:700}}>{label}</div>}
    </div>
  );
}

function Tablet({ children, label }) {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
      <div className="tablet"><div className="tablet-screen">{children}</div></div>
      {label && <div style={{fontSize:11,letterSpacing:'.18em',textTransform:'uppercase',color:'var(--muted)',fontWeight:700}}>{label}</div>}
    </div>
  );
}

// ── Heatmap grid ──
function Heatmap({ rows, cols, data, getV, max }) {
  const m = max || Math.max(...data.flat().map(v => typeof v === 'number' ? v : v.v||0));
  return (
    <table style={{borderCollapse:'collapse',fontFamily:'JetBrains Mono',fontSize:10}}>
      <thead><tr><th></th>{cols.map(c=><th key={c} style={{padding:'2px 6px',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.1em'}}>{c}</th>)}</tr></thead>
      <tbody>
        {rows.map((r,i)=>(
          <tr key={r}>
            <td style={{padding:'2px 8px',color:'var(--muted)',textTransform:'uppercase',letterSpacing:'.1em',textAlign:'right'}}>{r}</td>
            {cols.map((c,j)=>{
              const v = data[i][j];
              const op = m? Math.min(.95, v/m): 0;
              return <td key={c} style={{padding:0}}>
                <div className="heat-cell" style={{background:`color-mix(in oklab, var(--ember) ${op*70}%, var(--paper-2))`}} title={`${r} · ${c}: ${v}`}></div>
              </td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// expose
Object.assign(window, { NAV, ALL_PAGES, findPage, PHASES,
  ServiceStrip, Rail, Dock, PageHead, KPI, BarList, BarChart, LineChart, Donut, Phone, Tablet, Heatmap, Logo,
  BureauFold, BureauNameplate, FileTab, BureauStamp, PullNote, BureauTicker, BureauSummary
});
