import Link from 'next/link';
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import {
  summarizeBoxOffice,
  parseStatusJson,
  parseRunOfShow,
  pickShowTime,
  computeAttendance,
} from '../../../lib/showsTonight';

export const dynamic = 'force-dynamic';

const USD = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
};

const SOURCE_LABELS = {
  dice: 'DICE',
  walkup: 'Walk-up',
  comp: 'Comp',
  will_call: 'Will-call',
  guestlist: 'Guest list',
};

function EmptyState({ loc, previousShow }) {
  return (
    <div style={{ padding: '40px 0', maxWidth: 600 }}>
      <div className="page-eyebrow" style={{ color: 'var(--muted)' }}>
        Tonight · Live
      </div>
      <h1 style={{ fontFamily: "'Instrument Serif', serif", fontSize: 42, fontWeight: 400, margin: '6px 0 14px' }}>
        No show on the calendar tonight.
      </h1>
      <p style={{ color: 'var(--muted)', maxWidth: 480, lineHeight: 1.5 }}>
        {previousShow ? (
          <>
            Last show was <strong>{previousShow.band_name}</strong> on {fmtDate(previousShow.show_date)}.
            Settle the books in the show archive, or open <Link href="/booking">Booking</Link> to look ahead.
          </>
        ) : (
          <>
            Open <Link href="/booking">Booking</Link> to see what's on the calendar, or check the show archive.
          </>
        )}
      </p>
      <div style={{ marginTop: 24, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Link className="btn" href="/booking">Booking & calendar</Link>
        <Link className="btn" href="/shows/archive">Show archive</Link>
      </div>
    </div>
  );
}

export default function TonightLivePage({ searchParams }) {
  const loc = (searchParams?.location && typeof searchParams.location === 'string')
    ? searchParams.location
    : DEFAULT_LOCATION_ID;
  const date = (searchParams?.date && typeof searchParams.date === 'string')
    ? searchParams.date
    : todayISO();

  const db = getDb();

  const show = db
    .prepare(
      `SELECT id, location_id, band_name, show_date, price, door_tix, status_json
         FROM shows
        WHERE location_id = ? AND show_date = ?
        LIMIT 1`,
    )
    .get(loc, date);

  const previousShow = db
    .prepare(
      `SELECT id, band_name, show_date
         FROM shows
        WHERE location_id = ? AND show_date < ?
        ORDER BY show_date DESC
        LIMIT 1`,
    )
    .get(loc, date);

  if (!show) {
    return <EmptyState loc={loc} previousShow={previousShow} />;
  }

  const status = parseStatusJson(show.status_json);
  const doorsTime = pickShowTime(status, 'doors');
  const set1Time = pickShowTime(status, 'set1');
  const set2Time = pickShowTime(status, 'set2');
  const curfewTime = pickShowTime(status, 'curfew');

  const stageSetup = db
    .prepare(
      `SELECT id, room_config, run_of_show_json, hospitality_rider_json, tech_rider_json, notes, updated_at
         FROM stage_setups
        WHERE show_id = ? AND location_id = ?`,
    )
    .get(show.id, loc);

  const latestScene = db
    .prepare(
      `SELECT id, scene_name, spl_limit_db, saved_at
         FROM sound_scenes
        WHERE show_id = ? AND location_id = ?
        ORDER BY datetime(saved_at) DESC, id DESC
        LIMIT 1`,
    )
    .get(show.id, loc);

  const boxLines = db
    .prepare(
      `SELECT id, show_id, location_id, source, ticket_class, qty,
              face_price, fees, external_ref, scanned_at, notes
         FROM box_office_lines
        WHERE show_id = ? AND location_id = ?`,
    )
    .all(show.id, loc);
  const boxOffice = summarizeBoxOffice(boxLines);
  const runOfShow = stageSetup ? parseRunOfShow(stageSetup.run_of_show_json) : [];

  // Per-venue capacity (operator-set; nullable). When set, the
  // attendance tile renders a percent + status color; when unset, the
  // tile shows just the raw scanned count.
  const venueCapacity = db
    .prepare(`SELECT capacity FROM locations WHERE id = ?`)
    .get(loc)?.capacity ?? null;
  const attendance = computeAttendance(boxOffice.scanned_qty, boxOffice.total_qty, venueCapacity);

  // Pre-compute a display string for the "next milestone" hint — the next
  // entry in run_of_show whose time field parses as later than now. Best-
  // effort, doesn't gate anything.
  const nextRoS = nextRunOfShowEntry(runOfShow, set1Time, set2Time, curfewTime);

  return (
    <div style={{ padding: '4px 0 60px', maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, marginBottom: 28 }}>
        <div>
          <div className="page-eyebrow" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Tonight · Live · {fmtDate(show.show_date)}
          </div>
          <h1
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontSize: 56,
              fontWeight: 400,
              margin: '8px 0 6px',
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {show.band_name}
          </h1>
          <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            {[
              doorsTime ? `Doors ${doorsTime}` : null,
              set1Time ? `Set 1 ${set1Time}` : null,
              set2Time ? `Set 2 ${set2Time}` : null,
              curfewTime ? `Curfew ${curfewTime}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Set times not yet entered.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {latestScene?.spl_limit_db ? (
            <span className="pill warn">SPL limit {latestScene.spl_limit_db} dB</span>
          ) : null}
          <Link className="btn" href={`/shows/${show.id}/box-office`}>Box office</Link>
          <Link className="btn" href={`/shows/${show.id}/sound`}>Sound</Link>
          <Link className="btn" href={`/shows/${show.id}/stage`}>Stage</Link>
          <Link className="btn" href={`/shows/${show.id}/settlement`}>Settlement</Link>
        </div>
      </div>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <AttendanceKPI attendance={attendance} />
        <KPI
          label="Gross revenue"
          value={USD(boxOffice.total_revenue)}
          sub={boxOffice.total_fees ? `incl ${USD(boxOffice.total_fees)} fees` : 'no fees'}
        />
        <KPI
          label="Sound scene"
          value={latestScene?.scene_name || '—'}
          sub={latestScene?.saved_at ? `saved ${formatTimestamp(latestScene.saved_at)}` : 'no scene saved yet'}
        />
        <KPI
          label="Run of show"
          value={runOfShow.length}
          sub={runOfShow.length ? 'cues set' : 'no cues entered'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 20 }}>
        <section className="card" style={{ padding: '18px 20px' }}>
          <div className="card-eyebrow" style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
            Run of show
          </div>
          <h2 className="card-title" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, margin: '4px 0 14px' }}>
            {nextRoS ? `Next: ${nextRoS.label}` : 'Tonight’s timeline'}
          </h2>
          {runOfShow.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
              No run-of-show entered. Open <Link href={`/shows/${show.id}/stage`}>Stage</Link> to add cues.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                {runOfShow.map((e, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px 8px 0', width: 90, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                      {e.time || '—'}
                    </td>
                    <td style={{ padding: '8px 0' }}>{e.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card" style={{ padding: '18px 20px' }}>
          <div className="card-eyebrow" style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
            Box office
          </div>
          <h2 className="card-title" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 22, fontWeight: 400, margin: '4px 0 14px' }}>
            Sources tonight
          </h2>
          {boxLines.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
              No box-office lines yet. Open{' '}
              <Link href={`/shows/${show.id}/box-office`}>Box office</Link> to add walk-ups + comps or wait for the next
              DICE pull.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 8px 6px 0', fontWeight: 600 }}>Source</th>
                  <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right', width: 70 }}>Qty</th>
                  <th style={{ padding: '6px 0', fontWeight: 600, textAlign: 'right', width: 110 }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(boxOffice.by_source)
                  .filter(([, v]) => v.qty > 0)
                  .map(([source, v]) => (
                    <tr key={source} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 8px 8px 0' }}>{SOURCE_LABELS[source] || source}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{v.qty}</td>
                      <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                        {USD(v.revenue)}
                      </td>
                    </tr>
                  ))}
                <tr>
                  <td style={{ padding: '8px 8px 8px 0', fontWeight: 700 }}>Total</td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {boxOffice.total_qty}
                  </td>
                  <td style={{ padding: '8px 0', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                    {USD(boxOffice.total_revenue)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      </div>

      {previousShow ? (
        <p style={{ marginTop: 32, fontSize: 12, color: 'var(--muted)', letterSpacing: '0.04em' }}>
          Last show: <strong>{previousShow.band_name}</strong> on {fmtDate(previousShow.show_date)}.
        </p>
      ) : null}
    </div>
  );
}

function KPI({ label, value, sub }) {
  return (
    <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div className="kpi-label" style={{ fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
        {label}
      </div>
      <div
        className="kpi-value"
        style={{ fontFamily: "'Instrument Serif', serif", fontSize: 34, lineHeight: 1, letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{sub}</div>
    </div>
  );
}

// Status → accent color. Maps onto the existing globals.css vars so the
// tile inherits whatever the active theme paints; falls back to ember
// when the var is undefined (theme-poor environments).
const ATTENDANCE_COLOR = {
  unset: 'var(--muted)',
  under: 'var(--muted)',
  near: 'var(--yellow, var(--ember, #c85a2a))',
  at: 'var(--green, var(--sage, #5d7a66))',
  over: 'var(--red, #8b2e1f)',
};

const ATTENDANCE_LABEL = {
  unset: 'Tickets sold',
  under: 'Attendance',
  near: 'Attendance',
  at: 'Attendance · full',
  over: 'Attendance · over',
};

function AttendanceKPI({ attendance }) {
  const a = attendance ?? { scanned_qty: 0, sold_qty: 0, capacity: null, scanned_pct: null, status: 'unset' };
  const color = ATTENDANCE_COLOR[a.status] || ATTENDANCE_COLOR.unset;
  const label = ATTENDANCE_LABEL[a.status] || ATTENDANCE_LABEL.unset;

  // Value rendering depends on whether capacity is set.
  const value = a.capacity
    ? `${a.scanned_qty} / ${a.capacity}`
    : (a.sold_qty || 0);

  // Sub line: percent + sold-vs-scanned delta when capacity is known;
  // otherwise the same "X scanned in" the original tile had.
  let sub;
  if (a.capacity) {
    const pct = a.scanned_pct != null ? `${a.scanned_pct.toFixed(0)}%` : '—';
    const ahead = Math.max(0, (a.sold_qty || 0) - (a.scanned_qty || 0));
    sub = ahead > 0 ? `${pct} scanned · ${ahead} to arrive` : `${pct} scanned`;
  } else {
    sub = `${a.scanned_qty || 0} scanned in`;
  }

  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderLeft: a.status !== 'unset' ? `3px solid ${color}` : undefined,
      }}
    >
      <div
        className="kpi-label"
        style={{ fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}
      >
        {label}
      </div>
      <div
        className="kpi-value"
        style={{
          fontFamily: "'Instrument Serif', serif",
          fontSize: 34,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: a.status === 'unset' ? undefined : color,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{sub}</div>
    </div>
  );
}

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// Cheap "next in the run of show" heuristic — assumes entries are in
// chronological order and times are HH:MM strings. Returns the first
// entry whose time appears to be after the current wall-clock; otherwise
// the last one. Server-side only — no client tick.
function nextRunOfShowEntry(entries, ...candidates) {
  if (!entries || entries.length === 0) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (const e of entries) {
    const mins = parseClockMinutes(e.time);
    if (mins != null && mins >= nowMins) return e;
  }
  // Fall back to comparing against curfew/set2 candidates so the strip
  // doesn't go dark when entries lack times.
  for (const c of candidates) {
    if (typeof c === 'string') return { time: c, label: 'Upcoming' };
  }
  return entries[entries.length - 1];
}

function parseClockMinutes(s) {
  if (typeof s !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const period = m[3]?.toLowerCase();
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return h * 60 + min;
}
