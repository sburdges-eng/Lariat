// Service Rail concept — time spine + attention queue + transient sheets + ⌘K.
const DSr = window.LariatLaRiOSDesignSystem_5761b2;
const { BrandStamp: Mark, Button: B, Pill: P, Tag: T, StatusDot: D, Bar: BarR, DataTable: TableR, Field: F, Input: I } = DSr;

const SPINE = [
  { t: '3:00p', w: 'Prep list done', state: 'past' },
  { t: '4:30p', w: 'Stock counts', state: 'past' },
  { t: '5:45p', w: 'Fire — pass apps', state: 'past', sheet: 'fire' },
  { t: '6:30p', w: 'Fire — first course', state: 'past', sheet: 'fire' },
  { t: 'NOW' },
  { t: '7:00p', w: 'Doors — scene 2', state: 'now', sheet: 'stage' },
  { t: '7:05p', w: 'Fire — mains', state: 'next', sheet: 'fire' },
  { t: '8:00p', w: 'Break — Dev T.', state: 'next', sheet: 'breaks' },
  { t: '8:15p', w: 'Fire — sweet', state: 'next', sheet: 'fire' },
  { t: '8:30p', w: 'Temp walk', state: 'next', sheet: 'temps' },
  { t: '10:30p', w: 'Curfew — hard out', state: 'crit', sheet: 'stage' },
];

const QUEUE = [
  { id: 1, sev: 'crit', t: 'Hot hold — soup at 128°', s: 'Below 135° for 9 min. Reheat to 165° or toss.', src: 'Temp log', acts: [['Fix it', 'temps'], ['Log', 'temps']] },
  { id: 2, sev: 'crit', t: 'Kai missed the 10-min rest', s: 'On shift 4h at 8:00p — break or signed waiver required.', src: 'Breaks', acts: [['Start break', null], ['Waive', 'breaks']] },
  { id: 3, sev: 'warn', t: 'Ribeye at 12 of 40 par', s: '86 cascade would hit Steak frites + Surf & turf.', src: 'Stock', acts: [['86 watch', 'eightysix'], ['Order', null]] },
  { id: 4, sev: 'warn', t: 'Bright · 8 needs the check by 8:30', s: 'Pre-show table — kitchen pacing on mains now.', src: 'Floor', acts: [['Tell station', null]] },
  { id: 5, sev: 'info', t: 'Fire mains in 22 min', s: '96 rib · 32 trout · 12 risotto — pull backups now.', src: 'BEO', acts: [['Fire sheet', 'fire']] },
  { id: 6, sev: 'info', t: 'SPL trending near limit', s: '98 dB(A) against a 100 limit — set two starts at 9:20.', src: 'Sound', acts: [['Sound', null]] },
];

const QUIET = ['Sauté signed off — 6/6', 'Sanitizer wells logged, all in range', 'Shamrock delivery accepted at 3:14p', 'Walk-in holding 38°'];

const PALETTE = [
  { k: 'Board', w: 'Temp log', sheet: 'temps' },
  { k: 'Board', w: '86 board', sheet: 'eightysix' },
  { k: 'Board', w: 'Fire schedule — Harvest dinner', sheet: 'fire' },
  { k: 'Board', w: 'Breaks & leave', sheet: 'breaks' },
  { k: 'Board', w: 'Stage — run of show', sheet: 'stage' },
  { k: 'Do', w: '86 an item…', sheet: 'eightysix' },
  { k: 'Do', w: 'Log a temp…', sheet: 'temps' },
];

/* ── Sheets — transient boards ── */
function SheetTemps() {
  const rows = [
    { id: 1, n: 'Hot hold, soup', v: '128°F', tone: 'alert', s: 'Below 135°' },
    { id: 2, n: 'Walk-in cooler', v: '38°F', tone: 'ok', s: 'In range' },
    { id: 3, n: 'Reach-in, line', v: '41°F', tone: 'warn', s: 'At limit' },
    { id: 4, n: 'Freezer', v: '2°F', tone: 'ok', s: 'In range' },
  ];
  return (
    <div>
      <TableR
        columns={[{ key: 'n', label: 'Hold' }, { key: 'v', label: 'Temp', align: 'right' }, { key: 's', label: '', align: 'right' }]}
        rows={rows.map((r) => ({ id: r.id, n: r.n, v: r.v, s: <P tone={r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'} dot>{r.s}</P> }))}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><F label="Log a temp"><I placeholder="e.g. Hot hold 165" /></F></div>
        <B variant="primary">Log</B>
      </div>
    </div>
  );
}
function SheetFire() {
  const rows = [
    { c: 'Mains', at: '7:05p', w: '96 rib · 32 trout · 12 risotto', tone: 'warn' },
    { c: 'Sweet', at: '8:15p', w: '140 custard — torch at pass', tone: 'neutral' },
  ];
  return (
    <div>
      {rows.map((r) => (
        <div key={r.c} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '10px 2px', borderBottom: '1px solid var(--hair)' }}>
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: r.tone === 'warn' ? 'var(--metal)' : 'var(--text-muted)', width: 52 }}>{r.at}</span>
          <span style={{ flex: 1 }}><b style={{ color: 'var(--text)' }}>{r.c}</b><div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{r.w}</div></span>
          <P tone={r.tone === 'warn' ? 'warn' : 'neutral'} dot>{r.tone === 'warn' ? 'Fire soon' : 'Upcoming'}</P>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>Full sheet lives on the BEO — this is tonight's slice.</div>
    </div>
  );
}
function SheetEightySix() {
  const [out, setOut] = React.useState(['Ribeye 12oz', 'Elk Bolognese', 'Trout amandine']);
  const [v, setV] = React.useState('');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><F label="86 an item"><I value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { setOut([v.trim(), ...out]); setV(''); } }} placeholder="e.g. Ribeye 12oz" /></F></div>
        <B variant="danger" onClick={() => { if (v.trim()) { setOut([v.trim(), ...out]); setV(''); } }}>Out</B>
      </div>
      {out.map((o) => (
        <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderBottom: '1px solid var(--hair)' }}>
          <D tone="alert" size={8} /><span style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{o}</span>
          <B size="xs" variant="ghost" onClick={() => setOut(out.filter((x) => x !== o))}>Back on</B>
        </div>
      ))}
    </div>
  );
}
function SheetBreaks() {
  return (
    <div>
      {[['Rosa Mendez', 'Taken 5:10p', 'ok'], ['Dev Tran', 'Due by 8:00p', 'warn'], ['Kai Ostrander', 'Missed rest', 'alert'], ['Marta Ibáñez', 'Waived (signed)', 'neutral']].map(([n, s, tone]) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--hair)' }}>
          <span style={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{n}</span>
          <P tone={tone} dot>{s}</P>
        </div>
      ))}
      <div style={{ marginTop: 12 }}><B variant="primary">Start a break</B></div>
    </div>
  );
}
function SheetStage() {
  return (
    <div>
      {[['7:00p', 'Doors · playlist scene 2', true], ['8:00p', 'Set one · 70 min', false], ['9:20p', 'Set two · 60 min', false], ['10:30p', 'Curfew — hard out', false]].map(([t, w, now]) => (
        <div key={t} style={{ display: 'flex', gap: 12, padding: '9px 2px', borderBottom: '1px solid var(--hair)', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--mono)', color: now ? 'var(--accent)' : 'var(--text-muted)', width: 52, fontWeight: 700 }}>{t}</span>
          <span style={{ color: now ? 'var(--accent)' : 'var(--text)', fontWeight: now ? 700 : 500 }}>{w}</span>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>Mixed — rail + hi-tops · cap 180 · changeover 35 min / 4 staff.</div>
    </div>
  );
}

const SHEETS = {
  temps: { title: 'Temp log', C: SheetTemps },
  fire: { title: 'Fire — Harvest dinner', C: SheetFire },
  eightysix: { title: "86 board", C: SheetEightySix },
  breaks: { title: 'Breaks & leave', C: SheetBreaks },
  stage: { title: 'Stage — run of show', C: SheetStage },
};

function RailApp() {
  const [queue, setQueue] = React.useState(QUEUE);
  const [sheet, setSheet] = React.useState(null);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');

  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((p) => !p); }
      if (e.key === 'Escape') { setPal(false); setSheet(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const resolve = (id) => setQueue((qs) => qs.filter((x) => x.id !== id));
  const results = PALETTE.filter((r) => r.w.toLowerCase().includes(q.toLowerCase()));
  const Sh = sheet ? SHEETS[sheet] : null;

  return (
    <div className="rail-app iron">
      <header className="rl-band">
        <span className="mark"><Mark decorative /><span>The Lariat</span></span>
        <span className="rl-stat hot"><b>3</b> 86'd</span>
        <span className="rl-stat"><b>212</b> sold · <b>148</b> in</span>
        <span className="rl-stat"><b>42</b> covers</span>
        <span className="rl-stat"><b>96</b> dB</span>
        <span className="clock">Fri · 6:38p — RUSH</span>
        <button className="rl-kbd" onClick={() => setPal(true)}>⌘K — find or do anything</button>
      </header>

      <nav className="rl-spine">
        <div className="lbl">The service day</div>
        <div className="rl-track">
          {SPINE.map((s, i) =>
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
        <div className="rl-qhead"><h1>Needs a human</h1><span className="n">{queue.length} open · ranked by heat</span></div>
        {queue.length === 0 && <div className="rl-done"><b>Line is quiet.</b>Nothing needs you — the spine will call the next fire.</div>}
        {queue.map((c) => (
          <div key={c.id} className={`rl-card ${c.sev}`}>
            <div className="body">
              <div className="t">{c.t}</div>
              <div className="s">{c.s}</div>
            </div>
            <span className="src">{c.src}</span>
            <div className="acts">
              {c.acts.map(([label, target], i) => (
                <B key={label} size="xs" variant={i === 0 ? (c.sev === 'crit' ? 'danger' : 'primary') : 'ghost'}
                  onClick={() => { if (target) setSheet(target); else resolve(c.id); }}>
                  {label}
                </B>
              ))}
              <B size="xs" variant="ghost" onClick={() => resolve(c.id)}>Done</B>
            </div>
          </div>
        ))}
        <div className="rl-quiet">
          <div className="qh">Quiet — no action needed</div>
          {QUIET.map((w) => <div key={w} className="qrow"><D tone="ok" size={7} />{w}</div>)}
        </div>
      </main>

      {Sh && (
        <aside className="rl-sheet">
          <div className="sh-head">
            <span className="t">{Sh.title}</span>
            <T>esc</T>
            <button className="rl-x" onClick={() => setSheet(null)}>×</button>
          </div>
          <div className="sh-body"><Sh.C /></div>
        </aside>
      )}

      {pal && (
        <div className="rl-veil" onClick={() => setPal(false)}>
          <div className="rl-pal" onClick={(e) => e.stopPropagation()}>
            <input autoFocus placeholder="Find a board, or do a thing — '86 trout', 'log temp'…" value={q} onChange={(e) => setQ(e.target.value)} />
            {results.map((r) => (
              <div key={r.w} className="row" onClick={() => { setSheet(r.sheet); setPal(false); setQ(''); }}>
                <span className="k">{r.k}</span>{r.w}<span className="hint">↵</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

window.RailApp = RailApp;
window.RailKit = { SHEETS, SPINE, QUEUE, QUIET, PALETTE };
