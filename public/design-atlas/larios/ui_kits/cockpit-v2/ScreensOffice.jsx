// Cockpit v2 — Office boards: Order Guide (paper ⧉), Receiving, Costing,
// Tip Pool, Breaks & Leave, Staff Certs, Audit Log. Grounded in the real
// boards (PurchasingOrderGuideView, ReceivingView, CostingView, TipPoolView,
// BreakBoardView, StaffCertsView, AuditLogView).
const DSf = window.LariatLaRiOSDesignSystem_5761b2;
const { Button: Btn2, Pill: Pill2, Tag: Tag2, Kpi: Kpi2, Bar: Bar2, DataTable: Table2, Card: Card2, Avatar: Av2, Field, Input: Inp, Select: Sel, Tabs: Tabs2 } = DSf;
const Head2 = window.BoardHead;

/* ── ORDER GUIDE — a paper sheet, copper implement; opens as its own window ── */
function OrderGuideScreen() {
  const rows = [
    { v: 'Shamrock', item: 'Ribeye, whole boneless', pack: '2× ~9lb', par: 4, order: 3, px: '$11.42/lb' },
    { v: 'Shamrock', item: 'Trout, PNW farmed', pack: '10lb case', par: 3, order: 2, px: '$8.90/lb' },
    { v: 'Sysco', item: 'Butter, unsalted 36ct', pack: 'case', par: 2, order: 1, px: '$118.20' },
    { v: 'Sysco', item: 'Flour, AP 50lb', pack: 'bag', par: 3, order: 0, px: '$21.85' },
    { v: 'WebstaurantStore', item: 'Deli containers, 32oz', pack: '240ct', par: 1, order: 1, px: '$64.99' },
  ];
  return (
    <div className="paper ck-book">
      <div className="bk-eyebrow">Purchasing · order guide · week of Nov 17</div>
      <h2>Order <em>guide</em></h2>
      <div className="bk-sub">Par against on-hand, by vendor. Prints as the call sheet. Opens as its own window (⧉).</div>
      <div>
        {rows.map((r, i) => (
          <div key={i} className="ck-beo-row" style={{ gridTemplateColumns: '120px 1fr 90px 110px 90px' }}>
            <span className="c">{r.v}</span>
            <span>{r.item} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>· {r.pack}</span></span>
            <span className="qty">par {r.par}</span>
            <span className="qty" style={{ color: r.order > 0 ? 'var(--copper-deep)' : 'var(--text-muted)', fontWeight: 700 }}>order {r.order}</span>
            <span className="fire">{r.px}</span>
          </div>
        ))}
      </div>
      <div className="ck-beo-total"><span className="tl">This order · est.</span><span className="tv">$1,486.30</span></div>
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <Btn2 variant="primary" style={{ background: 'var(--copper)', borderColor: 'var(--copper)', color: '#fff8ec' }}>Send orders</Btn2>
        <Btn2 variant="ghost">Print sheet</Btn2>
      </div>
    </div>
  );
}

/* ── RECEIVING ── */
function ReceivingScreen() {
  const rows = [
    { id: 1, v: 'Shamrock', item: 'Trout, 10lb case ×2', temp: '36°F', pkg: 'OK', tone: 'ok', s: 'Accepted' },
    { id: 2, v: 'Shamrock', item: 'Ribeye, whole ×2', temp: '39°F', pkg: 'OK', tone: 'ok', s: 'Accepted' },
    { id: 3, v: 'Sysco', item: 'Dairy — mixed', temp: '45°F', pkg: 'OK', tone: 'alert', s: 'Rejected · warm' },
    { id: 4, v: 'Sysco', item: 'Dry goods', temp: '—', pkg: 'Torn bag', tone: 'warn', s: 'Short / noted' },
  ];
  const [live, setLive] = React.useState('');
  const liveNum = parseFloat(live);
  const liveTone = live === '' ? null : liveNum > 41 ? 'alert' : liveNum > 38 ? 'warn' : 'ok';
  return (
    <div>
      <Head2 title="Receiving" em="log" sub="Check temps and packaging at the door. Reject anything over 41°." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="Deliveries" value="4" sub="today" />
        <Kpi2 label="Accepted" value="2" sub="in the door" trend="up" />
        <Kpi2 label="Rejected" value="1" sub="over 41°" trend="down" />
        <Kpi2 label="Short / noted" value="1" sub="credit owed" trend="warn" />
      </div>
      <div className="ck-toolbar">
        <Field label="Vendor"><Sel style={{ width: 150 }}><option>Shamrock</option><option>Sysco</option><option>WebstaurantStore</option></Sel></Field>
        <div className="grow"><Field label="Delivery"><Inp placeholder="e.g. Trout, 10lb case ×2" /></Field></div>
        <Field label="Temp °F"><Inp value={live} placeholder="—" style={{ width: 90, borderColor: liveTone === 'alert' ? 'var(--fire)' : liveTone === 'warn' ? 'var(--metal)' : undefined }} onChange={(e) => setLive(e.target.value)} /></Field>
        <Btn2 variant={liveTone === 'alert' ? 'danger' : 'primary'}>{liveTone === 'alert' ? 'Reject' : 'Accept'}</Btn2>
      </div>
      <Card2 title="At the door today" padded={false}>
        <Table2
          columns={[{ key: 'v', label: 'Vendor' }, { key: 'item', label: 'Delivery' }, { key: 'temp', label: 'Temp', align: 'right' }, { key: 'pkg', label: 'Packaging' }, { key: 's', label: 'Status', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id, v: <Tag2>{r.v}</Tag2>, item: r.item, temp: r.temp, pkg: r.pkg,
            s: <Pill2 tone={r.tone} dot>{r.s}</Pill2>,
          }))}
        />
      </Card2>
    </div>
  );
}

/* ── COSTING ── */
function CostingScreen() {
  const rows = [
    { id: 1, dish: 'Bison ribeye, frites', menu: '$52', cost: '$16.90', pct: 32.5, tone: 'warn' },
    { id: 2, dish: 'Elk bolognese', menu: '$29', cost: '$7.25', pct: 25.0, tone: 'ok' },
    { id: 3, dish: 'Trout amandine', menu: '$34', cost: '$9.52', pct: 28.0, tone: 'ok' },
    { id: 4, dish: 'Squash agnolotti', menu: '$28', cost: '$5.60', pct: 20.0, tone: 'ok' },
    { id: 5, dish: 'Trout board', menu: '$21', cost: '$8.19', pct: 39.0, tone: 'alert' },
  ];
  return (
    <div>
      <Head2 title="Plate" em="costing" sub="Cost against menu price. Anything past 35% goes oxblood." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="Food cost, blended" value="28.4%" sub="▼ 1.2 vs last week" trend="up" />
        <Kpi2 label="Over target" value="2" sub="dishes past 35%" trend="down" />
        <Kpi2 label="Price shocks" value="3" sub="vendor moves this week" trend="warn" />
      </div>
      <Card2 padded={false}>
        <Table2
          columns={[{ key: 'dish', label: 'Dish' }, { key: 'menu', label: 'Menu', align: 'right' }, { key: 'cost', label: 'Plate cost', align: 'right' }, { key: 'pct', label: 'Cost %', align: 'right' }, { key: 'bar', label: '', width: 110 }]}
          rows={rows.map((r) => ({
            id: r.id, dish: r.dish, menu: r.menu, cost: r.cost,
            pct: <span style={{ color: r.tone === 'alert' ? 'var(--fire)' : r.tone === 'warn' ? 'var(--metal)' : 'var(--ok)', fontWeight: 700 }}>{r.pct.toFixed(1)}%</span>,
            bar: <Bar2 value={(r.pct / 45) * 100} tone={r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'} />,
          }))}
        />
      </Card2>
    </div>
  );
}

/* ── TIP POOL ── */
function TipPoolScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', role: 'Server', hrs: 7.5, pts: 10, out: '$212.40' },
    { id: 2, who: 'Dev Tran', role: 'Server', hrs: 6.0, pts: 10, out: '$169.92' },
    { id: 3, who: 'Kai Ostrander', role: 'Bar', hrs: 8.0, pts: 8, out: '$181.25' },
    { id: 4, who: 'Marta Ibáñez', role: 'Busser', hrs: 6.5, pts: 5, out: '$92.06' },
  ];
  return (
    <div>
      <Head2 title="Tip" em="pool" sub="Tonight's pool split by hours × points. Kinds: tip pool, service charge, direct tip." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="Pool tonight" value="$655.63" sub="tips + service charge" />
        <Kpi2 label="Hours in pool" value="28.0" sub="4 staff" />
        <Kpi2 label="Per point-hour" value="$2.83" />
      </div>
      <Card2 padded={false}>
        <Table2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'role', label: 'Role' }, { key: 'hrs', label: 'Hours', align: 'right' }, { key: 'pts', label: 'Points', align: 'right' }, { key: 'out', label: 'Payout', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Av2 name={r.who} size="sm" />{r.who}</span>,
            role: <Tag2>{r.role}</Tag2>, hrs: r.hrs.toFixed(1), pts: r.pts, out: r.out,
          }))}
        />
      </Card2>
    </div>
  );
}

/* ── BREAKS & LEAVE ── */
function BreaksScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', on: '2:00p', brk: '30 min at 5:10p', s: 'Taken', tone: 'ok' },
    { id: 2, who: 'Dev Tran', on: '3:00p', brk: 'Due by 8:00p', s: 'Due', tone: 'warn' },
    { id: 3, who: 'Kai Ostrander', on: '4:00p', brk: 'Missed 10-min rest', s: 'Missed', tone: 'alert' },
    { id: 4, who: 'Marta Ibáñez', on: '4:30p', brk: 'Waived (signed)', s: 'Waived', tone: 'neutral' },
  ];
  return (
    <div>
      <Head2 title="Breaks &" em="leave" sub="Rest and meal breaks against the clock — missed breaks go oxblood." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="On shift" value="4" sub="clocked in" />
        <Kpi2 label="Breaks taken" value="1" sub="logged" trend="up" />
        <Kpi2 label="Due soon" value="1" sub="before 8:00p" trend="warn" />
        <Kpi2 label="Missed" value="1" sub="needs a waiver" trend="down" />
      </div>
      <Card2 padded={false}>
        <Table2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'on', label: 'Clocked in', align: 'right' }, { key: 'brk', label: 'Break' }, { key: 's', label: 'Status', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Av2 name={r.who} size="sm" />{r.who}</span>,
            on: r.on, brk: r.brk, s: <Pill2 tone={r.tone} dot>{r.s}</Pill2>,
          }))}
        />
      </Card2>
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <Btn2 variant="primary">Start a break</Btn2>
        <Btn2 variant="ghost">Sick leave log</Btn2>
      </div>
    </div>
  );
}

/* ── STAFF CERTS ── */
function CertsScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', cert: 'Food Protection Manager', exp: 'Mar 2028', tone: 'ok', s: 'Current' },
    { id: 2, who: 'Dev Tran', cert: 'Food Handler', exp: 'Dec 2026', tone: 'warn', s: '5 months left' },
    { id: 3, who: 'Kai Ostrander', cert: 'TIPS Alcohol', exp: 'Jul 2026', tone: 'alert', s: 'Expires this month' },
    { id: 4, who: 'Marta Ibáñez', cert: 'Food Handler', exp: 'Aug 2027', tone: 'ok', s: 'Current' },
  ];
  return (
    <div>
      <Head2 title="Staff" em="certs" sub="Who's certified for what, and what's about to lapse." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="Current" value="2" sub="good standing" trend="up" />
        <Kpi2 label="Expiring" value="1" sub="within 6 months" trend="warn" />
        <Kpi2 label="Lapsing" value="1" sub="this month" trend="down" />
      </div>
      <Card2 padded={false}>
        <Table2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'cert', label: 'Certificate' }, { key: 'exp', label: 'Expires', align: 'right' }, { key: 's', label: 'Status', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Av2 name={r.who} size="sm" />{r.who}</span>,
            cert: r.cert, exp: r.exp, s: <Pill2 tone={r.tone} dot>{r.s}</Pill2>,
          }))}
        />
      </Card2>
    </div>
  );
}

/* ── AUDIT LOG ── */
function AuditScreen() {
  const rows = [
    { id: 1, at: '6:42p', who: 'Rosa M.', what: "86'd Trout amandine", area: '86 board', flag: false },
    { id: 2, at: '6:12p', who: 'Kai O.', what: 'Logged hot hold 128° — flagged', area: 'Temp log', flag: true },
    { id: 3, at: '5:58p', who: 'Manager PIN', what: 'Voided check #238 — $64.00', area: 'POS', flag: true },
    { id: 4, at: '5:41p', who: 'Dev T.', what: 'Signed off Sauté line check', area: 'Stations', flag: false },
    { id: 5, at: '4:30p', who: 'Marta I.', what: 'Counted walk-in produce', area: 'Stock', flag: false },
    { id: 6, at: '4:02p', who: 'Manager PIN', what: 'Comped 2 desserts — anniversary', area: 'POS', flag: true },
    { id: 7, at: '3:14p', who: 'Rosa M.', what: 'Received Shamrock delivery', area: 'Receiving', flag: false },
  ];
  const [tab, setTab] = React.useState('all');
  const list = tab === 'flagged' ? rows.filter((r) => r.flag) : tab === 'pin' ? rows.filter((r) => r.who === 'Manager PIN') : rows;
  return (
    <div>
      <Head2 title="Audit" em="log" sub="Every signed action, newest first. Read-only." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi2 label="Actions today" value={rows.length} sub="this location" />
        <Kpi2 label="Manager PIN" value="2" sub="voids + comps" trend="warn" />
        <Kpi2 label="Flagged" value="3" sub="review recommended" trend="down" />
      </div>
      <Tabs2 tabs={[{ value: 'all', label: 'All' }, { value: 'flagged', label: 'Flagged' }, { value: 'pin', label: 'Manager PIN' }]} value={tab} onChange={setTab} />
      <div style={{ height: 14 }} />
      <Card2 padded={false}>
        <Table2
          columns={[{ key: 'at', label: 'At', align: 'right', width: 70 }, { key: 'who', label: 'Who' }, { key: 'what', label: 'Action' }, { key: 'area', label: 'Board', align: 'right' }]}
          rows={list.map((r) => ({
            id: r.id, at: r.at,
            who: r.who === 'Manager PIN' ? <Tag2 dot dotTone="amber">PIN</Tag2> : r.who,
            what: <span style={{ color: r.flag ? 'var(--fire)' : 'var(--text)' }}>{r.what}</span>,
            area: <Tag2>{r.area}</Tag2>,
          }))}
        />
      </Card2>
    </div>
  );
}

window.Screens2 = Object.assign(window.Screens2 || {}, {
  OrderGuideScreen, ReceivingScreen, CostingScreen, TipPoolScreen, BreaksScreen, CertsScreen, AuditScreen,
});
