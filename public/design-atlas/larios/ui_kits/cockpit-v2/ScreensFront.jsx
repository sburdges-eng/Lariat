// Cockpit v2 — FOH + Shows boards: Host Stand (⧉), Floor Map, Reservations,
// Bar, Tonight, Box Office (⧉), Settlement (paper). Grounded in the real
// boards (HostStandView, FloorView, ReservationsBoardView, BarView,
// ShowsTonightView, ShowBoxOfficeView, ShowSettlementView).
const DSh = window.LariatLaRiOSDesignSystem_5761b2;
const { Button: Btn3, Pill: Pill3, Tag: Tag3, Kpi: Kpi3, Bar: Bar3, DataTable: Table3, Card: Card3, StatusDot: Dot3, Tabs: Tabs3 } = DSh;
const Head3 = window.BoardHead;

/* ── HOST STAND — runs on the host iPad (⧉) ── */
function HostStandScreen() {
  const waiting = [
    { id: 1, party: 'Whitfield · 4', quoted: '20 min', waited: '12 min', tone: 'ok' },
    { id: 2, party: 'Chen · 2', quoted: '10 min', waited: '14 min', tone: 'alert' },
    { id: 3, party: 'Okafor · 6', quoted: '35 min', waited: '8 min', tone: 'ok' },
  ];
  return (
    <div>
      <Head3 title="Host" em="stand" sub="Runs on the host iPad as its own window (⧉). Waitlist, quotes, and seats." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi3 label="Waiting" value="3" sub="parties · 12 covers" />
        <Kpi3 label="Quoted now" value="25m" sub="4-top" />
        <Kpi3 label="Open tables" value="4" sub="2 four-tops · 2 two-tops" />
      </div>
      <Card3 title="Waitlist" right={<Btn3 size="sm" variant="primary">Add party</Btn3>} padded={false}>
        <Table3
          columns={[{ key: 'party', label: 'Party' }, { key: 'quoted', label: 'Quoted', align: 'right' }, { key: 'waited', label: 'Waited', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
          rows={waiting.map((w) => ({
            id: w.id, party: w.party, quoted: w.quoted,
            waited: <span style={{ color: w.tone === 'alert' ? 'var(--fire)' : 'var(--text)', fontWeight: 700 }}>{w.waited}</span>,
            act: <span style={{ display: 'inline-flex', gap: 6 }}><Btn3 size="xs" variant="ok">Seat</Btn3><Btn3 size="xs" variant="ghost">Text</Btn3></span>,
          }))}
        />
      </Card3>
    </div>
  );
}

/* ── FLOOR MAP ── */
function FloorScreen() {
  const tables = [
    { t: 'T1', s: 'open' }, { t: 'T2', s: 'seated' }, { t: 'T3', s: 'entree' }, { t: 'T4', s: 'check' },
    { t: 'T5', s: 'seated' }, { t: 'T6', s: 'entree' }, { t: 'T7', s: 'open' }, { t: 'T8', s: 'bussing' },
    { t: 'T9', s: 'seated' }, { t: 'T10', s: 'open' }, { t: 'T11', s: 'check' }, { t: 'T12', s: 'open' },
  ];
  const toneOf = { open: 'muted', seated: 'amber', entree: 'ok', check: 'warn', bussing: 'alert' };
  const colorOf = { open: 'var(--hair)', seated: 'var(--accent)', entree: 'var(--ok)', check: 'var(--metal)', bussing: 'var(--fire)' };
  return (
    <div>
      <Head3 title="Floor," em="right now" sub="Table states across the main room. Amber = seated, sage = entrées out, brass = check dropped." />
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {Object.keys(toneOf).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
            <Dot3 tone={toneOf[k]} size={7} />{k}
          </span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {tables.map((x) => (
          <div key={x.t} style={{ border: '1px solid var(--hair)', borderTop: `3px solid ${colorOf[x.s]}`, borderRadius: 'var(--radius-sm)', background: 'var(--panel)', padding: '16px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--text)' }}>{x.t}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '.16em', textTransform: 'uppercase', color: x.s === 'open' ? 'var(--text-muted)' : colorOf[x.s], fontWeight: 700 }}>{x.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── RESERVATIONS ── */
function ReservationsScreen() {
  const rows = [
    { id: 1, at: '6:30p', block: 'Early', party: 'Okafor · 6', note: 'Anniversary — dessert comp', s: 'Seated', tone: 'ok' },
    { id: 2, at: '7:00p', block: 'Early', party: 'Delgado · 2', note: 'Window seat req', s: 'Confirmed', tone: 'neutral' },
    { id: 3, at: '7:15p', block: 'Pre-show', party: 'Bright · 8', note: 'Pre-show — needs check by 8:30', s: 'Confirmed', tone: 'warn' },
    { id: 4, at: '7:30p', block: 'Pre-show', party: 'Nowak · 4', note: '—', s: 'No answer', tone: 'alert' },
    { id: 5, at: '8:45p', block: 'Late', party: 'Late seating · 2', note: 'Bar OK', s: 'Confirmed', tone: 'neutral' },
  ];
  const covers = rows.reduce((s, r) => s + parseInt(r.party.split('·')[1], 10), 0);
  const blocks = ['Early', 'Pre-show', 'Late'];
  return (
    <div>
      <Head3 title="Tonight's" em="book" sub="Covers by time. Pre-show parties get flagged so the kitchen can pace." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi3 label="Covers booked" value={covers} sub={`${rows.length} parties`} />
        <Kpi3 label="Pre-show" value="12" sub="hard out by 8:30" trend="warn" />
        <Kpi3 label="Unconfirmed" value="1" sub="no answer" trend="down" />
        <Kpi3 label="Largest party" value="8" sub="Bright · 7:15p" />
      </div>
      {blocks.map((b) => {
        const list = rows.filter((r) => r.block === b);
        if (!list.length) return null;
        return (
          <div key={b} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{b}</span>
              <span className="tnum" style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{list.length} {list.length > 1 ? 'parties' : 'party'}</span>
            </div>
            <Card3 padded={false}>
              <Table3
                columns={[{ key: 'at', label: 'Time', align: 'right', width: 70 }, { key: 'party', label: 'Party' }, { key: 'note', label: 'Notes' }, { key: 's', label: 'Status', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
                rows={list.map((r) => ({
                  id: r.id, at: r.at, party: r.party, note: <span style={{ color: 'var(--text-muted)' }}>{r.note}</span>,
                  s: <Pill3 tone={r.tone} dot>{r.s}</Pill3>,
                  act: r.s === 'Seated' ? <Tag3 dot dotTone="ok">In</Tag3> : <Btn3 size="xs">Seat</Btn3>,
                }))}
              />
            </Card3>
          </div>
        );
      })}
    </div>
  );
}

/* ── BAR ── */
function BarScreen() {
  const rows = [
    { id: 1, item: 'Bourbon — house pour', kind: 'Bottle', par: 6, on: 2, tone: 'alert' },
    { id: 2, item: 'Mezcal', kind: 'Bottle', par: 3, on: 3, tone: 'ok' },
    { id: 3, item: 'House amaro', kind: 'Bottle', par: 4, on: 3, tone: 'ok' },
    { id: 4, item: 'Lime — juiced, qt', kind: 'Prep', par: 4, on: 1, tone: 'alert' },
    { id: 5, item: 'Draft — Elevation IPA', kind: 'Keg', par: 2, on: 1, tone: 'warn' },
    { id: 6, item: 'Simple syrup, qt', kind: 'Prep', par: 3, on: 3, tone: 'ok' },
  ];
  const low = rows.filter((r) => r.tone !== 'ok').length;
  const [tab, setTab] = React.useState('all');
  const list = tab === 'all' ? rows : rows.filter((r) => r.kind === tab);
  return (
    <div>
      <Head3 title="Bar" em="par" sub="Bottles, kegs, and prep against par. Pull from the cage before the rush." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi3 label="Below par" value={low} sub="need a pull" trend="down" />
        <Kpi3 label="Cocktail prep" value="1" sub="juice running low" trend="warn" />
        <Kpi3 label="Kegs" value="1/2" sub="IPA half gone" trend="warn" />
      </div>
      <Tabs3 tabs={[{ value: 'all', label: 'All' }, { value: 'Bottle', label: 'Bottles' }, { value: 'Keg', label: 'Kegs' }, { value: 'Prep', label: 'Prep' }]} value={tab} onChange={setTab} />
      <div style={{ height: 14 }} />
      <Card3 padded={false}>
        <Table3
          columns={[{ key: 'item', label: 'Item' }, { key: 'kind', label: 'Kind' }, { key: 'par', label: 'Par', align: 'right' }, { key: 'on', label: 'On hand', align: 'right' }, { key: 'fill', label: '', width: 110 }, { key: 's', label: '', align: 'right' }]}
          rows={list.map((r) => ({
            id: r.id, item: r.item, kind: <Tag3>{r.kind}</Tag3>, par: r.par, on: r.on,
            fill: <Bar3 value={(r.on / r.par) * 100} tone={r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'} />,
            s: r.tone !== 'ok' ? <Pill3 tone={r.tone} dot>{r.tone === 'alert' ? 'Pull now' : 'Watch'}</Pill3> : <Tag3 dot dotTone="ok">OK</Tag3>,
          }))}
        />
      </Card3>
    </div>
  );
}

/* ── SHOWS — TONIGHT ── */
function TonightScreen() {
  return (
    <div className="k-night" style={{ margin: -28, marginBottom: 0, padding: 28, minHeight: '100%' }}>
      <Head3 title="Tonight —" em="Wrenfield & The Coyotes" sub="Doors 7:00p · show 8:00p · Americana / two sets · room set: standing + rail seats" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi3 label="Sold" value="212" sub="of 240 cap" trend="up" />
        <Kpi3 label="Scanned in" value="0" sub="doors at 7:00p" />
        <Kpi3 label="Door price" value="$28" sub="$24 advance" />
        <Kpi3 label="Guest list" value="14" sub="band + comps" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Card3 title="Run of show">
          {[['5:00p', 'Load-in + line check'], ['6:00p', 'Soundcheck — full band'], ['7:00p', 'Doors · playlist scene 2'], ['8:00p', 'Set one · 70 min'], ['9:20p', 'Set two · 60 min'], ['10:30p', 'Curfew — hard out']].map(([t, w]) => (
            <div key={t} style={{ display: 'flex', gap: 14, padding: '7px 0', borderBottom: '1px solid var(--hair)', fontSize: 13.5 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', width: 52, textAlign: 'right', flexShrink: 0 }}>{t}</span>
              <span style={{ color: 'var(--text)' }}>{w}</span>
            </div>
          ))}
        </Card3>
        <Card3 title="Room & sound">
          {[['Room config', 'Standing + rail seats'], ['Latest scene', 'Doors — playlist 2, house at 40%'], ['Console', 'Recall: Coyotes v3'], ['Backline', 'House kit + 2 DIs'], ['Merch', 'Table by the coat check — band keeps 100%']].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 0', borderBottom: '1px solid var(--hair)', fontSize: 13.5 }}>
              <span style={{ color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ color: 'var(--text)', textAlign: 'right' }}>{v}</span>
            </div>
          ))}
        </Card3>
      </div>
    </div>
  );
}

/* ── BOX OFFICE — runs at the door (⧉) ── */
function BoxOfficeScreen() {
  return (
    <div>
      <Head3 title="Box" em="office" sub="Runs at the door as its own window (⧉). Scan, sell, comp." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kpi3 label="Scanned in" value="148" sub="of 212 sold" trend="up" />
        <Kpi3 label="Door sales" value="$672" sub="24 tickets" />
        <Kpi3 label="Comps used" value="9" sub="of 14 listed" />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
        <Btn3 variant="primary" size="lg">Sell at door — $28</Btn3>
        <Btn3 size="lg">Scan ticket</Btn3>
        <Btn3 variant="ghost" size="lg">Guest list</Btn3>
      </div>
      <Card3 title="Last through the door" padded={false}>
        <Table3
          columns={[{ key: 'at', label: 'At', align: 'right', width: 70 }, { key: 'who', label: 'Ticket' }, { key: 'kind', label: 'Kind' }, { key: 's', label: '', align: 'right' }]}
          rows={[
            { id: 1, at: '7:41p', who: '#A1187 · advance', kind: <Tag3>Scan</Tag3>, s: <Pill3 tone="ok" dot>In</Pill3> },
            { id: 2, at: '7:40p', who: 'Door sale ×2', kind: <Tag3>Card</Tag3>, s: <Pill3 tone="ok" dot>In</Pill3> },
            { id: 3, at: '7:39p', who: '#A0962 · advance', kind: <Tag3>Scan</Tag3>, s: <Pill3 tone="alert" dot>Dupe</Pill3> },
            { id: 4, at: '7:37p', who: 'Guest — Wrenfield +1', kind: <Tag3>Comp</Tag3>, s: <Pill3 tone="ok" dot>In</Pill3> },
          ]}
        />
      </Card3>
    </div>
  );
}

/* ── SETTLEMENT — paper money sheet ── */
function SettlementScreen() {
  const lines = [
    { c: 'Gross', item: 'Ticket sales — 212 × blend', v: '$5,512.00' },
    { c: 'Less', item: 'Ticketing fees', v: '−$276.00' },
    { c: 'Less', item: 'Venue expense — sound tech', v: '−$250.00' },
    { c: 'Split', item: 'Artist 70% of net', v: '$3,490.20' },
    { c: 'Split', item: 'House 30% of net', v: '$1,495.80' },
    { c: 'Plus', item: 'Merch — house 0%', v: '$0.00' },
  ];
  return (
    <div className="paper ck-book">
      <div className="bk-eyebrow">Show settlement · Wrenfield & The Coyotes · Fri Nov 14</div>
      <h2>Settlement <em>sheet</em></h2>
      <div className="bk-sub">Signed by band + manager at close. Prints from this sheet.</div>
      <div>
        {lines.map((r, i) => (
          <div key={i} className="ck-beo-row" style={{ gridTemplateColumns: '64px 1fr auto' }}>
            <span className="c">{r.c}</span>
            <span>{r.item}</span>
            <span className="qty" style={{ fontWeight: 700 }}>{r.v}</span>
          </div>
        ))}
      </div>
      <div className="ck-beo-total"><span className="tl">Due to artist</span><span className="tv">$3,490.20</span></div>
      <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
        <Btn3 variant="primary" style={{ background: 'var(--copper)', borderColor: 'var(--copper)', color: '#fff8ec' }}>Mark settled</Btn3>
        <Btn3 variant="ghost">Print sheet</Btn3>
      </div>
    </div>
  );
}

/* ── STAGE — the stage manager's setup + run of show (k-night) ── */
function StageScreen() {
  const rooms = [
    { key: 'standing', name: 'Standing + rail', cap: 240, staff: 3, min: 25, best: 'Loud, full-band nights' },
    { key: 'seated', name: 'Seated cabaret', cap: 120, staff: 5, min: 45, best: 'Songwriter / listening room' },
    { key: 'mixed', name: 'Mixed — rail + hi-tops', cap: 180, staff: 4, min: 35, best: 'Americana, two sets' },
  ];
  const [room, setRoom] = React.useState('mixed');
  const cfg = rooms.find((r) => r.key === room);
  const run = [
    { t: '5:00p', w: 'Load-in + line check', done: true },
    { t: '6:00p', w: 'Soundcheck — full band', done: true },
    { t: '7:00p', w: 'Doors · playlist scene 2', done: false },
    { t: '8:00p', w: 'Set one · 70 min', done: false },
    { t: '9:20p', w: 'Set two · 60 min', done: false },
    { t: '10:30p', w: 'Curfew — hard out', done: false },
  ];
  return (
    <div className="k-night" style={{ margin: -28, padding: 28, minHeight: '100%' }}>
      <Head3 title="Stage" em="setup" sub="Room config, changeover, and the run of show. Set once per show; the wall reads from it." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card3 title="Room configuration">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rooms.map((r) => (
              <button key={r.key} onClick={() => setRoom(r.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: room === r.key ? 'var(--panel-2)' : 'transparent', border: `1px solid ${room === r.key ? 'var(--accent)' : 'var(--hair)'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}>
                <Dot3 tone={room === r.key ? 'amber' : 'muted'} />
                <span style={{ flex: 1 }}><span style={{ fontFamily: 'var(--display)', fontWeight: 600, fontSize: 15 }}>{r.name}</span><div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.best}</div></span>
                <span className="tnum" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)' }}>cap {r.cap}</span>
              </button>
            ))}
          </div>
        </Card3>
        <Card3 title="Tonight — set">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
            {[['Capacity', cfg.cap], ['Changeover', cfg.min + ' min'], ['Crew', cfg.staff + ' staff'], ['Config', cfg.name]].map(([k, v]) => (
              <div key={k}><div style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{v}</div><div style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginTop: 3 }}>{k}</div></div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}><Btn3 variant="primary">Save setup</Btn3></div>
        </Card3>
      </div>
      <Card3 title="Run of show" right={<Pill3 tone="ok" dot>2 done</Pill3>}>
        {run.map((r) => (
          <div key={r.t} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0', borderBottom: '1px solid var(--hair)' }}>
            <Dot3 tone={r.done ? 'ok' : 'muted'} size={9} />
            <span className="tnum" style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', width: 56, fontSize: 13 }}>{r.t}</span>
            <span style={{ flex: 1, fontSize: 14, color: r.done ? 'var(--text-muted)' : 'var(--text)', textDecoration: r.done ? 'line-through' : 'none' }}>{r.w}</span>
            {!r.done && <Btn3 size="xs">Mark</Btn3>}
          </div>
        ))}
      </Card3>
    </div>
  );
}

/* ── SOUND — scenes + live SPL meter against the night's limit (k-night) ── */
function SoundScreen() {
  const scenes = [
    { n: 'Soundcheck', ch: 24, mon: 6, at: '6:02p', limit: 102 },
    { n: 'Set 1 — full band', ch: 24, mon: 6, at: '6:40p', limit: 100 },
    { n: 'Set 2 — encore', ch: 22, mon: 5, at: '6:41p', limit: 100 },
    { n: 'Doors / playlist', ch: 2, mon: 0, at: '5:30p', limit: 92 },
  ];
  const [live, setLive] = React.useState(96);
  const limit = 100;
  React.useEffect(() => {
    const t = setInterval(() => setLive(90 + Math.round(Math.random() * 14)), 1400);
    return () => clearInterval(t);
  }, []);
  const tone = live > limit ? 'alert' : live > limit - 4 ? 'warn' : 'ok';
  const color = tone === 'alert' ? 'var(--fire)' : tone === 'warn' ? 'var(--metal)' : 'var(--ok)';
  return (
    <div className="k-night" style={{ margin: -28, padding: 28, minHeight: '100%' }}>
      <Head3 title="Sound" em="scenes" sub="Recall a saved scene, watch the room against tonight's SPL limit." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 12, marginBottom: 12 }}>
        <Card3 title="Live SPL">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 52, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{live}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-muted)' }}>dB(A)</span>
            <span style={{ marginLeft: 'auto' }}><Pill3 tone={tone} dot>{tone === 'alert' ? 'Over limit' : tone === 'warn' ? 'Near limit' : 'In range'}</Pill3></span>
          </div>
          <div style={{ marginTop: 12 }}><Bar3 value={(live / 110) * 100} tone={tone} height={8} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)' }}><span>60</span><span style={{ color: 'var(--accent)' }}>limit {limit}</span><span>110</span></div>
        </Card3>
        <Card3 title="Scenes" right={<Btn3 size="sm" variant="primary">Save scene</Btn3>} padded={false}>
          <Table3
            columns={[{ key: 'n', label: 'Scene' }, { key: 'plot', label: 'Plot' }, { key: 'lim', label: 'Limit', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
            rows={scenes.map((s, i) => ({
              id: i, n: s.n, plot: <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)' }}>{s.ch} ch · {s.mon} mon</span>,
              lim: <span className="tnum">{s.limit} dB</span>, act: <Btn3 size="xs">Recall</Btn3>,
            }))}
          />
        </Card3>
      </div>
      <div className="ck-rd-note" style={{ borderColor: 'var(--accent)', color: 'var(--text-muted)' }}>SPL polls every few seconds. Over the limit two readings running arms the warn light at the board — pull the mains, don't ride it.</div>
    </div>
  );
}

window.Screens2 = Object.assign(window.Screens2 || {}, {
  HostStandScreen, FloorScreen, ReservationsScreen, BarScreen, TonightScreen, BoxOfficeScreen, SettlementScreen,
  StageScreen, SoundScreen,
});
