// Altitude — the Rail × Cockpit synthesis.
//   A0 LINE  — role-aware rail (spine + queue). Home.
//   A1 SHEET — quick context, summoned from cards / spine / ⌘K.
//   A2 BOARD — the FULL cockpit-v2 board docked over the queue, with a
//              division › section breadcrumb and a "back to the line" strip
//              that always shows how many cards need you. Recent boards ride
//              as 3 transient chips — recency, not tab debt.
//   A3 ATLAS — the map: every division › section › board with a one-line doc,
//              searchable, launchable. Procedures + house rules live here too.
//   Esc always goes DOWN one altitude. ⌘K reaches everything from anywhere.
const DSa = window.LariatLaRiOSDesignSystem_5761b2;
const { BrandStamp: MarkA, Button: Ba, Pill: Pa, Tag: Ta, StatusDot: Da } = DSa;
const KITa = window.RailKit;
const RR = window.RailRoles;
const { DIVISIONS } = window.Shell2;

/* ── Full board routes (cockpit + cockpit-v2 screens, reused as-is) ── */
const Sc1 = window.Screens, S2 = window.Screens2;
const ROUTES = {
  'eighty-six': () => <Sc1.EightySixScreen />, temps: () => <Sc1.TempLogScreen />,
  inventory: () => <Sc1.InventoryScreen />, recipes: () => <Sc1.RecipesScreen />,
  beo: () => <Sc1.BeoScreen />, prep: () => <S2.PrepScreen />,
  specials: () => <S2.SpecialsScreen />, kds: () => <S2.KdsScreen />,
  cooling: () => <S2.CoolingScreen />, cleaning: () => <S2.CleaningScreen />,
  sanitizer: () => <S2.SanitizerScreen />, orderguide: () => <S2.OrderGuideScreen />,
  receiving: () => <S2.ReceivingScreen />, costing: () => <S2.CostingScreen />,
  tippool: () => <S2.TipPoolScreen />, breaks: () => <S2.BreaksScreen />,
  sick: () => <S2.SickLeaveScreen />, wage: () => <S2.WageNoticeScreen />,
  reviews: () => <S2.ReviewsScreen />, certs: () => <S2.CertsScreen />,
  goldstars: () => <S2.GoldStarsScreen />, audit: () => <S2.AuditScreen />,
  host: () => <S2.HostStandScreen />, floor: () => <S2.FloorScreen />,
  resos: () => <S2.ReservationsScreen />, bar: () => <S2.BarScreen />,
  tonight: () => <S2.TonightScreen />, stage: () => <S2.StageScreen />,
  sound: () => <S2.SoundScreen />, boxoffice: () => <S2.BoxOfficeScreen />,
  settlement: () => <S2.SettlementScreen />,
  'station:saute': () => <Sc1.StationScreen id="saute" />,
  'station:grill': () => <Sc1.StationScreen id="grill" />,
  'station:sauce': () => <Sc1.StationScreen id="sauce" />,
};

/* ── Sheet → full-board bridge (A1 → A2 promote) ── */
const SHEET_BOARD = {
  temps: 'temps', fire: 'beo', eightysix: 'eighty-six', breaks: 'breaks',
  stage: 'stage', linecheck: 'station:saute', prepsheet: 'prep',
  cooling: 'cooling', datemarks: 'cooling', sidework: 'cleaning',
  invoices: 'costing', playbook: 'tonight', offers: 'tonight',
  soundcheck: 'sound', spllog: 'sound', avx: 'stage',
};

/* ── Atlas documentation — one line per board, kitchen voice ── */
const DOCS = {
  today: "The rush home — this is the line itself. Takes you back down.",
  'eighty-six': "What's out right now. Add it the second it dies.",
  prep: "What to make, how much, by when.",
  specials: "Tonight's features and their counts.",
  'station:saute': "Line check + sign-off — Sauté.",
  'station:grill': "Line check + sign-off — Grill.",
  'station:sauce': "Line check + sign-off — Sauce.",
  kds: "Expo tickets by age.", host: "Seat, quote, page.",
  floor: "The room live — tables by state.",
  resos: "The book — covers by block, pre-show flags.",
  bar: "Bottles, kegs, prep vs par.",
  recipes: "Scale, allergens, method — the book.",
  beo: "Banquet sheets — prep, fire, demands.",
  orderguide: "What to order, by vendor. Prints.",
  temps: "CCP holds — log every check.",
  cooling: "Two-stage cooling logs.",
  cleaning: "Side work by area and frequency.",
  sanitizer: "Wells at 200 ppm, logged.",
  inventory: "Stock vs par with fill bars.",
  receiving: "At the door — reject over 41°.",
  costing: "Plate cost vs menu price.",
  tippool: "The split — hours × points.",
  breaks: "Rest + meal clocks.", sick: "Balances — accrued, used, left.",
  wage: "Rate notices on file.", reviews: "Who's due, who's overdue.",
  certs: "Food handler + ServSafe expiry.", goldstars: "Shout-outs. Give a star.",
  audit: "Every signed action. Read-only.",
  tonight: "Show night — doors, sets, curfew.",
  stage: "Room config + run of show.", sound: "Scenes + live SPL vs limit.",
  boxoffice: "Sold, scanned, at the door.",
  settlement: "The night's math — artist share. Prints.",
};

/* Procedures — documentation that launches the actual run (role+phase). */
const PROCEDURES = [
  { id: 'opening', name: 'Open the line', doc: "7a — temps → sanitizer → line checks → mise → sign-off." },
  { id: 'service', name: 'Run service', doc: "6p — the heat queue. Fires, holds, 86s." },
  { id: 'closing', name: 'Close the line', doc: "11p — TPHC → cooling → date marks → side work." },
];

function findCrumb(id) {
  for (const d of DIVISIONS) for (const s of d.sections) {
    const b = s.boards.find((x) => x.id === id);
    if (b) return { div: d, sec: s, b };
  }
  return null;
}

function AltitudeApp() {
  const [role, setRole] = React.useState('cook');
  const [phase, setPhase] = React.useState('service');
  const [theme, setTheme] = React.useState('iron');
  const [sheet, setSheet] = React.useState(null);
  const [board, setBoard] = React.useState(null);
  const [atlas, setAtlas] = React.useState(false);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [aq, setAq] = React.useState('');
  const [doneIds, setDone] = React.useState({});
  const [recent, setRecent] = React.useState([]);

  const SHEETS = { ...KITa.SHEETS, ...RR.EXTRA_SHEETS };

  const openBoard = (id) => {
    if (id === 'today') { // Today IS the line — A0. Descend all the way home.
      setBoard(null); setSheet(null); setAtlas(false); setPal(false);
      return;
    }
    if (!ROUTES[id]) return;
    setBoard(id); setSheet(null); setAtlas(false); setPal(false);
    setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 3));
  };

  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); }
      if (e.key === 'Escape') {
        if (pal) setPal(false);
        else if (atlas) setAtlas(false);
        else if (sheet) setSheet(null);
        else if (board) setBoard(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pal, atlas, sheet, board]);

  /* role model (same engine as the Rail) */
  const cook = RR.COOK[phase];
  const spine = role === 'cook' ? cook.spine : role === 'office' ? RR.OFFICE.spine : role === 'booking' ? RR.BOOKING.spine : role === 'stage' ? RR.STAGE.spine : KITa.SPINE;
  const clock = role === 'cook' ? cook.clock : role === 'office' ? RR.OFFICE.clock : role === 'booking' ? RR.BOOKING.clock : role === 'stage' ? RR.STAGE.clock : 'Fri · 6:38p — RUSH';
  const spineLabel = role === 'office' ? 'The week' : role === 'booking' ? 'The season' : role === 'stage' ? 'Show day' : 'The service day';

  let cards, qTitle, qSub, run = null;
  if (role === 'cook') {
    const steps = cook.steps.filter((s) => !doneIds[s.id] && !s.done);
    const total = cook.steps.length, done = total - steps.length;
    cards = steps; qTitle = cook.label;
    qSub = phase === 'service' ? `${steps.length} open · cook line only` : `step ${Math.min(done + 1, total)} of ${total}`;
    run = phase === 'service' ? null : { done, total };
  } else if (role === 'manager') {
    cards = KITa.QUEUE.filter((c) => !doneIds[c.id]); qTitle = 'Needs a human'; qSub = `${cards.length} open · whole house`;
  } else if (role === 'booking') {
    cards = RR.BOOKING.work.filter((c) => !doneIds[c.id]); qTitle = 'The pipeline'; qSub = `${cards.length} open · holds, on-sales, announces`;
  } else if (role === 'stage') {
    cards = RR.STAGE.work.filter((c) => !doneIds[c.id]); qTitle = 'The board'; qSub = `${cards.length} open · sound, stage, AVX`;
  } else {
    cards = RR.OFFICE.work.filter((c) => !doneIds[c.id]); qTitle = 'The workbench'; qSub = `${cards.length} open · deadlines, not clocks`;
  }
  const quiet = role === 'office' ? ['Payroll draft balanced', 'All certs current except Kai (flagged)', 'Cloud bridge synced 4:02p'] : role === 'booking' ? RR.BOOKING.quiet : role === 'stage' ? RR.STAGE.quiet : KITa.QUIET;

  /* ⌘K — every board + procedure + quick action */
  const PAL_ALL = [
    ...DIVISIONS.flatMap((d) => d.sections.flatMap((s) => s.boards.map((b) => ({ k: d.name, w: b.name, go: () => openBoard(b.id) })))),
    ...PROCEDURES.map((p) => ({ k: 'Run', w: p.name, go: () => { setRole('cook'); setPhase(p.id); setAtlas(false); setBoard(null); setPal(false); } })),
    ...KITa.PALETTE.filter((r) => r.k === 'Do').map((r) => ({ k: 'Do', w: r.w, go: () => { setSheet(r.sheet); setPal(false); } })),
    { k: 'Map', w: 'The Atlas — every board, documented', go: () => { setAtlas(true); setPal(false); } },
    { k: 'Set', w: 'Settings — this screen & house rules', go: () => { setSheet('settings'); setPal(false); } },
  ];

  const crumb = board ? findCrumb(board) : null;
  const Board = board ? ROUTES[board] : null;
  const Sh = sheet && sheet !== 'settings' ? SHEETS[sheet] : null;
  const mark = (id) => setDone((d) => ({ ...d, [id]: true }));

  const atlasMatch = (b) => !aq || b.name.toLowerCase().includes(aq.toLowerCase()) || (DOCS[b.id] || '').toLowerCase().includes(aq.toLowerCase());

  return (
    <div className={`rail-app ${theme === 'iron' ? 'iron' : ''}`}>
      <header className="rl-band">
        <span className="mark"><MarkA decorative /><span>The Lariat</span></span>
        <span className="rl-role">
          {[['cook', 'Cook'], ['manager', 'Mgr'], ['office', 'Office'], ['booking', 'Booking'], ['stage', 'Stage']].map(([k, l]) => (
            <button key={k} className={role === k ? 'on' : ''} onClick={() => { setRole(k); setSheet(null); setBoard(null); }}>{l}</button>
          ))}
        </span>
        {role === 'cook' && (
          <span className="rl-phase">
            {[['opening', '7a'], ['service', '6p'], ['closing', '11p']].map(([k, l]) => (
              <button key={k} className={phase === k ? 'on' : ''} onClick={() => { setPhase(k); setSheet(null); }} title="Simulate the clock">{l}</button>
            ))}
          </span>
        )}
        {(role === 'cook' || role === 'manager') && <span className="rl-stat hot"><b>3</b> 86'd</span>}
        {role === 'stage' && <span className="rl-stat"><b>96</b> dB · lim 100</span>}
        {role === 'booking' && <span className="rl-stat"><b>212</b>/240 tonight</span>}
        <span className="clock">{clock}</span>
        <button className={`rl-kbd alt-atlasbtn ${atlas ? 'on' : ''}`} onClick={() => setAtlas(!atlas)} title="The Atlas — every board, documented">Atlas</button>
        <button className="rl-kbd" onClick={() => setSheet('settings')} title="Settings">⚙</button>
        <button className="rl-kbd" onClick={() => setPal(true)}>⌘K</button>
      </header>

      <nav className="rl-spine">
        <div className="lbl">{spineLabel}</div>
        <div className="rl-track">
          {spine.map((s, i) =>
            s.t === 'NOW' ? <div key={i} className="rl-now" /> : (
              <button key={i} className={`rl-t ${s.state}`} onClick={() => s.sheet && setSheet(s.sheet)}>
                <span className="tt">{s.t}</span><span className="tw">{s.w}</span>
              </button>
            )
          )}
        </div>
      </nav>

      <main className="rl-queue">
        <div className="rl-qhead"><h1>{qTitle}</h1><span className="n">{qSub}</span></div>
        {run && (
          <div className="rl-run">
            <span className="rt">{cook.label}</span>
            <span className="track"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></span>
            <span className="rn">{run.done}/{run.total} done</span>
          </div>
        )}
        {cards.length === 0 && (
          <div className="rl-done"><b>{role === 'cook' ? (phase === 'closing' ? 'Line is closed.' : 'Line is open.') : 'All clear.'}</b>
            {role === 'cook' ? 'Get a manager sign-off and clock out.' : 'Nothing needs you right now.'}</div>
        )}
        {cards.map((c, i) => (
          <div key={c.id} className={`rl-card ${c.sev || ''} ${c.up || (role === 'cook' && phase !== 'service' && i === 0) ? 'up' : ''}`}>
            {role === 'cook' && phase !== 'service' && <span className="step">{cook.steps.findIndex((s) => s.id === c.id) + 1}</span>}
            <div className="body"><div className="t">{c.t}</div><div className="s">{c.s}</div></div>
            <span className="src">{c.src}</span>
            <div className="acts">
              {c.sheet && <Ba size="xs" variant="ghost" onClick={() => setSheet(c.sheet)}>Open</Ba>}
              {c.acts ? c.acts.map(([label, target], j) => (
                <Ba key={label} size="xs" variant={j === 0 ? (c.sev === 'crit' ? 'danger' : 'primary') : 'ghost'}
                  onClick={() => { if (target) setSheet(target); else mark(c.id); }}>{label}</Ba>
              )) : <Ba size="xs" variant="primary" onClick={() => mark(c.id)}>Done</Ba>}
              {c.acts && <Ba size="xs" variant="ghost" onClick={() => mark(c.id)}>Done</Ba>}
            </div>
          </div>
        ))}
        {role === 'manager' && (
          <div style={{ marginTop: 18 }}>
            <div className="rl-quiet"><div className="qh">Needs your PIN</div></div>
            {RR.APPROVALS.filter((a) => !doneIds[a.id]).map((a) => (
              <div key={a.id} className="rl-card rl-approve">
                <div className="body"><div className="t">{a.t}</div><div className="s">{a.s}</div></div>
                <span className="pin">PIN</span>
                <div className="acts">
                  <Ba size="xs" variant="primary" onClick={() => mark(a.id)}>Approve</Ba>
                  <Ba size="xs" variant="ghost" onClick={() => mark(a.id)}>Deny</Ba>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="rl-quiet">
          <div className="qh">Quiet — no action needed</div>
          {quiet.map((w) => <div key={w} className="qrow"><Da tone="ok" size={7} />{w}</div>)}
        </div>
      </main>

      {/* A2 — docked full board */}
      {Board && crumb && (
        <section className="alt-dock">
          <div className="alt-return">
            <button className="alt-back" onClick={() => setBoard(null)}>← The line{cards.length > 0 && <span className="n">{cards.length} need you</span>}</button>
            <span className="alt-crumb">{crumb.div.name}<span className="sep">›</span>{crumb.sec.name}<span className="sep">›</span><span className="here">{crumb.b.name}</span></span>
            <span className="alt-recent">
              <span className="lbl">Recent</span>
              {recent.map((id) => {
                const c = findCrumb(id);
                return c && <button key={id} className={`alt-rtab ${id === board ? 'on' : ''}`} onClick={() => openBoard(id)}>{c.b.name}</button>;
              })}
            </span>
          </div>
          <div className="alt-boardwrap"><Board /></div>
        </section>
      )}

      {/* A1 — sheet (rides above the dock) */}
      {sheet === 'settings' ? (
        <aside className="rl-sheet">
          <div className="sh-head"><span className="t">Settings</span><Ta>esc</Ta><button className="rl-x" onClick={() => setSheet(null)}>×</button></div>
          <div className="sh-body"><RR.SettingsSheet theme={theme} setTheme={setTheme} role={role} setRole={setRole} /></div>
        </aside>
      ) : Sh && (
        <aside className="rl-sheet">
          <div className="sh-head">
            <span className="t">{Sh.title}</span>
            {SHEET_BOARD[sheet] && ROUTES[SHEET_BOARD[sheet]] && (
              <button className="alt-promote" onClick={() => openBoard(SHEET_BOARD[sheet])} title="Open the full board behind this sheet">Full board ↗</button>
            )}
            <Ta>esc</Ta>
            <button className="rl-x" onClick={() => setSheet(null)}>×</button>
          </div>
          <div className="sh-body"><Sh.C /></div>
        </aside>
      )}

      {/* A3 — the Atlas */}
      {atlas && (
        <section className="alt-atlas">
          <div className="alt-atlas-head">
            <h1>The Atlas</h1>
            <span className="sub">every board · one map · esc to descend</span>
            <input autoFocus placeholder="Search boards + docs…" value={aq} onChange={(e) => setAq(e.target.value)} />
          </div>
          <div className="alt-divgrid">
            {DIVISIONS.map((d) => {
              const secs = d.sections.map((s) => ({ ...s, boards: s.boards.filter(atlasMatch) })).filter((s) => s.boards.length);
              const isLine = d.id === 'service';
              const procs = isLine ? PROCEDURES.filter((p) => !aq || p.name.toLowerCase().includes(aq.toLowerCase()) || p.doc.toLowerCase().includes(aq.toLowerCase())) : [];
              if (!secs.length && !procs.length) return null;
              const count = d.sections.reduce((n, s) => n + s.boards.length, 0);
              return (
                <div key={d.id} className="alt-div">
                  <div className="alt-div-h"><span className="g">{d.glyph}</span><span className="t">{d.name}</span><span className="c">{count} boards</span></div>
                  {secs.map((s) => (
                    <div key={s.name} className="alt-sec">
                      <div className="sh">{s.name}</div>
                      {s.boards.map((b) => (
                        <button key={b.id} className="alt-entry" onClick={() => openBoard(b.id)}>
                          <span className="n">{b.name}</span>
                          {b.win && <span className="w">⧉ WALL</span>}
                          <span className="d">{DOCS[b.id] || ''}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                  {procs.length > 0 && (
                    <div className="alt-sec">
                      <div className="sh">Procedures</div>
                      {procs.map((p) => (
                        <button key={p.id} className="alt-entry" onClick={() => { setRole('cook'); setPhase(p.id); setAtlas(false); setBoard(null); }}>
                          <span className="n">{p.name}</span><span className="p">RUN</span><span className="d">{p.doc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {d.id === 'office' && (
                    <div className="alt-sec">
                      <div className="sh">House rules</div>
                      <button className="alt-entry" onClick={() => { setAtlas(false); setSheet('settings'); }}>
                        <span className="n">Holds · breaks · tip split</span><span className="p">PIN</span><span className="d">The numbers the queue engine runs on.</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ⌘K */}
      {pal && (
        <div className="rl-veil" onClick={() => setPal(false)}>
          <div className="rl-pal" onClick={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Board, run, or thing to do — '86 trout', 'costing', 'open the line'…" value={q} onChange={(e) => setQ(e.target.value)} />
            {PAL_ALL.filter((r) => r.w.toLowerCase().includes(q.toLowerCase())).slice(0, 9).map((r) => (
              <div key={r.k + r.w} className="row" onClick={r.go}>
                <span className="k">{r.k}</span>{r.w}<span className="hint">↵</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.AltitudeApp = AltitudeApp;
