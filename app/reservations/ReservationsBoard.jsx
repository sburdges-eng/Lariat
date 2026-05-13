// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Status → tone (CSS color var) for the pill on each row. The check
// constraint in the schema only allows these five values.
const STATUS_TONE = {
  booked: 'var(--orange, #c0531c)',
  seated: 'var(--green)',
  completed: '#666',
  cancelled: 'var(--red)',
  no_show: 'var(--red)',
};

const STATUS_LABEL = {
  booked: 'Booked',
  seated: 'Seated',
  completed: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

export default function ReservationsBoard({ rows, date, view, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  // Group rows by hour bucket. Hour comes from the last 5 chars of the
  // reservation_at (always 'YYYY-MM-DD HH:MM' per schema). Rows missing
  // a parseable time still render — they just go in an "Unscheduled" bin.
  const grouped = useMemo(() => {
    const buckets = new Map();
    for (const r of rows) {
      const at = r.reservation_at || '';
      const m = /(\d{2}):(\d{2})$/.exec(at);
      const key = m ? `${m[1]}:00` : '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if (a === '' && b !== '') return 1;
      if (b === '' && a !== '') return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return { keys, buckets };
  }, [rows]);

  const counts = useMemo(() => {
    const c = { booked: 0, seated: 0, completed: 0, cancelled: 0, no_show: 0 };
    let people = 0;
    for (const r of rows) {
      c[r.status] = (c[r.status] || 0) + 1;
      if (r.status === 'booked' || r.status === 'seated') {
        people += Number(r.party_size) || 0;
      }
    }
    return { ...c, people };
  }, [rows]);

  const patch = async (id, body) => {
    setBusyId(id);
    setErr('');
    try {
      const res = await fetch(`/api/reservations/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          location_id: locationId,
          cook_id: cookId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Did not save — try again.');
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved.');
      setBusyId(null);
    }
  };

  const removeRow = async (id, partyName) => {
    if (!window.confirm(`Delete reservation for ${partyName}?`)) return;
    setBusyId(id);
    setErr('');
    try {
      const res = await fetch(
        `/api/reservations/${id}?location=${encodeURIComponent(locationId)}&cook_id=${encodeURIComponent(cookId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setErr('Could not delete.');
        setBusyId(null);
        return;
      }
      setBusyId(null);
      router.refresh();
    } catch {
      setErr('Lost connection.');
      setBusyId(null);
    }
  };

  const empty =
    view === 'upcoming'
      ? 'Nothing on the upcoming book.'
      : 'No reservations on the book today.';

  return (
    <div>
      <h1>Reservations</h1>
      <p className="subtitle">
        {view === 'today' ? "Today's book" : 'Upcoming book'} ·{' '}
        {rows.length} reservation{rows.length === 1 ? '' : 's'}
        {counts.people > 0 && <> · {counts.people} ppl on the book</>}
        {counts.seated > 0 && <> · {counts.seated} seated</>}
      </p>

      <div
        role="tablist"
        aria-label="Reservations view"
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <ViewTab href="/reservations?view=today" active={view === 'today'}>
          Today
        </ViewTab>
        <ViewTab href="/reservations?view=upcoming" active={view === 'upcoming'}>
          Upcoming
        </ViewTab>
      </div>

      {err && (
        <div
          role="alert"
          aria-live="assertive"
          className="card"
          style={{ borderLeft: '3px solid var(--red)', color: 'var(--red)', marginBottom: 16 }}
        >
          {err}
        </div>
      )}

      <AddReservationForm
        date={date}
        cookId={cookId}
        locationId={locationId}
        onSaved={() => router.refresh()}
      />

      {rows.length === 0 ? (
        <div className="empty" role="status" aria-live="polite" style={{ marginTop: 24 }}>
          {empty}
        </div>
      ) : (
        grouped.keys.map((hourKey) => (
          <section key={hourKey || 'unscheduled'} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 16, margin: '12px 0 8px', opacity: 0.85 }}>
              {hourKey ? formatHourHeader(hourKey) : 'Unscheduled'} ·{' '}
              {grouped.buckets.get(hourKey).length}
            </h2>
            <ul className="checklist" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {grouped.buckets.get(hourKey).map((r) => (
                <ReservationRow
                  key={r.id}
                  r={r}
                  busy={busyId === r.id}
                  cookId={cookId}
                  onSeat={() => patch(r.id, { seat: true })}
                  onComplete={() => patch(r.id, { complete: true })}
                  onCancel={() => patch(r.id, { cancel: true })}
                  onNoShow={() => patch(r.id, { no_show: true })}
                  onDelete={() => removeRow(r.id, r.party_name)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ViewTab({ href, active, children }) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active ? 'true' : 'false'}
      className={active ? 'btn primary' : 'btn'}
      style={{ textDecoration: 'none' }}
    >
      {children}
    </Link>
  );
}

function ReservationRow({ r, busy, cookId, onSeat, onComplete, onCancel, onNoShow, onDelete }) {
  const tone = STATUS_TONE[r.status] || '#666';
  const label = STATUS_LABEL[r.status] || r.status;
  const time = formatRowTime(r.reservation_at);
  // Closed states are completed/cancelled/no_show. We don't render an Undo
  // button: the PATCH route only mutates status via the seat/complete/
  // cancel/no_show verbs; `status` is NOT an editable field, so a PATCH
  // {status:'booked'} would 400 'no change'. Reverting a closed row needs
  // a new API verb (out of scope for M2.3).

  return (
    <li
      className="check-row"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        ...(r.status === 'seated' ? { borderLeft: '3px solid var(--green)', paddingLeft: 8 } : null),
      }}
    >
      <div style={{ flex: '1 1 240px' }}>
        <div className="check-name">
          {r.party_name}
          <span
            style={{
              marginLeft: 8,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#eee',
              color: '#333',
              fontSize: 12,
            }}
          >
            {r.party_size} ppl
          </span>
          {time && <span style={{ marginLeft: 8, opacity: 0.75, fontSize: 14 }}>{time}</span>}
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              color: '#fff',
              fontSize: 12,
              marginLeft: 8,
              background: tone,
            }}
          >
            {label}
          </span>
        </div>
        <div className="meta">
          {r.table_id && <>table {r.table_id} · </>}
          {r.phone && <>{r.phone} · </>}
          {r.notes && <>{r.notes}</>}
          {!r.table_id && !r.phone && !r.notes && (
            <em style={{ opacity: 0.5 }}>no notes</em>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {r.status === 'booked' && (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy || !cookId}
              onClick={onSeat}
              aria-label={`Seat ${r.party_name}`}
            >
              {cookId ? 'Seat' : 'Set cook first'}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onNoShow}>
              No-show
            </button>
            <button type="button" className="btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
        {r.status === 'seated' && (
          <button type="button" className="btn primary" disabled={busy} onClick={onComplete}>
            Done
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={onDelete}
          aria-label={`Delete reservation for ${r.party_name}`}
        >
          ×
        </button>
      </div>
    </li>
  );
}

function AddReservationForm({ date, cookId, locationId, onSaved }) {
  const [partyName, setPartyName] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [time, setTime] = useState('');
  const [tableId, setTableId] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const name = partyName.trim();
    if (!name) {
      setErr('Party name required.');
      return;
    }
    const sizeN = Number(partySize);
    if (!Number.isInteger(sizeN) || sizeN < 1 || sizeN > 50) {
      setErr('Party size must be 1..50.');
      return;
    }
    const hhmm = parseTimeTo24h(time);
    if (!hhmm) {
      setErr('Time required, e.g. "7:00 PM" or "19:00".');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          party_name: name,
          party_size: sizeN,
          reservation_at: `${date} ${hhmm}`,
          table_id: tableId.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Did not save — try again.');
        setBusy(false);
        return;
      }
      setPartyName('');
      setPartySize('2');
      setTime('');
      setTableId('');
      setPhone('');
      setNotes('');
      setBusy(false);
      onSaved?.();
    } catch {
      setErr('Lost connection — not saved.');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="card form-row"
      aria-busy={busy}
      style={{ marginBottom: 20 }}
      aria-describedby={err ? 'res-err' : undefined}
    >
      <div style={{ flex: '2 1 220px' }}>
        <label className="label" htmlFor="res-name">Party name</label>
        <input
          id="res-name"
          name="res-name"
          type="text"
          value={partyName}
          onChange={(e) => setPartyName(e.target.value)}
          placeholder="e.g. Smith"
          className="input form-field"
          autoComplete="off"
          aria-required="true"
        />
      </div>
      <div style={{ flex: '0 1 100px' }}>
        <label className="label" htmlFor="res-size">Party size</label>
        <input
          id="res-size"
          name="res-size"
          type="number"
          min={1}
          max={50}
          value={partySize}
          onChange={(e) => setPartySize(e.target.value)}
          className="input form-field"
          inputMode="numeric"
          aria-required="true"
        />
      </div>
      <div style={{ flex: '0 1 130px' }}>
        <label className="label" htmlFor="res-time">Time</label>
        <input
          id="res-time"
          name="res-time"
          type="text"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          placeholder="7:00 PM"
          className="input form-field"
          autoComplete="off"
          aria-required="true"
        />
      </div>
      <div style={{ flex: '0 1 100px' }}>
        <label className="label" htmlFor="res-table">Table</label>
        <input
          id="res-table"
          name="res-table"
          type="text"
          value={tableId}
          onChange={(e) => setTableId(e.target.value)}
          placeholder="opt."
          className="input form-field"
          autoComplete="off"
        />
      </div>
      <div style={{ flex: '1 1 140px' }}>
        <label className="label" htmlFor="res-phone">Phone</label>
        <input
          id="res-phone"
          name="res-phone"
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="opt."
          className="input form-field"
          autoComplete="off"
          inputMode="tel"
        />
      </div>
      <div style={{ flex: '2 1 200px' }}>
        <label className="label" htmlFor="res-notes">Notes</label>
        <input
          id="res-notes"
          name="res-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="opt."
          className="input form-field"
          maxLength={1000}
        />
      </div>
      <button type="submit" className="btn primary lg" disabled={busy}>
        {busy ? 'Saving…' : 'Add reservation'}
      </button>
      {err && (
        <div
          id="res-err"
          role="alert"
          aria-live="assertive"
          style={{ color: 'var(--red)', flexBasis: '100%' }}
        >
          {err}
        </div>
      )}
    </form>
  );
}

// Render the bucket header in 12h format from "HH:00" (24h key).
function formatHourHeader(hh00) {
  const m = /^(\d{2}):(\d{2})$/.exec(hh00);
  if (!m) return hh00;
  let h = Number(m[1]);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:00 ${ampm}`;
}

// Render a row's time portion in 12h. Input is "YYYY-MM-DD HH:MM".
function formatRowTime(at) {
  if (!at) return '';
  const m = /(\d{2}):(\d{2})$/.exec(at);
  if (!m) return '';
  let h = Number(m[1]);
  const mm = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ampm}`;
}

/**
 * Parse a loose time string into 'HH:MM' 24h. Returns null on failure.
 *
 * Accepted shapes (whitespace-tolerant, case-insensitive AM/PM):
 *   "7:00 PM"   → "19:00"
 *   "7:00pm"    → "19:00"
 *   "7pm"       → "19:00"
 *   "7"         → "07:00"   (bare hour: assume on the hour, 24h if >12, else AM)
 *   "19:00"     → "19:00"
 *   "19"        → "19:00"
 *   "7:30am"    → "07:30"
 *   "12:00 AM"  → "00:00"
 *   "12:30 PM"  → "12:30"
 *
 * Inline assertions (kept as a comment, not executed):
 *   parseTimeTo24h("7:00 PM")  === "19:00"
 *   parseTimeTo24h("7pm")      === "19:00"
 *   parseTimeTo24h("19:00")    === "19:00"
 *   parseTimeTo24h("19")       === "19:00"
 *   parseTimeTo24h("7:30am")   === "07:30"
 *   parseTimeTo24h("12:00 AM") === "00:00"
 *   parseTimeTo24h("12:30 PM") === "12:30"
 *   parseTimeTo24h("garbage")  === null
 */
function parseTimeTo24h(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] != null ? Number(m[2]) : 0;
  const ampm = m[3] || null;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (min < 0 || min > 59) return null;
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === 'am') {
      h = h === 12 ? 0 : h;
    } else {
      h = h === 12 ? 12 : h + 12;
    }
  } else {
    if (h < 0 || h > 23) return null;
  }
  const HH = String(h).padStart(2, '0');
  const MM = String(min).padStart(2, '0');
  return `${HH}:${MM}`;
}
