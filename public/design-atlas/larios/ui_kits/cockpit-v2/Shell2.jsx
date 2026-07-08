// Cockpit v2 chrome — division rail, per-division sidebar, tab strip,
// theme toggle. Reuses v1's ServiceStrip + screens.
const DS2 = window.LariatLaRiOSDesignSystem_5761b2;
const { BrandStamp } = DS2;
const Stamp2 = (p) => <BrandStamp decorative {...p} />;

/* ── Division registry — the proposed IA.
   win:true ⇒ board opens as its own window (wall mount / printable sheet). */
const DIVISIONS = [
  {
    id: 'service', glyph: 'LN', name: 'Line',
    sections: [
      { name: 'Service', boards: [
        { id: 'today', name: 'Today', pinned: true },
        { id: 'eighty-six', name: '86 Board', badge: true },
        { id: 'prep', name: 'Prep' },
        { id: 'specials', name: 'Specials' },
      ]},
      { name: 'Stations', boards: [
        { id: 'station:saute', name: 'Sauté' },
        { id: 'station:grill', name: 'Grill' },
        { id: 'station:sauce', name: 'Sauce' },
      ]},
      { name: 'Displays', boards: [
        { id: 'kds', name: 'KDS / Expo', win: true },
      ]},
    ],
  },
  {
    id: 'foh', glyph: 'FL', name: 'Floor',
    sections: [
      { name: 'Front of house', boards: [
        { id: 'host', name: 'Host Stand', win: true },
        { id: 'floor', name: 'Floor Map' },
        { id: 'resos', name: 'Reservations' },
        { id: 'bar', name: 'Bar' },
      ]},
    ],
  },
  {
    id: 'books', glyph: 'BK', name: 'Books',
    sections: [
      { name: 'The books', boards: [
        { id: 'recipes', name: 'Recipe Book' },
        { id: 'beo', name: 'BEO Board', win: true },
        { id: 'orderguide', name: 'Order Guide', win: true },
      ]},
    ],
  },
  {
    id: 'safety', glyph: 'SF', name: 'Safety',
    sections: [
      { name: 'Food safety', boards: [
        { id: 'temps', name: 'Temp Log' },
        { id: 'cooling', name: 'Cooling' },
        { id: 'cleaning', name: 'Cleaning' },
        { id: 'sanitizer', name: 'Sanitizer' },
      ]},
    ],
  },
  {
    id: 'office', glyph: 'OF', name: 'Office',
    sections: [
      { name: 'Stock & buying', boards: [
        { id: 'inventory', name: 'Stock & Par' },
        { id: 'receiving', name: 'Receiving' },
        { id: 'costing', name: 'Costing' },
      ]},
      { name: 'People', boards: [
        { id: 'tippool', name: 'Tip Pool' },
        { id: 'breaks', name: 'Breaks & Leave' },
        { id: 'sick', name: 'Sick Leave' },
        { id: 'wage', name: 'Wage Notices' },
        { id: 'reviews', name: 'Reviews' },
        { id: 'certs', name: 'Staff Certs' },
        { id: 'goldstars', name: 'Gold Stars' },
      ]},
      { name: 'Records', boards: [
        { id: 'audit', name: 'Audit Log' },
      ]},
    ],
  },
  {
    id: 'shows', glyph: 'SH', name: 'Shows',
    sections: [
      { name: 'Stage', boards: [
        { id: 'tonight', name: 'Tonight' },
        { id: 'stage', name: 'Stage Setup' },
        { id: 'sound', name: 'Sound' },
        { id: 'boxoffice', name: 'Box Office', win: true },
        { id: 'settlement', name: 'Settlement', win: true },
      ]},
    ],
  },
];

function DivisionRail({ division, setDivision, badge86 }) {
  return (
    <nav className="ck2-rail">
      {DIVISIONS.map((d) => (
        <button key={d.id} className={`ck2-div ${division === d.id ? 'active' : ''}`} onClick={() => setDivision(d.id)} title={d.name}>
          <span className="g">{d.glyph}</span>
          <span className="l">{d.name}</span>
          {d.id === 'service' && badge86 > 0 && <span className="badge">{badge86}</span>}
        </button>
      ))}
      <span className="spacer" />
    </nav>
  );
}

function DivisionSidebar({ division, activeTab, openBoard }) {
  const d = DIVISIONS.find((x) => x.id === division);
  const C = window.COCKPIT;
  return (
    <aside className="ck2-side">
      <div className="hd"><Stamp2 />{d.name}</div>
      {d.sections.map((sec) => (
        <React.Fragment key={sec.name}>
          <div className="ck2-sec">{sec.name}</div>
          {sec.boards.map((b) => (
            <button key={b.id} className={`ck2-board ${activeTab === b.id ? 'active' : ''}`} onClick={() => openBoard(b)}>
              <span>{b.name}</span>
              {b.badge && C.eightySix.length > 0 && <span className="cnt">{C.eightySix.length}</span>}
              {b.win && <span className="win" title="Opens in its own window">⧉</span>}
            </button>
          ))}
        </React.Fragment>
      ))}
      <div className="ck2-legend"><b>⧉</b> opens its own window — wall displays, host iPad, printable sheets.</div>
    </aside>
  );
}

function TabStrip({ tabs, active, setActive, closeTab }) {
  return (
    <div className="ck2-tabs">
      {tabs.map((t) => (
        <button key={t.id} className={`ck2-tab ${t.id === active ? 'active' : ''} ${t.pinned ? 'pinned' : ''}`} onClick={() => setActive(t.id)}>
          <span className="dv">{t.divGlyph}</span>
          {t.name}
          <span
            className="x"
            onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
          >×</span>
        </button>
      ))}
    </div>
  );
}

function ThemeToggle({ theme, setTheme }) {
  return (
    <span className="ck2-theme">
      <button className={theme === 'iron' ? 'on' : ''} onClick={() => setTheme('iron')}>Iron</button>
      <button className={theme === 'ledger' ? 'on' : ''} onClick={() => setTheme('ledger')}>Ledger</button>
    </span>
  );
}

function StubScreen({ name, win }) {
  return (
    <div className="ck2-empty">
      <div className="t">{name}</div>
      <div className="s">
        Not recreated in this proposal — the real board exists in LariatOS
        {win ? <> and <b>opens as its own window</b> (wall display / device / printable sheet), so it never competes for tab space in the cockpit.</> : <> and would open here as a tab.</>}
      </div>
    </div>
  );
}

window.Shell2 = { DIVISIONS, DivisionRail, DivisionSidebar, TabStrip, ThemeToggle, StubScreen, Stamp2 };
