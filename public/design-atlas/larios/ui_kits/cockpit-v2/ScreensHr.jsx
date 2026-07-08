// Cockpit v2 — People / HR boards: Sick Leave, Wage Notices, Reviews,
// Gold Stars. Grounded in the real boards (SickLeaveView, WageNoticeView,
// PerformanceReviewsView, GoldStarsView). Kitchen-native copy.
const DSp = window.LariatLaRiOSDesignSystem_5761b2;
const { Button: Bp, Pill: Pp, Tag: Tp, Kpi: Kp, Bar: Barp, DataTable: Tp2, Card: Cp, Avatar: Avp, Field: Fp, Input: Ip, Select: Sp } = DSp;
const HeadP = window.BoardHead;

/* ── SICK LEAVE — balances; add / use hours ── */
function SickLeaveScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', accrued: 40, used: 16, bal: 24 },
    { id: 2, who: 'Dev Tran', accrued: 32, used: 32, bal: 0 },
    { id: 3, who: 'Kai Ostrander', accrued: 40, used: 8, bal: 32 },
    { id: 4, who: 'Marta Ibáñez', accrued: 24, used: 6, bal: 18 },
  ];
  const [who, setWho] = React.useState('');
  return (
    <div>
      <HeadP title="Sick" em="leave" sub="Paid sick balances — accrued, used, and left. Log add or use against a name." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kp label="On the books" value="74h" sub="paid sick, all staff" />
        <Kp label="Used YTD" value="62h" sub="this location" />
        <Kp label="At zero" value="1" sub="staff with no balance" trend="warn" />
      </div>
      <div className="ck-toolbar">
        <Fp label="Staff"><Sp value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180 }}><option value="">— pick —</option>{rows.map((r) => <option key={r.id}>{r.who}</option>)}</Sp></Fp>
        <Fp label="Hours"><Ip placeholder="0.0" style={{ width: 90 }} /></Fp>
        <Fp label="Kind"><Sp style={{ width: 130 }}><option>Add hours</option><option>Use hours</option></Sp></Fp>
        <Bp variant="primary">Log</Bp>
      </div>
      <Cp padded={false}>
        <Tp2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'accrued', label: 'Accrued', align: 'right' }, { key: 'used', label: 'Used', align: 'right' }, { key: 'bar', label: '', width: 120 }, { key: 'bal', label: 'Balance', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avp name={r.who} size="sm" />{r.who}</span>,
            accrued: r.accrued + 'h', used: r.used + 'h',
            bar: <Barp value={(r.bal / r.accrued) * 100} tone={r.bal === 0 ? 'alert' : r.bal < 12 ? 'warn' : 'ok'} />,
            bal: <span style={{ color: r.bal === 0 ? 'var(--fire)' : 'var(--text)', fontWeight: 700 }}>{r.bal}h</span>,
          }))}
        />
      </Cp>
    </div>
  );
}

/* ── WAGE NOTICES — labor-law notices on file (needs new / current) ── */
function WageNoticeScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', rate: '$18.50/hr', signed: 'Apr 2026', s: 'Current', tone: 'ok' },
    { id: 2, who: 'Dev Tran', rate: '$16.00/hr + tips', signed: '— rate changed', s: 'Needs new', tone: 'alert' },
    { id: 3, who: 'Kai Ostrander', rate: '$21.00/hr', signed: 'Jan 2026', s: 'Current', tone: 'ok' },
    { id: 4, who: 'Marta Ibáñez', rate: '$15.50/hr + tips', signed: 'New hire', s: 'Needs new', tone: 'alert' },
  ];
  return (
    <div>
      <HeadP title="Wage" em="notices" sub="Signed pay-rate notices on file. A rate change means a new notice is owed." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kp label="On file" value="2" sub="current + signed" trend="up" />
        <Kp label="Needs new" value="2" sub="rate change / new hire" trend="down" />
        <Kp label="Oldest" value="Jan 2026" sub="Kai O." />
      </div>
      <Cp padded={false}>
        <Tp2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'rate', label: 'Rate' }, { key: 'signed', label: 'Last signed', align: 'right' }, { key: 's', label: 'Status', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avp name={r.who} size="sm" />{r.who}</span>,
            rate: <span className="tnum">{r.rate}</span>, signed: r.signed,
            s: <Pp tone={r.tone} dot>{r.s}</Pp>,
            act: r.tone === 'alert' ? <Bp size="xs" variant="primary">Issue notice</Bp> : <Tp dot dotTone="ok">On file</Tp>,
          }))}
        />
      </Cp>
    </div>
  );
}

/* ── REVIEWS — performance reviews due / done ── */
function ReviewsScreen() {
  const rows = [
    { id: 1, who: 'Rosa Mendez', role: 'Line lead', due: 'Overdue', last: 'Aug 2025', tone: 'alert' },
    { id: 2, who: 'Dev Tran', role: 'Line cook', due: 'This month', last: 'Feb 2026', tone: 'warn' },
    { id: 3, who: 'Kai Ostrander', role: 'Bar lead', due: 'Q1 2027', last: 'Mar 2026', tone: 'ok' },
    { id: 4, who: 'Marta Ibáñez', role: '90-day', due: 'Dec 8', last: 'New hire', tone: 'warn' },
  ];
  return (
    <div>
      <HeadP title="Performance" em="reviews" sub="Who's up for a review and when they last had one." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 18 }}>
        <Kp label="Overdue" value="1" sub="review late" trend="down" />
        <Kp label="This month" value="2" sub="coming up" trend="warn" />
        <Kp label="Done, 90 days" value="3" sub="on schedule" trend="up" />
      </div>
      <Cp padded={false}>
        <Tp2
          columns={[{ key: 'who', label: 'Staff' }, { key: 'role', label: 'Role' }, { key: 'last', label: 'Last review', align: 'right' }, { key: 'due', label: 'Next due', align: 'right' }, { key: 'act', label: '', align: 'right' }]}
          rows={rows.map((r) => ({
            id: r.id,
            who: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Avp name={r.who} size="sm" />{r.who}</span>,
            role: <Tp>{r.role}</Tp>, last: r.last,
            due: <Pp tone={r.tone} dot>{r.due}</Pp>,
            act: <Bp size="xs">Start</Bp>,
          }))}
        />
      </Cp>
    </div>
  );
}

/* ── GOLD STARS — cook recognition ── */
function GoldStarsScreen() {
  const board = [
    { who: 'Rosa Mendez', stars: 12, why: 'Caught a temp fail before service' },
    { who: 'Kai Ostrander', stars: 9, why: 'Covered a double, no complaints' },
    { who: 'Dev Tran', stars: 7, why: 'Zero flagged line checks this month' },
    { who: 'Marta Ibáñez', stars: 5, why: 'Fastest walk-in count on record' },
  ];
  const [who, setWho] = React.useState('');
  return (
    <div>
      <HeadP title="Gold" em="stars" sub="Shout-outs for good work. Give a star, say why." />
      <div className="ck-toolbar">
        <Fp label="Give a star to"><Sp value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 180 }}><option value="">Pick a cook…</option>{board.map((b) => <option key={b.who}>{b.who}</option>)}</Sp></Fp>
        <div className="grow"><Fp label="Why"><Ip placeholder="e.g. Saved the sauce during the rush" /></Fp></div>
        <Bp variant="primary">★ Give star</Bp>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
        {board.map((b, i) => (
          <Cp key={b.who}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Avp name={b.who} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{b.who}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.1em' }}>{i === 0 ? 'TOP OF THE BOARD' : `#${i + 1}`}</div>
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--accent)' }}>★ {b.stars}</div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>"{b.why}"</div>
          </Cp>
        ))}
      </div>
    </div>
  );
}

window.Screens2 = Object.assign(window.Screens2 || {}, {
  SickLeaveScreen, WageNoticeScreen, ReviewsScreen, GoldStarsScreen,
});
