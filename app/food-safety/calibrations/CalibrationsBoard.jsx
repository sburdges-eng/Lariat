// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
// Calibrations board — per-probe tiles + quick-entry form.
//
// Tile color mirrors the rest of the food-safety grid:
//   green  — last calibration was a pass AND within the frequency window
//   yellow — last pass, but ≤ 7 days from next_due (due_soon)
//   red    — last calibration FAILED, or overdue past next_due
//   gray   — no calibration on record yet (unknown)
//
// The entry form does a client-side preview of the expected reading
// for the chosen method at Lariat's elevation (197.8°F boiling at
// 7800 ft) so the operator knows the target BEFORE submitting.
// The server is still the source of truth; the preview is a hint.

import { useEffect, useMemo, useState } from 'react';

const FDA_CITATION = 'FDA §4-502.11 — temp measuring device accurate within ±2°F';
const BOIL_FT_PER_F = 550;

function fmtTime(iso) {
  if (!iso) return '—';
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTemp(f) {
  if (f === null || f === undefined || !Number.isFinite(f)) return '—';
  return `${(Math.round(f * 10) / 10).toFixed(1)}°F`;
}

function boilingAt(elev) {
  if (!Number.isFinite(elev) || elev <= 0) return 212;
  return 212 - elev / BOIL_FT_PER_F;
}

function expectedFor(method, elev) {
  if (method === 'ice_point') return 32;
  if (method === 'boiling_point') return boilingAt(elev);
  return null;
}

const METHOD_LABELS = {
  ice_point: 'Ice-point (32°F slurry)',
  boiling_point: 'Boiling-point (altitude-adjusted)',
};

function statusLabel(status) {
  switch (status) {
    case 'ok':
      return 'In calibration';
    case 'due_soon':
      return 'Due for re-cal soon';
    case 'overdue':
      return 'Overdue — recalibrate';
    case 'failed':
      return 'FAILED last cal — unreliable';
    case 'unknown':
      return 'No calibration on record';
    default:
      return status;
  }
}

function statusTone(status) {
  if (status === 'failed' || status === 'overdue') return 'red';
  if (status === 'due_soon') return 'yellow';
  if (status === 'unknown') return 'gray';
  return 'green';
}

export default function CalibrationsBoard({
  initialEntries,
  initialSummary,
  methods,
  locationId,
  defaultElevationFt,
  toleranceF,
  defaultFrequencyDays,
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [entries, setEntries] = useState(initialEntries);
  const [cookId, setCookId] = useState('');

  const [probeId, setProbeId] = useState('');
  const [method, setMethod] = useState(methods[0] || 'ice_point');
  const [reading, setReading] = useState('');
  const [elevationFt, setElevationFt] = useState(String(defaultElevationFt));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  // Tile totals across statuses.
  const totals = useMemo(() => {
    let green = 0, yellow = 0, red = 0, gray = 0;
    for (const s of summary) {
      if (s.status === 'ok') green += 1;
      else if (s.status === 'due_soon') yellow += 1;
      else if (s.status === 'overdue' || s.status === 'failed') red += 1;
      else gray += 1;
    }
    return { green, yellow, red, gray };
  }, [summary]);

  const knownProbeIds = useMemo(
    () => summary.map((s) => s.thermometer_id).filter(Boolean),
    [summary],
  );

  const elevNum = Number(elevationFt);
  const expected = expectedFor(method, Number.isFinite(elevNum) ? elevNum : defaultElevationFt);
  const readingNum = reading.trim() === '' ? null : Number(reading);
  const livePass =
    expected !== null && readingNum !== null && Number.isFinite(readingNum)
      ? Math.abs(readingNum - expected) <= toleranceF
      : null;

  const refetch = async () => {
    try {
      const q =
        locationId && locationId !== 'default'
          ? `?location=${encodeURIComponent(locationId)}&entries=1`
          : '?entries=1';
      const res = await fetch(`/api/thermometer-calibrations${q}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.summary)) setSummary(body.summary);
      if (Array.isArray(body.entries)) setEntries(body.entries);
    } catch {
      /* ignore — keep last-good snapshot */
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!probeId.trim()) {
      setErr('Thermometer id is required');
      return;
    }
    const val = Number(reading);
    if (!Number.isFinite(val)) {
      setErr('Enter the probe reading in °F');
      return;
    }
    // On a fail, require a corrective note — this is operator
    // discipline, not an API-enforced gate (the server persists
    // either way). Matches the pattern used on temp-log out-of-range
    // writes.
    if (livePass === false && !note.trim()) {
      setErr(
        'This reading fails the ±2°F tolerance — add a note (e.g. "retired probe-2, pulled probe-5 from stock") before recording.',
      );
      return;
    }
    setSaving(true);
    setErr('');
    setInfo('');
    try {
      const res = await fetch('/api/thermometer-calibrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          thermometer_id: probeId.trim(),
          method,
          reading_f: val,
          elevation_ft: Number.isFinite(elevNum) ? elevNum : defaultElevationFt,
          note: note.trim() || null,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      const j = await res.json();
      setInfo(
        j.decision.status === 'pass'
          ? `Pass — within ±${toleranceF}°F of target ${fmtTemp(j.decision.expected_f)}.`
          : `FAIL logged — ${j.decision.reason}. Probe flagged until a passing cal is recorded.`,
      );
      setReading('');
      setNote('');
      await refetch();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tl-page">
      <h1>Thermometer calibrations</h1>
      <p className="subtitle">
        {FDA_CITATION}. Ice-point = 32°F. Boiling-point at Lariat (elevation {defaultElevationFt} ft) ≈ {fmtTemp(boilingAt(defaultElevationFt))} (water boils lower at altitude).
        Default frequency: every {defaultFrequencyDays} days per probe. Both passes and fails are recorded for the audit trail.
      </p>

      <div className="tl-totals" role="group" aria-label="Calibration totals">
        <span className="tl-tot tl-tot-green" aria-label={`${totals.green} probes in calibration`}>{totals.green} in calibration</span>
        <span className="tl-tot tl-tot-yellow" aria-label={`${totals.yellow} probes due soon`}>{totals.yellow} due soon</span>
        <span className="tl-tot tl-tot-red" aria-label={`${totals.red} probes overdue or failed`}>{totals.red} overdue / failed</span>
        <span className="tl-tot tl-tot-gray" aria-label={`${totals.gray} probes with unknown status`}>{totals.gray} unknown</span>
      </div>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}
      {info && (
        <div className="alert" role="status" aria-live="polite">
          {info}
        </div>
      )}

      <section>
        <h2 className="section-h">Probes ({summary.length})</h2>
        {summary.length === 0 && (
          <p className="muted">
            No probe has been calibrated yet. Log an ice-point or boiling-point
            reading below — one tile will appear per probe id.
          </p>
        )}
        <div className="tl-grid">
          {summary.map((s) => {
            const tone = statusTone(s.status);
            return (
              <article
                key={s.thermometer_id}
                className={`tl-tile tl-tone-${tone}`}
                title={FDA_CITATION}
              >
                <header className="tl-tile-head">
                  <span className="tl-tile-name">{s.thermometer_id}</span>
                  <span className="tl-tile-ccp" title={FDA_CITATION}>
                    ±{toleranceF}°F
                  </span>
                </header>
                <div className="tl-tile-big">
                  {s.last_reading_f !== null ? fmtTemp(s.last_reading_f) : '—'}
                </div>
                <div className="tl-tile-meta">
                  {s.last_calibrated_at
                    ? `Last: ${fmtTime(s.last_calibrated_at)}`
                    : 'Never calibrated'}
                  {s.last_method ? ` · ${METHOD_LABELS[s.last_method] || s.last_method}` : ''}
                </div>
                <div className="tl-tile-status">
                  {statusLabel(s.status)}
                  {s.next_due_at ? ` · next: ${fmtDate(s.next_due_at)}` : ''}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="tl-card" aria-labelledby="cal-log-h">
        <h2 className="section-h" id="cal-log-h">Log a calibration</h2>
        <form onSubmit={submit} className="tl-form" aria-busy={saving}>
          <label htmlFor="cal-probe">
            <span>Thermometer id</span>
            <input
              id="cal-probe"
              name="cal-probe"
              type="text"
              value={probeId}
              onChange={(e) => setProbeId(e.target.value)}
              placeholder="e.g. probe-3, IR-gun-A"
              list="lariat-known-probes"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="next"
              required
              maxLength={64}
            />
            <datalist id="lariat-known-probes">
              {knownProbeIds.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
          </label>
          <label htmlFor="cal-method">
            <span>Method</span>
            <select
              id="cal-method"
              name="cal-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m] || m}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="cal-elev">
            <span>Elevation ft (defaults {defaultElevationFt})</span>
            <input
              id="cal-elev"
              name="cal-elev"
              type="text"
              inputMode="decimal"
              pattern="-?[0-9]*([.,][0-9]+)?"
              autoComplete="off"
              value={elevationFt}
              onChange={(e) => setElevationFt(e.target.value)}
              placeholder={String(defaultElevationFt)}
            />
          </label>
          <label htmlFor="cal-reading">
            <span>
              Reading °F {expected !== null ? `(target ${fmtTemp(expected)} ±${toleranceF})` : ''}
            </span>
            <input
              id="cal-reading"
              name="cal-reading"
              type="text"
              inputMode="decimal"
              pattern="-?[0-9]*([.,][0-9]+)?"
              autoComplete="off"
              value={reading}
              onChange={(e) => setReading(e.target.value)}
              className={
                livePass === true ? 'tl-live-green' : livePass === false ? 'tl-live-red' : ''
              }
              aria-invalid={livePass === false ? 'true' : undefined}
              required
            />
          </label>
          <label
            htmlFor="cal-note"
            className={`tl-form-wide ${livePass === false ? 'tl-form-need' : ''}`}
          >
            <span>
              Note {livePass === false ? '(required on fail — what was done about it)' : '(optional)'}
            </span>
            <input
              id="cal-note"
              name="cal-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. retired probe-2; pulled probe-5 from stock"
              maxLength={500}
              autoComplete="off"
              required={livePass === false}
              aria-required={livePass === false ? 'true' : undefined}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving calibration' : 'Record calibration'}
          >
            {saving ? 'Saving…' : 'Record calibration'}
          </button>
        </form>
      </section>

      {entries && entries.length > 0 && (
        <section>
          <h2 className="section-h">Recent calibrations ({entries.length})</h2>
          <div className="tl-entries">
            {entries.slice(0, 25).map((e) => {
              const pass = e.passed === 1;
              const tone = pass ? 'green' : 'red';
              return (
                <div key={e.id} className={`tl-entry tl-tone-${tone}`}>
                  <div className="tl-entry-main">
                    <span className="tl-entry-name">
                      {e.thermometer_id} · {METHOD_LABELS[e.method] || e.method}
                    </span>
                    <span className="tl-entry-temp">
                      {fmtTemp(e.before_reading_f)} · {pass ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div className="tl-entry-meta">
                    {fmtTime(e.calibrated_at)}
                    {e.cook_id ? ` · ${e.cook_id}` : ''}
                    {e.action_taken ? ` · ${e.action_taken}` : ''}
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
