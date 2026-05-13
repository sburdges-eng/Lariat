// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

const POLL_MS = 30_000;

const USD = (n) =>
  Number(n || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

const SOURCE_LABELS = {
  dice: 'DICE',
  walkup: 'Walk-up',
  comp: 'Comp',
  will_call: 'Will-call',
  guestlist: 'Guest list',
};

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

function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
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

function nextRunOfShowEntry(entries, now = new Date()) {
  if (!entries || entries.length === 0) return null;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  for (const e of entries) {
    const mins = parseClockMinutes(e?.time);
    if (mins != null && mins >= nowMins) return e;
  }
  return entries[entries.length - 1];
}

function AttendanceKPI({ attendance, capacityOverride, venueCapacity }) {
  const a = attendance ?? { scanned_qty: 0, sold_qty: 0, capacity: null, scanned_pct: null, status: 'unset' };
  const color = ATTENDANCE_COLOR[a.status] || ATTENDANCE_COLOR.unset;
  const label = ATTENDANCE_LABEL[a.status] || ATTENDANCE_LABEL.unset;
  const value = a.capacity ? `${a.scanned_qty} / ${a.capacity}` : (a.sold_qty || 0);

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
      <div className="kpi-label" style={{ fontSize: 9.5, letterSpacing: '0.24em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>
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
      {capacityOverride != null ? (
        <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          override · venue cap {venueCapacity ?? '—'}
        </div>
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
      <div className="kpi-value" style={{ fontFamily: "'Instrument Serif', serif", fontSize: 34, lineHeight: 1, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}>{sub}</div>
    </div>
  );
}

export default function TonightLiveClient({ initialPayload, loc, date, showId }) {
  const [payload, setPayload] = useState(initialPayload);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());
  const [now, setNow] = useState(() => new Date());
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const url = `/api/shows/tonight?location=${encodeURIComponent(loc)}&date=${encodeURIComponent(date)}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      setPayload(data);
      setUpdatedAt(new Date());
    } catch {
      /* polling — silent on transient failure */
    } finally {
      inFlightRef.current = false;
    }
  }, [loc, date]);

  // 30s poll while visible. Re-fetch immediately on visibility change.
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load();
    }, POLL_MS);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) load();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
    }
    return () => {
      clearInterval(t);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVis);
      }
    };
  }, [load]);

  // Tick `now` once a minute so the "refreshed Xs ago" pill ages without
  // a network round trip.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const attendance = payload?.attendance ?? null;
  const boxOffice = payload?.box_office_summary ?? {
    total_qty: 0,
    total_revenue: 0,
    total_fees: 0,
    scanned_qty: 0,
    by_source: {},
  };
  const runOfShow = Array.isArray(payload?.run_of_show) ? payload.run_of_show : [];
  const latestScene = payload?.latest_sound_scene ?? null;
  const nextRoS = nextRunOfShowEntry(runOfShow, now);
  const ageSec = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 1000));

  return (
    <>
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
        <AttendanceKPI
          attendance={attendance}
          capacityOverride={payload?.capacity_override ?? null}
          venueCapacity={payload?.venue_capacity ?? null}
        />
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

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <span
          className="pill"
          style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'JetBrains Mono, monospace' }}
          title={`Last refresh ${updatedAt.toLocaleTimeString()}`}
        >
          Live · refreshed {ageSec < 5 ? 'just now' : `${ageSec}s ago`}
        </span>
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
              No run-of-show entered. Open <Link href={`/shows/${showId}/stage`}>Stage</Link> to add cues.
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
          {boxOffice.total_qty === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>
              No box-office lines yet. Open{' '}
              <Link href={`/shows/${showId}/box-office`}>Box office</Link> to add walk-ups + comps or wait for the next
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
                {Object.entries(boxOffice.by_source || {})
                  .filter(([, v]) => v && v.qty > 0)
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
    </>
  );
}
