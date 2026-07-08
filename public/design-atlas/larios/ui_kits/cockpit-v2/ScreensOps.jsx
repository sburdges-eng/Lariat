// Cockpit v2 — Line + Safety boards: Prep, Specials, KDS/Expo, Cooling,
// Cleaning, Sanitizer. Grounded in the real boards (PrepView, SpecialsView,
// KdsPunchView, CoolingView/cooling.css, CleaningView, SanitizerView/sani.css).
const DSo = window.LariatLaRiOSDesignSystem_5761b2;
const { Button, Pill, Tag, StatusDot, Kpi, Bar, DataTable, Card, Field, Input, Select } = DSo;

function BoardHead({ title, em, sub }) {
  return (
    <div className="ck-board-head">
      <h1>{title} {em && <em>{em}</em>}</h1>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
window.BoardHead = BoardHead;

/* ── PREP BOARD ── */
function PrepScreen() {
  const [tasks, setTasks] = React.useState([
    { id: 1, task: 'Brine 40 chicken thighs', station: 'Prep', by: 'Rosa M.', done: true },
    { id: 2, task: 'Pommes purée — 2 batches', station: 'Sauté', by: 'Dev T.', done: true },
    { id: 3, task: 'Pick + wash chicories', station: 'Garde', by: '—', done: false },
    { id: 4, task: 'Demi reduction, pull at nappe', station: 'Sauce', by: 'Kai O.', done: false },
    { id: 5, task: 'Portion trout, 6oz', station: 'Sauté', by: '—', done: false },
  ]);
  const [txt, setTxt] = React.useState('');
  const done = tasks.filter((t) => t.done).length;
  return (
    <div>
      <BoardHead title="Prep" em="board" sub="What has to happen before the door opens." />
      <div className="ck-toolbar">
        <div className="grow"><Field label="Add prep"><Input value={txt} placeholder="e.g. Dice mirepoix — 4qt" onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && txt.trim()) { setTasks([{ id: Date.now(), task: txt.trim(), station: 'Prep', by: '—', done: false }, ...tasks]); setTxt(''); } }} /></Field></div>
        <Field label="Station"><Select style={{ width: 140 }}><option>Any station</option><option>Prep</option><option>Sauté</option><option>Grill</option><option>Sauce</option><option>Garde</option></Select></Field>
        <Button variant="primary" onClick={() => { if (txt.trim()) { setTasks([{ id: Date.now(), task: txt.trim(), station: 'Prep', by: '—', done: false }, ...tasks]); setTxt(''); } }}>Add</Button>
      </div>
      <Card title="The board" right={<Pill tone={done === tasks.length ? 'ok' : 'warn'} dot>{done}/{tasks.length} done</Pill>} padded={false}>
        <DataTable
          columns={[{ key: 'st', label: '', width: 36 }, { key: 'task', label: 'Task' }, { key: 'station', label: 'Station' }, { key: 'by', label: 'Cook' }, { key: 'act', label: '', align: 'right' }]}
          rows={tasks.map((t) => ({
            id: t.id,
            st: <StatusDot tone={t.done ? 'ok' : 'muted'} size={9} />,
            task: <span style={{ color: t.done ? 'var(--text-muted)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.task}</span>,
            station: <Tag>{t.station}</Tag>, by: t.by,
            act: t.done ? <Tag dot dotTone="ok">Done</Tag> : <Button size="xs" onClick={() => setTasks(tasks.map((x) => x.id === t.id ? { ...x, done: true } : x))}>Done</Button>,
          }))}
        />
      </Card>
    </div>
  );
}

/* ── SPECIALS ── */
function SpecialsScreen() {
  const specials = [
    { n: 'Elk chop, huckleberry jus', px: '$44', left: 14, total: 22 },
    { n: 'Squash agnolotti', px: '$28', left: 6, total: 18 },
    { n: 'Smoked trout board', px: '$21', left: 0, total: 12 },
  ];
  return (
    <div>
      <BoardHead title="Tonight's" em="specials" sub="Counts tick down as the window calls them." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 12 }}>
        {specials.map((s) => (
          <Card key={s.n} title={s.n} right={s.left === 0 ? <Pill tone="alert" dot>86'd</Pill> : s.left <= 6 ? <Pill tone="warn" dot>{s.left} left</Pill> : <Pill tone="ok" dot>{s.left} left</Pill>}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 22, color: 'var(--text)' }}>{s.px}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>{s.total - s.left}/{s.total} sold</span>
            </div>
            <Bar value={(s.left / s.total) * 100} tone={s.left === 0 ? 'alert' : s.left <= 6 ? 'warn' : 'ok'} />
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ── KDS / EXPO — runs as its own wall window; shown here as a live preview ── */
function KdsScreen() {
  const tickets = [
    { t: '#241', tbl: 'T6', age: '2:14', items: ['2× Bison rib', '1× Trout (GF)', '1× Chicory'], tone: 'ok' },
    { t: '#242', tbl: 'T3', age: '6:48', items: ['1× Elk chop', '2× Agnolotti'], tone: 'warn' },
    { t: '#239', tbl: 'BAR', age: '11:02', items: ['1× Trout board'], tone: 'alert' },
    { t: '#243', tbl: 'T9', age: '0:41', items: ['3× Bison rib', '1× Risotto (V)'], tone: 'ok' },
  ];
  return (
    <div>
      <BoardHead title="KDS /" em="expo" sub="Opens as its own wall window (⧉) — this is a live preview in the deepest surface." />
      <div className="k-dark" style={{ padding: 18, borderRadius: 'var(--radius)', border: '1px solid var(--hair)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {tickets.map((k) => (
            <div key={k.t} style={{ background: 'var(--panel)', border: '1px solid var(--hair)', borderTop: `3px solid ${k.tone === 'alert' ? 'var(--fire)' : k.tone === 'warn' ? 'var(--metal)' : 'var(--ok)'}`, borderRadius: 'var(--radius-sm)', padding: '10px 12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{k.t}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: k.tone === 'alert' ? 'var(--fire)' : 'var(--text-muted)' }}>{k.age}</span>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.16em', color: 'var(--text-muted)', marginBottom: 6 }}>{k.tbl}</div>
              {k.items.map((it) => <div key={it} style={{ fontSize: 13, color: 'var(--text)', padding: '3px 0', borderBottom: '1px solid var(--hair-2)' }}>{it}</div>)}
              <div style={{ marginTop: 10 }}><Button size="xs" variant="ok">Bump</Button></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── COOLING ── */
function CoolingScreen() {
  const batches = [
    { item: 'Demi-glace, 8qt', stage: 'Stage 1 · 135°→70° in 2h', clock: '0:42', tone: 'ok', read: '96°F' },
    { item: 'Braise liquid, 12qt', stage: 'Stage 2 · 70°→41° in 4h', clock: '2:15', tone: 'warn', read: '58°F' },
    { item: 'Soup — squash, 6qt', stage: 'Stage 2 · 70°→41° in 4h', clock: '3:51', tone: 'alert', read: '49°F' },
  ];
  return (
    <div>
      <BoardHead title="Cooling" em="log" sub="Two-stage cool: 135°→70° in 2 hours, 70°→41° in 4. Log every reading." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {batches.map((b) => (
          <div key={b.item} style={{ border: '1px solid var(--hair)', borderLeft: `4px solid ${b.tone === 'alert' ? 'var(--fire)' : b.tone === 'warn' ? 'var(--metal)' : 'var(--ok)'}`, borderRadius: 'var(--radius)', padding: '14px 18px', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{b.item}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{b.stage} · last read <span className="tnum">{b.read}</span></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: b.tone === 'alert' ? 'var(--fire)' : b.tone === 'warn' ? 'var(--metal)' : 'var(--text)' }}>{b.clock}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Time left</div>
            </div>
            <Button size="sm">Log temp</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── CLEANING ── */
function CleaningScreen() {
  const init = [
    { id: 1, task: 'Hood filters', area: 'Hot line', freq: 'Weekly', due: 'Today', tone: 'warn', by: '' },
    { id: 2, task: 'Walk-in shelving', area: 'BOH', freq: 'Weekly', due: 'Fri', tone: 'ok', by: 'Rosa M.' },
    { id: 3, task: 'Floor drains', area: 'Dish', freq: 'Daily', due: 'Late', tone: 'alert', by: '' },
    { id: 4, task: 'Slicer teardown', area: 'Prep', freq: 'Every 4h', due: '8:00p', tone: 'ok', by: '' },
    { id: 5, task: 'Bar gun + drains', area: 'Bar', freq: 'Nightly', due: 'Close', tone: 'ok', by: '' },
    { id: 6, task: 'Reach-in gaskets', area: 'Hot line', freq: 'Weekly', due: 'Wed', tone: 'ok', by: 'Dev T.' },
  ];
  const [rows, setRows] = React.useState(init);
  const done = rows.filter((r) => r.by).length;
  const late = rows.filter((r) => r.tone === 'alert' && !r.by).length;
  return (
    <div>
      <BoardHead title="Cleaning" em="side work" sub="Daily and weekly side work — late items go oxblood. Check off with your name." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi label="Done" value={`${done}/${rows.length}`} sub="signed off" trend={done === rows.length ? 'up' : undefined} />
        <Kpi label="Late" value={late} sub="past due" trend={late ? 'down' : undefined} />
        <Kpi label="Next up" value="Hood filters" sub="due today" trend="warn" />
      </div>
      <Card title="Side work" right={<Pill tone={done === rows.length ? 'ok' : 'warn'} dot>{done}/{rows.length} done</Pill>} padded={false}>
        <DataTable
          columns={[{ key: 'st', label: '', width: 34 }, { key: 'task', label: 'Task' }, { key: 'area', label: 'Area' }, { key: 'freq', label: 'How often' }, { key: 'by', label: 'By' }, { key: 'due', label: 'Due', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            st: <StatusDot tone={r.by ? 'ok' : r.tone} size={9} />,
            task: <span style={{ color: r.by ? 'var(--text-muted)' : 'var(--text)', textDecoration: r.by ? 'line-through' : 'none' }}>{r.task}</span>,
            area: <Tag>{r.area}</Tag>, freq: r.freq, by: r.by || '—',
            due: <Pill tone={r.by ? 'ok' : r.tone} dot>{r.by ? 'Done' : r.due}</Pill>,
            act: r.by ? <Button size="xs" variant="ghost" onClick={() => setRows(rows.map((x) => x.id === r.id ? { ...x, by: '' } : x))}>Undo</Button> : <Button size="xs" onClick={() => setRows(rows.map((x) => x.id === r.id ? { ...x, by: 'You' } : x))}>Done</Button>,
          }))}
        />
      </Card>
    </div>
  );
}

/* ── SANITIZER ── */
function SanitizerScreen() {
  const wells = [
    { n: 'Line — sauté well', ppm: 210, at: '5:40p', tone: 'ok' },
    { n: 'Line — grill well', ppm: 195, at: '5:41p', tone: 'ok' },
    { n: 'Prep sink', ppm: 120, at: '3:10p', tone: 'alert' },
    { n: 'Dish — final rinse', ppm: 220, at: '5:12p', tone: 'ok' },
    { n: 'Bar — rag bucket', ppm: null, at: '—', tone: 'alert' },
  ];
  return (
    <div>
      <BoardHead title="Sanitizer" em="checks" sub="Quat wells hold 150–400 ppm. Re-mix anything low, then log it." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
        {wells.map((w) => (
          <div key={w.n} style={{ background: 'var(--panel)', border: '1px solid var(--hair)', borderLeft: `4px solid ${w.tone === 'alert' ? 'var(--fire)' : 'var(--ok)'}`, borderRadius: 'var(--radius)', padding: '12px 14px' }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{w.n}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: w.tone === 'alert' ? 'var(--fire)' : 'var(--text)' }}>{w.ppm != null ? `${w.ppm} ppm` : 'No log'}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-muted)' }}>{w.at}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.Screens2 = Object.assign(window.Screens2 || {}, {
  PrepScreen, SpecialsScreen, KdsScreen, CoolingScreen, CleaningScreen, SanitizerScreen,
});
