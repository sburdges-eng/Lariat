// Service Rail v2 — role-aware. One system, three lenses:
//   COOK    — procedure-driven. The clock picks the run (opening / service /
//             closing); cards are steps in order; sheets carry the detail.
//   MANAGER — exception-driven. Full heat queue + PIN-gated approvals.
//   OFFICE  — batch-driven. A week spine and a deadline workbench, no rush UI.
const DSv = window.LariatLaRiOSDesignSystem_5761b2;
const { BrandStamp: MarkV, Button: Bv, Pill: Pv, Tag: Tv, StatusDot: Dv, Field: Fv, Input: Iv, DataTable: TableV } = DSv;
const KIT = window.RailKit;

/* ══ COOK — procedure runs by daypart ══ */
const COOK = {
  opening: {
    label: 'Open the line', clock: 'Fri · 7:40a — OPENING',
    spine: [
      { t: '7:00a', w: 'Walk-in + holds temped', state: 'past', sheet: 'temps' },
      { t: '7:30a', w: 'Sanitizer wells mixed', state: 'past' },
      { t: 'NOW' },
      { t: '8:00a', w: 'Line checks — all stations', state: 'now', sheet: 'linecheck' },
      { t: '9:00a', w: 'Mise pull from walk-in', state: 'next' },
      { t: '10:00a', w: 'Prep board — first pass', state: 'next' },
      { t: '10:45a', w: 'Pre-open sign-off', state: 'next' },
      { t: '11:00a', w: 'Doors', state: 'crit' },
    ],
    steps: [
      { id: 'o1', done: true, t: 'Temp the walk-in + every hold', s: 'Walk-in 38° · freezer 2° · reach-ins logged.', src: 'Temp log', sheet: 'temps' },
      { id: 'o2', done: true, t: 'Mix sanitizer wells — 200 ppm', s: 'All five wells logged in range.', src: 'Sanitizer' },
      { id: 'o3', t: 'Run the Sauté line check', s: '6 checks — pans, mise dates, sauce temps, backups.', src: 'Stations', sheet: 'linecheck', up: true },
      { id: 'o4', t: 'Run the Grill line check', s: '6 checks — grates, tallow, proteins tempered.', src: 'Stations', sheet: 'linecheck' },
      { id: 'o5', t: 'Pull mise per prep board', s: 'Purée ×2, demi, brine bucket, chicories.', src: 'Prep', sheet: 'prepsheet' },
      { id: 'o6', t: 'Sign off the line', s: 'All stations green before doors at 11:00a.', src: 'Today' },
    ],
  },
  service: {
    label: 'Service', clock: 'Fri · 6:38p — RUSH',
    spine: KIT.SPINE,
    steps: [
      { id: 's1', sev: 'crit', t: 'Hot hold — soup at 128°', s: 'Below 135° for 9 min. Reheat to 165° or toss.', src: 'Temp log', sheet: 'temps' },
      { id: 's2', sev: 'info', t: 'Fire mains in 22 min', s: '96 rib · 32 trout · 12 risotto — pull backups now.', src: 'BEO', sheet: 'fire' },
      { id: 's3', sev: 'warn', t: 'Ribeye at 12 of 40 par', s: 'Tell the window before it cascades.', src: 'Stock', sheet: 'eightysix' },
    ],
  },
  closing: {
    label: 'Close the line', clock: 'Fri · 11:05p — CLOSE',
    spine: [
      { t: '10:00p', w: 'Last seating', state: 'past' },
      { t: '10:30p', w: 'TPHC discard check', state: 'past', sheet: 'temps' },
      { t: 'NOW' },
      { t: '11:00p', w: 'Cooling — into the log', state: 'now', sheet: 'cooling' },
      { t: '11:15p', w: 'Date-mark everything held', state: 'next', sheet: 'datemarks' },
      { t: '11:30p', w: 'Side work by station', state: 'next', sheet: 'sidework' },
      { t: '12:00a', w: 'Manager sign-off', state: 'crit' },
    ],
    steps: [
      { id: 'c1', done: true, t: 'Discard TPHC items past 4 hours', s: 'Butter board + aioli tossed, logged 10:32p.', src: 'TPHC' },
      { id: 'c2', t: 'Start cooling logs', s: 'Demi 8qt + braise liquid 12qt into the two-stage log.', src: 'Cooling', sheet: 'cooling', up: true },
      { id: 'c3', t: 'Date-mark holds for tomorrow', s: 'Everything wrapped gets a day dot — 7-day max.', src: 'Date marks', sheet: 'datemarks' },
      { id: 'c4', t: 'Station side work', s: 'Slicer teardown · hood wipe · drains · rag buckets out.', src: 'Cleaning', sheet: 'sidework' },
      { id: 'c5', t: 'Flag anything 86\u2019d for the morning', s: 'Ribeye + trout stay out until Shamrock lands.', src: '86 board', sheet: 'eightysix' },
    ],
  },
};

/* ══ OFFICE — week spine + deadline workbench ══ */
const OFFICE = {
  clock: 'Fri · Nov 14 — WEEK 46',
  spine: [
    { t: 'MON', w: 'Invoices in — match 3', state: 'past', sheet: 'invoices' },
    { t: 'TUE', w: 'Sysco order out', state: 'past' },
    { t: 'WED', w: 'Shamrock delivery', state: 'past' },
    { t: 'NOW' },
    { t: 'FRI', w: 'Payroll + tip pool close', state: 'now', sheet: 'invoices' },
    { t: 'SAT', w: 'BEO #241122 — Harvest dinner', state: 'next', sheet: 'fire' },
    { t: 'SUN', w: 'Inventory full count', state: 'next' },
    { t: 'THU', w: 'Order guide due 2:00p', state: 'crit' },
  ],
  work: [
    { id: 'w1', sev: 'warn', t: '3 invoices to match', s: 'Sysco ×2, Shamrock ×1 — $2,214.66 against receiving.', src: 'Invoices', sheet: 'invoices' },
    { id: 'w2', sev: 'warn', t: 'BEO needs final counts by 5p', s: 'Hillside Farm guarantee locks at 140 — kitchen is planning on it.', src: 'BEO', sheet: 'fire' },
    { id: 'w3', sev: 'info', t: '2 wage notices to issue', s: 'Dev (rate change) + Marta (new hire).', src: 'People' },
    { id: 'w4', sev: 'info', t: 'Rosa\u2019s review is overdue', s: 'Last review Aug 2025 — book 30 min pre-shift.', src: 'Reviews' },
    { id: 'w5', sev: 'info', t: 'Price shock: trout +9%', s: 'Shamrock moved $8.90 → $9.70/lb. Costing shifts to 30.6%.', src: 'Costing' },
  ],
};

/* ══ BOOKING (Lauren) — the season spine + pipeline workbench ══ */
const BOOKING = {
  clock: 'Fri · Nov 14 — SEASON',
  spine: [
    { t: 'NOV 14', w: 'Wrenfield & The Coyotes · tonight', state: 'now', sheet: 'stage' },
    { t: 'NOV 15', w: 'Harvest dinner · private buyout', state: 'next', sheet: 'fire' },
    { t: 'NOV 21', w: 'High Lonesome — announce', state: 'next', sheet: 'playbook' },
    { t: 'NOV 22', w: 'Cold River Ramblers', state: 'next' },
    { t: 'NOW' },
    { t: 'DEC 5', w: 'On-sale — NYE show', state: 'crit', sheet: 'playbook' },
    { t: 'DEC 12', w: 'Hold · Sage & The Saddle', state: 'next', sheet: 'offers' },
    { t: 'DEC 31', w: 'NYE — The Del Rios', state: 'next' },
  ],
  work: [
    { id: 'b1', sev: 'crit', t: 'Offer expires tomorrow — Sage & The Saddle', s: '$1,200 vs door 70/30 · Dec 12 hold. Agent needs an answer.', src: 'Booking', sheet: 'offers' },
    { id: 'b2', sev: 'warn', t: 'NYE on-sale goes live Dec 5', s: 'Price advance $45 / door $55 — playbook + socials not scheduled yet.', src: 'Playbook', sheet: 'playbook' },
    { id: 'b3', sev: 'warn', t: 'Tonight is at 88% — push the last 28', s: '212 of 240 sold. One story + the marquee board tonight.', src: 'Box office' },
    { id: 'b4', sev: 'info', t: 'High Lonesome announce Fri', s: 'Assets in — needs the announce post + email blast queued.', src: 'Playbook', sheet: 'playbook' },
    { id: 'b5', sev: 'info', t: 'W-9 + contract back from Cold River', s: 'Countersign and file before advance call Monday.', src: 'Booking' },
  ],
  quiet: ['Tonight settled projection: $3,490 to artist', 'Del Rios contract countersigned', 'Radio spot running through Nov 21'],
};

/* ══ STAGE (Steve) — show-day tech run + live room ══ */
const STAGE = {
  clock: 'Fri · 6:38p — DOORS 7:00p',
  spine: [
    { t: '3:00p', w: 'AVX power-up + line check', state: 'past', sheet: 'avx' },
    { t: '4:00p', w: 'Load-in — Coyotes (5 pc)', state: 'past' },
    { t: '5:00p', w: 'Stage set — mixed rail config', state: 'past', sheet: 'stage' },
    { t: '6:00p', w: 'Soundcheck — full band', state: 'past', sheet: 'soundcheck' },
    { t: 'NOW' },
    { t: '7:00p', w: 'Doors — scene 2 · house 40%', state: 'now', sheet: 'spllog' },
    { t: '8:00p', w: 'Set one · recall Coyotes v3', state: 'next', sheet: 'spllog' },
    { t: '9:20p', w: 'Set two · encore patch live', state: 'next' },
    { t: '10:30p', w: 'Curfew — hard out · strike', state: 'crit', sheet: 'avx' },
  ],
  work: [
    { id: 't1', sev: 'warn', t: 'SPL trending 98 against a 100 limit', s: 'Two readings running arms the warn light — trim the mains 2 dB before set one.', src: 'SPL log', sheet: 'spllog' },
    { id: 't2', sev: 'warn', t: 'Monitor 3 buzzing on the DI', s: 'Swap the DI or lift the ground before doors.', src: 'Soundcheck', sheet: 'soundcheck' },
    { id: 't3', sev: 'info', t: 'Recall scene — Doors / playlist 2', s: 'House playlist, wash at 40%, marquee on.', src: 'Scenes', sheet: 'soundcheck' },
    { id: 't4', sev: 'info', t: 'Confirm stream feed for NYE promo', s: 'AVX matrix out 2 → lobby screen; test 30s capture.', src: 'AVX', sheet: 'avx' },
  ],
  quiet: ['Backline set — house kit + 2 DIs', 'Scenes saved: soundcheck · set 1 · set 2 · doors', 'SPL logging every 5s to the show record'],
};

/* ══ MANAGER — full queue + approvals ══ */
const APPROVALS = [
  { id: 'a1', t: 'Rest-break waiver — Kai O.', s: 'Missed the 10-min rest. Waiver needs your PIN or send him now.', src: 'Breaks' },
  { id: 'a2', t: 'Void check #238 — $64.00', s: 'Rung wrong table. Second void tonight.', src: 'POS' },
];

/* ══ Extra sheets ══ */
function ChecklistSheet({ items }) {
  const [rows, setRows] = React.useState(items.map((w, i) => ({ id: i, w, done: false })));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.id} className={`rl-chk ${r.done ? 'done' : ''}`}>
          <Dv tone={r.done ? 'ok' : 'muted'} size={9} />
          <span className="w">{r.w}</span>
          {!r.done && <Bv size="xs" onClick={() => setRows(rows.map((x) => x.id === r.id ? { ...x, done: true } : x))}>Done</Bv>}
        </div>
      ))}
    </div>
  );
}
const EXTRA_SHEETS = {
  linecheck: { title: 'Sauté — line check', C: () => <ChecklistSheet items={['Pans oiled & staged', 'Mise labeled + dated', 'Sauce holding 140°+', 'Backups pulled', 'Station wiped + sanitized', 'Rag bucket 200 ppm']} /> },
  prepsheet: { title: 'Mise pull — this morning', C: () => <ChecklistSheet items={['Pommes purée ×2 batches', 'Demi-glace, 2qt', 'Brine bucket to station', 'Chicories washed + picked', 'Trout portioned 6oz']} /> },
  cooling: { title: 'Cooling — two-stage log', C: () => <ChecklistSheet items={['Demi 8qt — in at 11:02p, 96°', 'Braise liquid 12qt — in at 11:04p, 104°', 'Set 12:45a check alarm']} /> },
  datemarks: { title: 'Date marks — tonight', C: () => <ChecklistSheet items={['Braised rib portions — day dot SUN', 'Purée 1/6 pans ×2 — day dot WED', 'Vinaigrette qt — day dot THU', 'Toss anything unlabeled']} /> },
  sidework: { title: 'Side work — close', C: () => <ChecklistSheet items={['Slicer teardown + sanitize', 'Hood + flat-top wipe', 'Floor drains — dish pit', 'Rag buckets emptied', 'Trash out · mats hosed']} /> },
  invoices: { title: 'Invoices — to match', C: () => <ChecklistSheet items={['Sysco #88121 — $1,204.18 vs receiving', 'Sysco #88144 — $412.02 vs receiving', 'Shamrock #5521 — $598.46 · 1 short noted']} /> },
  playbook: { title: 'Playbook — NYE on-sale', C: () => <ChecklistSheet items={['Announce post — Dec 1, 10a', 'Email blast — Dec 5, 9a', 'On-sale link live — Dec 5, 10a', 'Marquee board copy', 'Radio spot ×2 weeks', 'Advance $45 / door $55 confirmed']} /> },
  offers: { title: 'Offer — Sage & The Saddle', C: () => <ChecklistSheet items={['Guarantee $1,200 + 70/30 after door', 'Dec 12 · seated cabaret · cap 120', 'Backline: house kit OK', 'Lodging: 2 rooms · The Surf', 'Reply to agent — expires Sat']} /> },
  soundcheck: { title: 'Soundcheck — full band', C: () => <ChecklistSheet items={['Line check — 24 ch · 6 mon', 'Kick + snare gate thresholds', 'Vox verb — plate, short', 'Monitor 3 DI buzz — swap/lift', 'Save scene: Coyotes v3']} /> },
  spllog: { title: 'SPL — decibel log', C: () => <ChecklistSheet items={['Limit tonight: 100 dB(A) — scene set 1', 'Now: 96–98 trending near limit', 'Log reading · auto every 5s', 'Over-limit ×2 arms the warn light', 'Trim mains −2 dB if it rides 99+']} /> },
  avx: { title: 'AVX — house systems', C: () => <ChecklistSheet items={['Amps on — racks A/B green', 'Matrix: out 1 mains · out 2 lobby', 'Projector + marquee on schedule', 'Stream capture 30s test', 'Strike: amps → desk → racks, in order']} /> },
};

/* ══ Settings — a sheet, not a page. Role-scoped: device stuff is open;
   house rules are PIN-gated; show settings appear for stage/booking/mgr. ══ */
function SettingsSheet({ theme, setTheme, role, setRole }) {
  const Seg = ({ options, value, onPick }) => (
    <span className="rl-role" style={{ marginLeft: 0 }}>
      {options.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} onClick={() => onPick(k)}>{l}</button>
      ))}
    </span>
  );
  const Row = ({ k, small, children, pin }) => (
    <div className="rl-set">
      <span className="k">{k}{small && <small>{small}</small>}</span>
      {pin && <span className="pin" style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '.14em', color: 'var(--accent)', border: '1px dashed var(--accent)', borderRadius: 2, padding: '2px 6px', fontWeight: 700 }}>PIN</span>}
      {children}
    </div>
  );
  return (
    <div>
      <div className="rl-set-h">This screen</div>
      <Row k="Lens" small="Who this screen works for. Stays set on this device.">
        <Seg options={[['cook', 'Cook'], ['manager', 'Mgr'], ['stage', 'Stage']]} value={role} onPick={setRole} />
      </Row>
      <Row k="Theme" small="Iron — neutral charcoal · Ledger — warm char">
        <Seg options={[['iron', 'Iron'], ['ledger', 'Ledger']]} value={theme} onPick={setTheme} />
      </Row>
      <Row k="Room" small="Boards and counts scope to this room."><span className="v">Main room</span><Bv size="xs" variant="ghost">Change</Bv></Row>

      <div className="rl-set-h">House rules</div>
      <Row k="Cold hold limit" pin><span className="v">41°F</span></Row>
      <Row k="Hot hold limit" pin><span className="v">135°F</span></Row>
      <Row k="Break rule" small="30 min meal per 5h · 10 min rest per 4h" pin><span className="v">CO default</span></Row>
      <Row k="Tip split" small="Pool = hours × role points" pin><span className="v">hours × points</span></Row>
      <Row k="Par templates" small="Stock + bar pars by season" pin><Bv size="xs" variant="ghost">Open</Bv></Row>

      <div className="rl-set-h">Tonight's show</div>
      <Row k="SPL limit" small="Two over-limit readings arm the warn light"><span className="v">100 dB(A)</span><Bv size="xs" variant="ghost">Edit</Bv></Row>
      <Row k="Curfew" small="Hard out — strike follows"><span className="v">10:30p</span></Row>

      <div className="rl-set-h">System</div>
      <Row k="Cloud bridge" small="Last synced 4:02p"><span className="v" style={{ color: 'var(--ok)' }}>● connected</span></Row>
      <Row k="Version"><span className="v">LariatOS v2.4 · rail concept</span></Row>
    </div>
  );
}

/* ══ App ══ */
function RailApp2() {
  const [role, setRole] = React.useState('cook');
  const [theme, setTheme] = React.useState('iron');
  const [phase, setPhase] = React.useState('opening');
  const [sheet, setSheet] = React.useState(null);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [doneIds, setDoneIds] = React.useState({});

  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); }
      if (e.key === 'Escape') { setPal(false); setSheet(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const SHEETS = { ...KIT.SHEETS, ...EXTRA_SHEETS };
  const Sh = sheet ? SHEETS[sheet] : null;
  const mark = (id) => setDoneIds((d) => ({ ...d, [id]: true }));

  // role model
  const cook = COOK[phase];
  const spine = role === 'cook' ? cook.spine : role === 'office' ? OFFICE.spine : role === 'booking' ? BOOKING.spine : role === 'stage' ? STAGE.spine : KIT.SPINE;
  const clock = role === 'cook' ? cook.clock : role === 'office' ? OFFICE.clock : role === 'booking' ? BOOKING.clock : role === 'stage' ? STAGE.clock : 'Fri · 6:38p — RUSH';
  const spineLabel = role === 'office' ? 'The week' : role === 'booking' ? 'The season' : role === 'stage' ? 'Show day' : 'The service day';

  let cards, qTitle, qSub, run = null;
  if (role === 'cook') {
    const steps = cook.steps.filter((s) => !doneIds[s.id] && !s.done);
    const total = cook.steps.length;
    const done = total - steps.length;
    cards = steps;
    qTitle = cook.label;
    qSub = phase === 'service' ? `${steps.length} open · cook line only` : `step ${Math.min(done + 1, total)} of ${total}`;
    run = phase === 'service' ? null : { done, total };
  } else if (role === 'manager') {
    cards = KIT.QUEUE.filter((c) => !doneIds[c.id]);
    qTitle = 'Needs a human';
    qSub = `${cards.length} open · whole house`;
  } else if (role === 'booking') {
    cards = BOOKING.work.filter((c) => !doneIds[c.id]);
    qTitle = 'The pipeline';
    qSub = `${cards.length} open · holds, on-sales, announces`;
  } else if (role === 'stage') {
    cards = STAGE.work.filter((c) => !doneIds[c.id]);
    qTitle = 'The board';
    qSub = `${cards.length} open · sound, stage, AVX`;
  } else {
    cards = OFFICE.work.filter((c) => !doneIds[c.id]);
    qTitle = 'The workbench';
    qSub = `${cards.length} open · deadlines, not clocks`;
  }

  return (
    <div className={`rail-app ${theme === 'iron' ? 'iron' : ''}`}>
      <header className="rl-band">
        <span className="mark"><MarkV decorative /><span>The Lariat</span></span>
        <span className="rl-role">
          {[['cook', 'Cook'], ['manager', 'Mgr'], ['office', 'Office'], ['booking', 'Booking'], ['stage', 'Stage']].map(([k, l]) => (
            <button key={k} className={role === k ? 'on' : ''} onClick={() => { setRole(k); setSheet(null); }}>{l}</button>
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
        {role === 'manager' && <span className="rl-stat"><b>4</b> on shift</span>}
        {role === 'office' && <span className="rl-stat"><b>$1.5k</b> order due</span>}
        {role === 'booking' && <span className="rl-stat"><b>212</b>/240 tonight</span>}
        {role === 'booking' && <span className="rl-stat"><b>2</b> holds open</span>}
        {role === 'stage' && <span className="rl-stat"><b>96</b> dB · lim 100</span>}
        {role === 'stage' && <span className="rl-stat"><b>24</b> ch live</span>}
        <span className="clock">{clock}</span>
        <button className="rl-kbd" onClick={() => setSheet('settings')} title="Settings">⚙</button>
        <button className="rl-kbd" onClick={() => setPal(true)}>⌘K — find or do anything</button>
      </header>

      <nav className="rl-spine">
        <div className="lbl">{spineLabel}</div>
        <div className="rl-track">
          {spine.map((s, i) =>
            s.t === 'NOW' ? <div key={i} className="rl-now" /> : (
              <button key={i} className={`rl-t ${s.state}`} onClick={() => s.sheet && setSheet(s.sheet)}>
                <span className="tt">{s.t}</span>
                <span className="tw">{s.w}</span>
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
            <div className="body">
              <div className="t">{c.t}</div>
              <div className="s">{c.s}</div>
            </div>
            <span className="src">{c.src}</span>
            <div className="acts">
              {c.sheet && <Bv size="xs" variant="ghost" onClick={() => setSheet(c.sheet)}>Open</Bv>}
              {c.acts ? c.acts.map(([label, target], j) => (
                <Bv key={label} size="xs" variant={j === 0 ? (c.sev === 'crit' ? 'danger' : 'primary') : 'ghost'}
                  onClick={() => { if (target) setSheet(target); else mark(c.id); }}>{label}</Bv>
              )) : <Bv size="xs" variant="primary" onClick={() => mark(c.id)}>Done</Bv>}
              {c.acts && <Bv size="xs" variant="ghost" onClick={() => mark(c.id)}>Done</Bv>}
            </div>
          </div>
        ))}

        {role === 'manager' && (
          <div style={{ marginTop: 18 }}>
            <div className="rl-quiet"><div className="qh">Needs your PIN</div></div>
            {APPROVALS.filter((a) => !doneIds[a.id]).map((a) => (
              <div key={a.id} className="rl-card rl-approve">
                <div className="body"><div className="t">{a.t}</div><div className="s">{a.s}</div></div>
                <span className="pin">PIN</span>
                <div className="acts">
                  <Bv size="xs" variant="primary" onClick={() => mark(a.id)}>Approve</Bv>
                  <Bv size="xs" variant="ghost" onClick={() => mark(a.id)}>Deny</Bv>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="rl-quiet">
          <div className="qh">Quiet — no action needed</div>
          {(role === 'office' ? ['Payroll draft balanced', 'All certs current except Kai (flagged)', 'Cloud bridge synced 4:02p'] : role === 'booking' ? BOOKING.quiet : role === 'stage' ? STAGE.quiet : KIT.QUIET).map((w) => (
            <div key={w} className="qrow"><Dv tone="ok" size={7} />{w}</div>
          ))}
        </div>
      </main>

      {sheet === 'settings' ? (
        <aside className="rl-sheet">
          <div className="sh-head">
            <span className="t">Settings</span>
            <Tv>esc</Tv>
            <button className="rl-x" onClick={() => setSheet(null)}>×</button>
          </div>
          <div className="sh-body"><SettingsSheet theme={theme} setTheme={setTheme} role={role} setRole={setRole} /></div>
        </aside>
      ) : Sh && (
        <aside className="rl-sheet">
          <div className="sh-head">
            <span className="t">{Sh.title}</span>
            <Tv>esc</Tv>
            <button className="rl-x" onClick={() => setSheet(null)}>×</button>
          </div>
          <div className="sh-body"><Sh.C /></div>
        </aside>
      )}

      {pal && (
        <div className="rl-veil" onClick={() => setPal(false)}>
          <div className="rl-pal" onClick={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Find a board, or do a thing — '86 trout', 'log temp'…" value={q} onChange={(e) => setQ(e.target.value)} />
            {KIT.PALETTE.filter((r) => r.w.toLowerCase().includes(q.toLowerCase())).map((r) => (
              <div key={r.w} className="row" onClick={() => { setSheet(r.sheet); setPal(false); setQ(''); }}>
                <span className="k">{r.k}</span>{r.w}<span className="hint">↵</span>
              </div>
            ))}
            {'settings'.includes(q.toLowerCase()) && (
              <div className="row" onClick={() => { setSheet('settings'); setPal(false); setQ(''); }}>
                <span className="k">Set</span>Settings — this screen & house rules<span className="hint">↵</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

window.RailApp2 = RailApp2;
window.RailRoles = { COOK, OFFICE, BOOKING, STAGE, APPROVALS, EXTRA_SHEETS, SettingsSheet };
