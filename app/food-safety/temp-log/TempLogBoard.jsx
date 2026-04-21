'use client';
// Temp-log board — grid of CCP tiles + quick entry.
//
// Tile color encodes tile status from classifyReadings:
//   green  — every reading today was in range
//   yellow — at least one out-of-range reading carried a corrective note
//   red    — out-of-range reading without a note, OR only invalid readings
//   gray   — point hasn't been read yet today
//
// The entry form lives below the grid. Submitting posts to
// /api/temp-log; a 422 (needs_corrective_action) swaps a "corrective
// action" field into the form instead of silently failing.

import { useEffect, useMemo, useState } from 'react';

function fmtTime(iso) {
  if (!iso) return '—';
  // sqlite stores `datetime('now')` as 'YYYY-MM-DD HH:MM:SS' in UTC,
  // which new Date() parses as local by default. Force the UTC parse
  // by appending Z only if no timezone is present — that way the
  // "last read at" label reflects the actual server clock, not an
  // off-by-several-hours ghost.
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtTemp(f) {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—';
  // One decimal is the probe's honest resolution; zero decimals looks
  // rounded-up to inspectors.
  return `${(Math.round(f * 10) / 10).toFixed(1)}°F`;
}

function boundLabel(p) {
  if (p.required_min_f !== null && p.required_max_f !== null) {
    return `${p.required_min_f}–${p.required_max_f}°F`;
  }
  if (p.required_min_f !== null) return `≥ ${p.required_min_f}°F`;
  if (p.required_max_f !== null) return `≤ ${p.required_max_f}°F`;
  return '';
}

export default function TempLogBoard({
  initialEntries,
  initialSummary,
  points,
  locationId,
  date,
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [entries, setEntries] = useState(initialEntries);
  const [cookId, setCookId] = useState('');

  const [pointId, setPointId] = useState(points[0]?.id || '');
  const [reading, setReading] = useState('');
  const [note, setNote] = useState('');
  const [needsNote, setNeedsNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  const totals = useMemo(() => {
    let green = 0, yellow = 0, red = 0, gray = 0;
    for (const s of summary) {
      if (s.status === 'green') green += 1;
      else if (s.status === 'yellow') yellow += 1;
      else if (s.status === 'red') red += 1;
      else gray += 1;
    }
    return { green, yellow, red, gray };
  }, [summary]);

  const refetch = async () => {
    try {
      const q = locationId && locationId !== 'default' ? `&location=${encodeURIComponent(locationId)}` : '';
      const res = await fetch(`/api/temp-log?date=${encodeURIComponent(date)}${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.entries)) setEntries(body.entries);
      if (Array.isArray(body.summary)) setSummary(body.summary);
    } catch {
      // Ignore — the board keeps the last-good snapshot. The user can
      // refresh manually if a refetch fails; we don't want a red alert
      // banner just because the network blipped.
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!pointId) return;
    const val = Number(reading);
    if (!Number.isFinite(val)) {
      setErr('Enter a temperature in °F');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/temp-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shift_date: date,
          location_id: locationId,
          point_id: pointId,
          reading_f: val,
          corrective_action: note.trim() || null,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (res.status === 422 && j.needs_corrective_action) {
          setNeedsNote(true);
          setErr(`${j.error || 'Out of range'} — add a corrective action and re-submit.`);
          return;
        }
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setReading('');
      setNote('');
      setNeedsNote(false);
      await refetch();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  // Check live whether the typed value would be out of range for the
  // selected point. If yes, surface the corrective-action field
  // pre-emptively so the cook doesn't have to submit-and-retry.
  const selectedPoint = useMemo(
    () => points.find((p) => p.id === pointId) || null,
    [points, pointId],
  );
  const liveOutOfRange = useMemo(() => {
    if (!selectedPoint) return false;
    if (reading.trim() === '') return false;
    const v = Number(reading);
    if (!Number.isFinite(v)) return false;
    const { required_min_f: min, required_max_f: max } = selectedPoint;
    if (min !== null && v < min) return true;
    if (max !== null && v > max) return true;
    return false;
  }, [selectedPoint, reading]);
  const showNoteField = needsNote || liveOutOfRange;

  return (
    <div className="tl-page">
      <h1>Temp log</h1>
      <p className="subtitle">
        FDA §3-501.16 cold/hot hold, §3-401.11 cook temps, §3-403.11 reheat, §3-202.11 receiving.
        Every CCP the inspector asks for, in one grid.
      </p>

      <div className="tl-totals">
        <span className="tl-tot tl-tot-green">{totals.green} in spec</span>
        <span className="tl-tot tl-tot-yellow">{totals.yellow} corrective</span>
        <span className="tl-tot tl-tot-red">{totals.red} critical</span>
        <span className="tl-tot tl-tot-gray">{totals.gray} not logged yet</span>
      </div>

      {err && <div className="alert alert-red">{err}</div>}

      <section>
        <h2 className="section-h">CCPs ({summary.length})</h2>
        <div className="tl-grid">
          {summary.map((s) => (
            <article key={s.point_id} className={`tl-tile tl-tone-${s.status}`}>
              <header className="tl-tile-head">
                <span className="tl-tile-name">{s.label}</span>
                <span className="tl-tile-ccp">{s.ccp_id}</span>
              </header>
              <div className="tl-tile-big">
                {s.last_reading_f !== null ? fmtTemp(s.last_reading_f) : '—'}
              </div>
              <div className="tl-tile-meta">
                {s.last_reading_at ? `Last: ${fmtTime(s.last_reading_at)}` : 'No reading yet'}
                {' · '}
                target {boundLabel(s)}
              </div>
              <div className="tl-tile-status">
                {s.total_readings === 0 && 'Not logged today'}
                {s.total_readings > 0 && s.status === 'green' && `${s.total_readings} in range`}
                {s.status === 'yellow' && `${s.corrective_count} corrective (noted) · ${s.ok_count} ok`}
                {s.status === 'red' && s.critical_count > 0 && `${s.critical_count} critical — no note on fix`}
                {s.status === 'red' && s.critical_count === 0 && s.invalid_count > 0 && `${s.invalid_count} invalid reading(s)`}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="tl-card">
        <h2 className="section-h">Log a reading</h2>
        <form onSubmit={submit} className="tl-form">
          <label>
            <span>Point (CCP)</span>
            <select value={pointId} onChange={(e) => setPointId(e.target.value)}>
              {points.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.ccp_id})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Reading °F {selectedPoint ? `(${boundLabel(selectedPoint)})` : ''}</span>
            <input
              inputMode="decimal"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              required
            />
          </label>
          {showNoteField && (
            <label className={`tl-form-wide ${needsNote ? 'tl-form-need' : ''}`}>
              <span>Corrective action (required — reading is out of range)</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. moved product to reach-in, called tech, re-tested at 39°F"
                maxLength={500}
              />
            </label>
          )}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Record reading'}
          </button>
        </form>
      </section>

      {entries && entries.length > 0 && (
        <section>
          <h2 className="section-h">Today&apos;s readings ({entries.length})</h2>
          <div className="tl-entries">
            {entries.map((e) => {
              const p = points.find((x) => x.id === e.point_id);
              const inRange =
                (e.required_min_f === null || e.required_min_f === undefined || e.reading_f >= e.required_min_f) &&
                (e.required_max_f === null || e.required_max_f === undefined || e.reading_f <= e.required_max_f);
              const note = (e.corrective_action || '').trim();
              const tone = inRange ? 'green' : note ? 'yellow' : 'red';
              return (
                <div key={e.id} className={`tl-entry tl-tone-${tone}`}>
                  <div className="tl-entry-main">
                    <span className="tl-entry-name">{e.point_label || p?.label || e.point_id}</span>
                    <span className="tl-entry-temp">{fmtTemp(e.reading_f)}</span>
                  </div>
                  <div className="tl-entry-meta">
                    {fmtTime(e.created_at)}
                    {e.cook_id ? ` · ${e.cook_id}` : ''}
                    {note ? ` · note: ${note}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
