// Cockpit shell chrome — service strip, left rail ("The Line"), command bar.
// Ported from app/_components/{ServiceStrip,Sidebar,CommandBar}.jsx.
const { useState } = React;
const { BrandStamp, StationRing } = window.LariatLaRiOSDesignSystem_5761b2;

const Stamp = (p) => <BrandStamp decorative {...p} />;

const PHASES = [
  { key: 'prep', label: 'Prep', t: '8a–11a', state: 'past' },
  { key: 'open', label: 'Open', t: '11a–5p', state: 'past' },
  { key: 'rush', label: 'Rush', t: '5p–10p', state: 'now' },
  { key: 'close', label: 'Close', t: '10p–12a', state: 'future' },
];

function ServiceStrip() {
  return (
    <header className="ck-strip">
      <div className="ck-mark">
        <Stamp />
        <div><b>The Lariat</b><i>Kitchen Cockpit</i></div>
      </div>
      <div className="ck-phases">
        {PHASES.map((p) => (
          <div key={p.key} className={`ck-phase ${p.state}`}>
            <span className="pd" /><span className="pl">{p.label}</span><span className="pt">{p.t}</span>
          </div>
        ))}
      </div>
      <div className="ck-status">
        <span>Fri · Nov 14</span>
        <span className="clk">6:38p</span>
        <span className="ck-heat">RUSH</span>
      </div>
    </header>
  );
}

const PRIMARY = [
  { id: 'today', name: 'Today', key: '0' },
  { id: 'eighty-six', name: '86 Board', key: '8' },
  { id: 'inventory', name: 'Stock', key: 'I' },
];
const BOOKS = [
  { id: 'recipes', name: 'Recipe Book', key: 'R' },
  { id: 'beo', name: 'BEO Board', key: 'B' },
];
const COMPLIANCE = [
  { id: 'temps', name: 'Temp Log', key: 'T' },
  { id: 'cooling', name: 'Cooling', key: 'C' },
];

function Sidebar({ view, go, cook, setCook }) {
  return (
    <aside className="ck-side">
      <div className="ck-brand"><Stamp /><span>The Line</span><small>Cockpit</small></div>
      {PRIMARY.map((n) => (
        <button key={n.id} className={`ck-nav ${view === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <span className="k">{n.key}</span><span>{n.name}</span>
        </button>
      ))}

      <div className="ck-navsec"><Stamp /><span>Stations</span></div>
      {window.COCKPIT.stations.slice(0, 6).map((s, i) => {
        const label = s.flagged > 0 ? `${s.flagged} FLAGGED` : s.signedOff ? 'SIGNED OFF' : `${s.done}/${s.total}`;
        return (
          <button key={s.id} className={`ck-station ${view === 'station:' + s.id ? 'active' : ''}`} onClick={() => go('station:' + s.id)}>
            <StationRing done={s.done} total={s.total} flagged={s.flagged} signedOff={s.signedOff} glyph={i + 1} size={30} />
            <span><span className="sn">{s.name}</span><span className="ss">{label}</span></span>
            <span className="sk">{i + 1}</span>
          </button>
        );
      })}

      <div className="ck-navsec"><Stamp /><span>Books</span></div>
      {BOOKS.map((n) => (
        <button key={n.id} className={`ck-nav ${view === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <span className="k">{n.key}</span><span>{n.name}</span>
        </button>
      ))}

      <div className="ck-navsec"><Stamp /><span>Compliance</span></div>
      {COMPLIANCE.map((n) => (
        <button key={n.id} className={`ck-nav ${view === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
          <span className="k">{n.key}</span><span>{n.name}</span>
        </button>
      ))}

      <div className="ck-cook">
        <label>You're clocked in as</label>
        <select value={cook} onChange={(e) => setCook(e.target.value)}>
          {window.COCKPIT.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </aside>
  );
}

function CommandBar() {
  return (
    <footer className="ck-cmd">
      <div className="grp">
        <span className="ck-slot"><kbd className="ck-kbd">⌘</kbd><kbd className="ck-kbd">K</kbd> Jump</span>
        <span className="ck-slot"><kbd className="ck-kbd">/</kbd> Search</span>
        <span className="ck-slot"><kbd className="ck-kbd">1</kbd>–<kbd className="ck-kbd">6</kbd> Stations</span>
        <span className="ck-slot"><kbd className="ck-kbd">8</kbd> <span className="accent">86</span></span>
      </div>
      <div className="grp"><span className="ck-slot">The Lariat <span style={{ opacity: .4 }}>·</span> v2.4</span></div>
    </footer>
  );
}

window.Shell = { ServiceStrip, Sidebar, CommandBar, Stamp };
