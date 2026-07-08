// Cockpit screens — Today (rush home), 86 Board, Temp Log. Compose the
// LaRiOS design-system components on the shell chrome. Kitchen-native copy.
const DS = window.LariatLaRiOSDesignSystem_5761b2;
const { Button, Pill, Tag, StatusDot, Kpi, Bar, DataTable, Card, Field, Input, Select, Tabs, Avatar } = DS;
const S = window.Shell;

function toneColor(t) {
  return { alert: 'var(--fire)', warn: 'var(--metal)', ok: 'var(--ok)', amber: 'var(--accent)' }[t] || 'var(--text-muted)';
}

/* ── TODAY — the rush home ── */
function TodayScreen({ go }) {
  const C = window.COCKPIT;
  const ready = C.stations.filter((s) => s.signedOff || s.done >= s.total).length;
  const flagged = C.stations.reduce((n, s) => n + s.flagged, 0);
  function tileStatus(s) {
    if (s.flagged > 0) return { label: `${s.flagged} flagged`, tone: 'alert' };
    if (s.signedOff) return { label: 'Signed off', tone: 'ok' };
    if (s.done >= s.total) return { label: 'Ready', tone: 'ok' };
    if (s.done > 0) return { label: `${s.done} of ${s.total}`, tone: 'amber' };
    return { label: 'Not checked', tone: 'alert' };
  }
  return (
    <div>
      <div className="ck-hero">
        <div>
          <div className="ck-datebar"><span className="dot" />Fri · Nov 14 · The Lariat</div>
          <h1>Today</h1>
        </div>
        <div className="ck-statstack">
          <div className="ck-stat"><div className="n">{ready}</div><div className="l">Ready</div></div>
          <div className="ck-stat hot"><div className="n">{flagged}</div><div className="l">Flagged</div></div>
          <div className="ck-stat"><div className="n">{C.eightySix.length}</div><div className="l">86'd</div></div>
        </div>
      </div>

      <div className="ck-86" onClick={() => go('eighty-six')} style={{ cursor: 'pointer' }}>
        <div className="ck-86-l">86'd right now</div>
        <div className="ck-86-items">
          {C.eightySix.map((e) => <span key={e.id} className="ck-86-chip">{e.item}</span>)}
        </div>
      </div>

      <div className="ck-sechead">
        <h2><S.Stamp />The line, <em>right now</em></h2>
        <span className="eyebrow">{ready} ready · {flagged} flagged · {C.stations.length} stations</span>
      </div>
      <div className="ck-grid">
        {C.stations.map((s, i) => {
          const st = tileStatus(s);
          return (
            <button key={s.id} className="ck-tile" onClick={() => go('station:' + s.id)}>
              <StationRing done={s.done} total={s.total} flagged={s.flagged} signedOff={s.signedOff} glyph={i + 1} size={40} />
              <span className="tn">{s.name}</span>
              <span className="tsx" style={{ color: toneColor(st.tone) }}>{st.label}</span>
            </button>
          );
        })}
      </div>

      <div className="ck-quick">
        <button className="ck-action" onClick={() => go('eighty-six')}>86 an item</button>
        <button className="ck-action" onClick={() => go('inventory')}>Log stock</button>
        <button className="ck-action muted" onClick={() => go('recipes')}>Recipes</button>
        <button className="ck-action muted" onClick={() => go('temps')}>Temp log</button>
      </div>
    </div>
  );
}

/* ── 86 BOARD ── */
function EightySixScreen() {
  const C = window.COCKPIT;
  const [out, setOut] = React.useState(C.eightySix);
  const [item, setItem] = React.useState('');
  function add() {
    if (!item.trim()) return;
    setOut([{ id: Date.now(), item: item.trim(), by: 'You', at: 'now' }, ...out]);
    setItem('');
  }
  return (
    <div>
      <div className="ck-board-head">
        <h1>What's <em>86'd</em></h1>
        <div className="sub">Out right now. Everyone sees it the second you add it.</div>
      </div>
      <div className="ck-toolbar">
        <div className="grow">
          <Field label="86 an item">
            <Input value={item} placeholder="e.g. Ribeye 12oz" onChange={(e) => setItem(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()} />
          </Field>
        </div>
        <Button variant="danger" onClick={add}>Mark out</Button>
      </div>
      <Card title="Out right now" right={<Pill tone="alert" dot>{out.length} out</Pill>} padded={false}>
        <DataTable
          columns={[
            { key: 'item', label: 'Item' },
            { key: 'by', label: 'By' },
            { key: 'at', label: 'At', align: 'right' },
            { key: 'act', label: '', align: 'right' },
          ]}
          rows={out.map((e) => ({
            id: e.id, item: e.item, by: e.by, at: e.at,
            act: <Button size="xs" variant="ghost" onClick={() => setOut(out.filter((x) => x.id !== e.id))}>Back on</Button>,
          }))}
        />
      </Card>
      <div style={{ marginTop: 20 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Might also be out — uses an 86'd item</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {C.maybeOut.map((m) => <Tag key={m} dot dotTone="amber">{m}</Tag>)}
        </div>
      </div>
    </div>
  );
}

/* ── TEMP LOG BOARD ── */
function TempLogScreen() {
  const C = window.COCKPIT;
  return (
    <div>
      <div className="ck-board-head">
        <h1>Temp <em>log</em></h1>
        <div className="sub">Cold holds under 41°, hot holds over 135°. Log every check.</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
        <Kpi label="In range" value={C.temps.filter((t) => t.tone === 'ok').length} sub="holds" trend="up" />
        <Kpi label="At limit" value={C.temps.filter((t) => t.tone === 'warn').length} sub="watch" trend="warn" />
        <Kpi label="Out" value={C.temps.filter((t) => t.tone === 'alert').length} sub="fix now" trend="down" />
        <Kpi label="Last check" value="6:12p" sub="12m ago" />
      </div>
      <Card title="Holds" right={<Pill tone="warn" dot>1 at limit</Pill>} padded={false}>
        <DataTable
          columns={[
            { key: 'name', label: 'Hold' },
            { key: 'ccp', label: 'CCP' },
            { key: 'temp', label: 'Temp', align: 'right' },
            { key: 'status', label: 'Status', align: 'right' },
          ]}
          rows={C.temps.map((t) => ({
            id: t.id, name: t.name, ccp: <Tag>{t.ccp}</Tag>, temp: t.temp,
            status: <Pill tone={t.tone === 'alert' ? 'alert' : t.tone === 'warn' ? 'warn' : 'ok'} dot>{t.status}</Pill>,
          }))}
        />
      </Card>
    </div>
  );
}

/* ── INVENTORY / STOCK BOARD ── */
function InventoryScreen() {
  const C = window.COCKPIT;
  const [tab, setTab] = React.useState('all');
  const rows = tab === 'low' ? C.inventory.filter((r) => r.tone !== 'ok') : C.inventory;
  return (
    <div>
      <div className="ck-board-head">
        <h1>Stock on <em>hand</em></h1>
        <div className="sub">Counts against par. Pull what's low before the door opens.</div>
      </div>
      <Tabs tabs={[{ value: 'all', label: 'All' }, { value: 'low', label: 'Running low' }]} value={tab} onChange={setTab} />
      <div style={{ height: 16 }} />
      <Card padded={false}>
        <DataTable
          columns={[
            { key: 'item', label: 'Item' },
            { key: 'station', label: 'Station' },
            { key: 'par', label: 'Par', align: 'right' },
            { key: 'onHand', label: 'On hand', align: 'right' },
            { key: 'fill', label: 'Fill', width: 120 },
            { key: 'status', label: 'Status', align: 'right' },
          ]}
          rows={rows.map((r) => ({
            id: r.id, item: r.item, station: r.station, par: r.par, onHand: r.onHand,
            fill: <Bar value={Math.round((r.onHand / r.par) * 100)} tone={r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'} />,
            status: <Pill tone={r.tone} dot>{r.status}</Pill>,
          }))}
        />
      </Card>
    </div>
  );
}

/* ── generic placeholder for station + recipes ── */
function StationScreen({ id }) {
  const s = window.COCKPIT.stations.find((x) => x.id === id) || window.COCKPIT.stations[0];
  const checks = [
    { n: 'Sauté pans oiled & staged', done: true },
    { n: 'Mise labeled + dated', done: true },
    { n: 'Sauce holding 140°+', done: s.done > 2 },
    { n: 'Backups pulled from walk-in', done: s.done > 3 },
    { n: 'Station wiped + sanitized', done: s.signedOff },
    { n: 'Rag bucket 200ppm', done: s.signedOff },
  ];
  return (
    <div>
      <div className="ck-board-head">
        <h1>{s.name}</h1>
        <div className="sub">{s.line} · line check</div>
      </div>
      <Card title="Line check" right={s.flagged > 0 ? <Pill tone="alert" dot>{s.flagged} flagged</Pill> : <Pill tone="ok" dot>{s.done}/{s.total}</Pill>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {checks.slice(0, s.total).map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--hair)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)' }}>
              <StatusDot tone={c.done ? 'ok' : 'muted'} size={10} />
              <span style={{ flex: 1, fontSize: 14, color: c.done ? 'var(--text)' : 'var(--text-muted)' }}>{c.n}</span>
              {c.done ? <Tag dot dotTone="ok">Done</Tag> : <Button size="xs">Check</Button>}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <Button variant="primary">Sign off station</Button>
          <Button variant="danger">Flag a problem</Button>
        </div>
      </Card>
    </div>
  );
}

const RECIPES = [
  {
    n: 'Elk Bolognese', st: 'Sauté', all: ['Dairy', 'Gluten'],
    yield: '12 portions', batch: '1 hotel pan', active: '45 min', total: '3 hr',
    ing: [
      { a: 3, u: 'lb', item: 'Ground elk', sub: '80/20, cold' },
      { a: 8, u: 'oz', item: 'Pancetta', sub: 'small dice' },
      { a: 2, u: 'cup', item: 'Soffritto', sub: 'onion / carrot / celery' },
      { a: 1.5, u: 'cup', item: 'Dry red wine' },
      { a: 28, u: 'oz', item: 'San Marzano', sub: 'hand-crushed' },
      { a: 1, u: 'cup', item: 'Whole milk' },
      { a: 4, u: 'oz', item: 'Parmesan rind + grated' },
    ],
    method: [
      'Render pancetta over medium until fat is clear. Raise heat, brown elk hard in batches — no steaming.',
      'Add soffritto, sweat to soft. Deglaze with red wine, reduce to nearly dry.',
      'Add tomato and milk, drop in Parm rind. Bare simmer 2 hr, stirring occasionally.',
      'Pull rind, adjust salt. Cool per two-stage log if holding.',
    ],
    note: 'Doubles cleanly to 2 pans. Milk is not optional — it sets the texture.',
  },
  {
    n: 'Trout Amandine', st: 'Sauté', all: ['Fish', 'Tree nut', 'Dairy'],
    yield: '1 portion', batch: 'à la minute', active: '8 min', total: '8 min',
    ing: [
      { a: 1, u: 'ea', item: 'Trout fillet', sub: '6 oz, skin on' },
      { a: 2, u: 'oz', item: 'Sliced almonds' },
      { a: 3, u: 'tbsp', item: 'Butter', sub: 'to brown' },
      { a: 0.5, u: 'ea', item: 'Lemon', sub: 'juice + supremes' },
      { a: 1, u: 'tbsp', item: 'Parsley', sub: 'chopped' },
    ],
    method: [
      'Dredge trout flesh-side in seasoned flour. Sear flesh-down in oil until golden, flip, finish.',
      'Wipe pan, add butter + almonds, swirl to nut-brown.',
      'Off heat: lemon juice, parsley. Spoon over fish, plate with supremes.',
    ],
    note: 'GF on request — swap dredge for rice flour, drop the almonds for pepitas.',
  },
  {
    n: 'House Brine', st: 'Prep', all: [],
    yield: '2 gal', batch: '2 gal Cambro', active: '15 min', total: '30 min',
    ing: [
      { a: 2, u: 'gal', item: 'Water' },
      { a: 12, u: 'oz', item: 'Kosher salt' },
      { a: 8, u: 'oz', item: 'Brown sugar' },
      { a: 6, u: 'ea', item: 'Bay leaf' },
      { a: 2, u: 'tbsp', item: 'Black peppercorn', sub: 'cracked' },
    ],
    method: [
      'Bring half the water to a boil with salt, sugar, aromatics. Stir to dissolve.',
      'Kill heat, add remaining cold water to chill. Cool to under 40° before use.',
      'Date + label. Holds 5 days.',
    ],
    note: 'Never brine warm — pull to the walk-in the second it hits temp.',
  },
  {
    n: 'Demi-Glace', st: 'Sauce', all: [],
    yield: '2 qt', batch: '2 qt', active: '30 min', total: '6 hr',
    ing: [
      { a: 10, u: 'lb', item: 'Roasted veal bones' },
      { a: 1, u: 'lb', item: 'Mirepoix' },
      { a: 6, u: 'oz', item: 'Tomato paste' },
      { a: 2, u: 'cup', item: 'Red wine' },
      { a: 2, u: 'gal', item: 'Water / stock' },
    ],
    method: [
      'Brown bones, add mirepoix, paste — pincé until deep.',
      'Deglaze wine, cover with liquid, bare simmer 5–6 hr, skimming.',
      'Strain, reduce to nappe, cool per log.',
    ],
    note: 'The backbone of the sauce station. Never let it boil — you\u2019ll cloud it.',
  },
  {
    n: 'Pommes Purée', st: 'Sauté', all: ['Dairy'],
    yield: '10 portions', batch: '1/6 pan', active: '25 min', total: '45 min',
    ing: [
      { a: 3, u: 'lb', item: 'Yukon gold' },
      { a: 8, u: 'oz', item: 'Butter', sub: 'cold, cubed' },
      { a: 1, u: 'cup', item: 'Warm cream' },
    ],
    method: [
      'Boil potatoes whole in salted water until fork-tender. Peel warm.',
      'Rice, then mount over low heat with cold butter, then warm cream.',
      'Pass through tamis. Season, hold at 140°+.',
    ],
    note: 'Ratio is rich on purpose. Keep it moving on the flat-top so it doesn\u2019t skin.',
  },
  {
    n: 'Bison Ribeye', st: 'Grill', all: [],
    yield: '1 portion', batch: 'à la minute', active: '12 min', total: '20 min',
    ing: [
      { a: 1, u: 'ea', item: 'Bison ribeye', sub: '14 oz, tempered' },
      { a: 1, u: 'tbsp', item: 'Beef tallow' },
      { a: 2, u: 'sprig', item: 'Thyme' },
      { a: 2, u: 'clove', item: 'Garlic', sub: 'smashed' },
    ],
    method: [
      'Temper 30 min, salt hard. Grill over high for the cross-hatch.',
      'Move to the flat-top, baste with tallow, thyme, garlic to temp — bison runs lean, pull 5° early.',
      'Rest 6 min. Slice against the grain.',
    ],
    note: 'Lean — never past medium or it seizes. Rest is non-negotiable.',
  },
];

function fmtAmt(a, mult) {
  const v = a * mult;
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

function RecipeDetail({ recipe, onBack }) {
  const [mult, setMult] = React.useState(1);
  const step = (d) => setMult((m) => Math.max(0.5, Math.round((m + d) * 2) / 2));
  return (
    <div className="paper ck-book">
      <button className="ck-rback" onClick={onBack}>← The book</button>
      <div className="ck-rd-head">
        <div>
          <div className="bk-eyebrow">{recipe.st} station · The Lariat</div>
          <div className="ck-rd-title">{recipe.n.split(' ').slice(0, -1).join(' ')} <em>{recipe.n.split(' ').slice(-1)}</em></div>
        </div>
        <div className="ck-rd-facts">
          <div className="f"><b>{recipe.yield}</b><span>Yield</span></div>
          <div className="f"><b>{recipe.active}</b><span>Active</span></div>
          <div className="f"><b>{recipe.total}</b><span>Total</span></div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {recipe.all.length ? recipe.all.map((a) => <Pill key={a} tone="alert">{a}</Pill>) : <Tag dot dotTone="ok">No allergens</Tag>}
      </div>
      <div className="ck-rd-grid">
        <div>
          <div className="ck-rd-sech">
            Ingredients
            <span className="ck-scaler">
              <button onClick={() => step(-0.5)}>−</button>
              <span className="mult">×{mult}</span>
              <button onClick={() => step(0.5)}>+</button>
            </span>
          </div>
          {recipe.ing.map((i) => (
            <div key={i.item} className="ck-ing">
              <span>{i.item}{i.sub && <span className="sub2"> · {i.sub}</span>}</span>
              <span className="amt">{fmtAmt(i.a, mult)} {i.u}</span>
            </div>
          ))}
          <div className="ck-rd-note">{recipe.note}</div>
        </div>
        <div>
          <div className="ck-rd-sech">Method</div>
          <div className="ck-method">
            {recipe.method.map((m, i) => <div key={i} className="step">{m}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipesScreen() {
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState('');
  if (open) {
    const r = RECIPES.find((x) => x.n === open);
    if (r) return <RecipeDetail recipe={r} onBack={() => setOpen(null)} />;
  }
  const list = RECIPES.filter((r) => r.n.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="paper ck-book">
      <div className="bk-eyebrow">The Lariat · est. 1885</div>
      <h2>The <em>book</em></h2>
      <div className="bk-sub">Recipes, allergens, and scale — straight from the line. Tap a card to open it.</div>
      <div style={{ maxWidth: 400, marginBottom: 16 }}>
        <Input placeholder="Search the book…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
        {list.map((r) => (
          <div key={r.n} className="ck-recipe" onClick={() => setOpen(r.n)}>
            <div className="rn">{r.n}</div>
            <div className="rs">{r.st} · {r.yield}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {r.all.length ? r.all.map((a) => <Pill key={a} tone="alert">{a}</Pill>) : <Tag>No allergens</Tag>}
            </div>
          </div>
        ))}
        {list.length === 0 && <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>Nothing in the book by that name.</div>}
      </div>
    </div>
  );
}

/* ── BEO — the banquet event order. A printed kraft-paper sheet with three
   tabs (Sheet / Fire / Prep), mirroring the real board: cream .paper surface,
   espresso ink, the copper implement for accents. ── */
const BEO = {
  ref: 'BEO #241122',
  who: ['Harvest', 'dinner'], client: 'Hillside Farm Co.',
  date: 'Sat · Nov 22', doors: '6:00p', guests: 140, room: 'Main room',
  lines: [
    { c: 'Pass', item: 'Smoked trout crostini', qty: '160 pc', fire: '5:45p', cost: 1.85, prep: 'Cure + smoke trout Thu; toast points day-of', station: 'Garde' },
    { c: 'Pass', item: 'Whipped ricotta + hot honey', qty: '160 pc', fire: '5:45p', cost: 1.10, prep: 'Whip ricotta AM; warm honey at pass', station: 'Garde' },
    { c: 'First', item: 'Chicory salad, cider vinaigrette', qty: '140 cv', fire: '6:30p', cost: 3.20, prep: 'Wash/pick chicories; build vinaigrette Fri', station: 'Garde' },
    { c: 'Main', item: 'Braised bison short rib', qty: '96 cv', fire: '7:05p', cost: 14.40, prep: 'Braise Thu, cool + portion; reheat in jus', station: 'Sauté' },
    { c: 'Main', item: 'Trout amandine (GF)', qty: '32 cv', fire: '7:05p', cost: 9.50, prep: 'Portion 6oz; brown butter à la minute', station: 'Sauté' },
    { c: 'Main', item: 'Squash risotto (V)', qty: '12 cv', fire: '7:05p', cost: 5.10, prep: 'Par-cook risotto 75%; finish to order', station: 'Sauté' },
    { c: 'Sweet', item: 'Burnt-sugar custard', qty: '140 cv', fire: '8:15p', cost: 2.35, prep: 'Bake Fri; torch tops at service', station: 'Pastry' },
  ],
  prepDemands: [
    { item: 'Bison short rib', need: '108 lb', unit: 'raw', order: '3 cases' },
    { item: 'Whole trout', need: '38 lb', unit: 'PNW', order: '4 cases' },
    { item: 'Ricotta', need: '14 lb', unit: 'whole-milk', order: '2 tubs' },
    { item: 'Chicories (mixed)', need: '22 lb', unit: 'picked', order: '30 lb raw' },
    { item: 'Kabocha squash', need: '16 lb', unit: 'peeled', order: '24 lb raw' },
    { item: 'Cream, heavy', need: '3 gal', unit: '—', order: '3 gal' },
  ],
};

function beoTotals() {
  // per-guarantee food total from line costs × guest count share
  const food = BEO.lines.reduce((s, l) => {
    const per = parseInt(l.qty, 10);
    return s + l.cost * per;
  }, 0);
  const service = food * 0.20;
  const taxable = food + service;
  const tax = taxable * 0.089;
  return { food, service, tax, total: taxable + tax };
}

const $ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fireTone(fire) {
  // demo: bison/trout/risotto (7:05p) = firing soon (amber), pass (5:45) done, sweet (8:15) upcoming
  const map = { '5:45p': ['ok', 'Fired'], '6:30p': ['ok', 'Fired'], '7:05p': ['warn', 'Fire soon'], '8:15p': ['neutral', 'Upcoming'] };
  return map[fire] || ['neutral', 'Upcoming'];
}

function BeoScreen() {
  const [tab, setTab] = React.useState('sheet');
  const t = beoTotals();

  // group lines by station for the Fire tab
  const byStation = {};
  BEO.lines.forEach((l) => { (byStation[l.station] = byStation[l.station] || []).push(l); });

  return (
    <div className="paper ck-book">
      <div className="bk-eyebrow">Banquet event order · {BEO.ref}</div>
      <div className="ck-beo-head">
        <div className="who">{BEO.who[0]} <em>{BEO.who[1]}</em> — {BEO.client}</div>
        <div className="ck-beo-meta">
          <div className="m"><b>{BEO.date}</b><span>Date</span></div>
          <div className="m"><b>{BEO.doors}</b><span>Doors</span></div>
          <div className="m"><b>{BEO.guests}</b><span>Guaranteed</span></div>
          <div className="m"><b>{BEO.room}</b><span>Room</span></div>
        </div>
      </div>

      <div className="ck-ptabs">
        {[['sheet', 'Prep sheet'], ['fire', 'Fire schedule'], ['prep', 'Prep demands']].map(([k, l]) => (
          <button key={k} className={`ck-ptab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'sheet' && (
        <div>
          {BEO.lines.map((r, i) => (
            <div key={i}>
              <div className="ck-beo-row" style={{ borderBottom: 'none', paddingBottom: 2 }}>
                <span className="c">{r.c}</span>
                <span>{r.item}</span>
                <span className="qty">{r.qty}</span>
                <span className="fire">fire {r.fire}</span>
              </div>
              <div className="ck-beo-row" style={{ paddingTop: 0 }}>
                <span />
                <span className="ck-beo-prepnote"><b>Prep</b>{r.prep}</span>
                <span className="qty" style={{ color: 'var(--text-muted)' }}>{$(r.cost)}/cv</span>
                <span />
              </div>
            </div>
          ))}
          <div className="ck-beo-invoice">
            <div className="r"><span className="l">Food · per guarantee</span><span className="v">{$(t.food)}</span></div>
            <div className="r"><span className="l">Service fee · 20%</span><span className="v">{$(t.service)}</span></div>
            <div className="r"><span className="l">Sales tax · 8.9%</span><span className="v">{$(t.tax)}</span></div>
            <div className="r grand"><span className="l">Total</span><span className="v">{$(t.total)}</span></div>
          </div>
        </div>
      )}

      {tab === 'fire' && (
        <div>
          {Object.entries(byStation).map(([st, lines]) => (
            <div key={st} className="ck-fire-st">
              <div className="ck-fire-sth"><span className="nm">{st}</span><span className="ct">{lines.length} course{lines.length > 1 ? 's' : ''}</span></div>
              {lines.map((l, i) => {
                const [tone, label] = fireTone(l.fire);
                const color = tone === 'warn' ? 'var(--metal)' : tone === 'ok' ? 'var(--ok)' : 'var(--text-muted)';
                return (
                  <div key={i} className="ck-fire-course">
                    <span className="at" style={{ color }}>{l.fire}</span>
                    <span><span className="lbl">{l.item}</span><div className="lines">{l.qty} · {l.c}</div></span>
                    <span className="ck-fire-pill" style={{ color, border: `1px solid ${color}` }}>{label}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="ck-rd-note">Age-colored around each course's fire time — sage = fired, brass = fire within 30 min, muted = upcoming. Mirrors the KDS color convention.</div>
        </div>
      )}

      {tab === 'prep' && (
        <div>
          <div className="ck-beo-row" style={{ gridTemplateColumns: '1fr auto auto', color: 'var(--text-muted)' }}>
            <span className="c">Ingredient</span><span className="c" style={{ textAlign: 'right' }}>Total needed</span><span className="c" style={{ textAlign: 'right' }}>To order</span>
          </div>
          {BEO.prepDemands.map((p, i) => (
            <div key={i} className="ck-prep-row">
              <span>{p.item}{p.unit !== '—' && <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}> · {p.unit}</span>}</span>
              <span className="need">{p.need}</span>
              <span className="order">{p.order}</span>
            </div>
          ))}
          <div className="ck-rd-note">Cascaded from the menu tree × {BEO.guests} guests. Feeds straight into the Order Guide.</div>
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <Button variant="primary" style={{ background: 'var(--copper)', borderColor: 'var(--copper)', color: '#fff8ec' }}>Share BEO</Button>
        <Button variant="ghost">Print sheet</Button>
      </div>
    </div>
  );
}

window.Screens = { TodayScreen, EightySixScreen, TempLogScreen, InventoryScreen, StationScreen, RecipesScreen, BeoScreen };
