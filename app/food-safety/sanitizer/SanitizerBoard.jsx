'use client';
// Sanitizer ppm entry + latest-per-point board.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

const CHEMISTRIES = [
  { id: 'chlorine', label: 'Chlorine' },
  { id: 'quat', label: 'Quaternary ammonia' },
  { id: 'iodine', label: 'Iodine' },
  { id: 'other', label: 'Other' },
];

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function SanitizerBoard({ rows, latest, knownPoints, locationId, date }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [pointLabel, setPointLabel] = useState('');
  const [chemistry, setChemistry] = useState('chlorine');
  const [ppm, setPpm] = useState('');
  const [waterTemp, setWaterTemp] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [needsNote, setNeedsNote] = useState(false);

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  // Points that exist in DEFAULT_POINTS but have no reading today yet —
  // surfaces the "you haven't checked this bucket" nudge.
  const missingToday = useMemo(() => {
    const seen = new Set(latest.map((l) => l.point_label.toLowerCase()));
    return knownPoints.filter((p) => !seen.has(p.label.toLowerCase()));
  }, [knownPoints, latest]);

  const submit = async (e) => {
    e.preventDefault();
    if (!pointLabel.trim() || !ppm) return;
    setSaving(true);
    setErr('');
    try {
      const res = await fetch('/api/sanitizer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          point_label: pointLabel.trim(),
          chemistry,
          concentration_ppm: Number(ppm),
          water_temp_f: waterTemp ? Number(waterTemp) : null,
          corrective_action: note.trim() || null,
          cook_id: cookId || null,
          location_id: locationId,
          shift_date: date,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.needs_corrective_action) {
          setNeedsNote(true);
          setErr(`${j.error} — add a corrective action.`);
        } else {
          setErr(j.error || 'Didn\u2019t save — try again');
        }
        return;
      }
      setPointLabel('');
      setPpm('');
      setWaterTemp('');
      setNote('');
      setNeedsNote(false);
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving(false);
    }
  };

  const prefillPoint = (p) => {
    setPointLabel(p.label);
    setChemistry(p.chemistry);
  };

  return (
    <div className="sani-page">
      <h1>Sanitizer</h1>
      <p className="subtitle">
        FDA §4-703.11 — ppm must land inside the band for the chemistry, or the surface is not sanitized.
      </p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section aria-labelledby="sani-latest-h">
        <h2 className="section-h" id="sani-latest-h">Latest per point ({latest.length})</h2>
        {latest.length === 0 && (
          <div className="empty-row" role="status" aria-live="polite">No readings today yet. Test the dish pit and buckets before service.</div>
        )}
        <div className="sani-grid">
          {latest.map((l) => {
            const tone = l.status === 'ok' ? 'green' : 'red';
            return (
              <article key={l.id} className={`sani-tile sani-tone-${tone}`}>
                <div className="sani-tile-head">
                  <span className="sani-tile-name">{l.point_label}</span>
                  <span className="sani-tile-ppm">{l.concentration_ppm} ppm</span>
                </div>
                <div className="sani-tile-meta">
                  {l.chemistry}
                  {l.water_temp_f != null && ` · ${l.water_temp_f}°F`}
                  {' · '}
                  {fmtTime(l.created_at)}
                </div>
                <div className="sani-tile-status">
                  {l.status === 'ok'
                    ? 'In spec'
                    : `${l.status.toUpperCase()} (${l.required_min_ppm}–${l.required_max_ppm})`}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {missingToday.length > 0 && (
        <section className="sani-missing" aria-labelledby="sani-missing-h">
          <h2 className="section-h" id="sani-missing-h">Still to check today</h2>
          <div className="sani-missing-list" role="list">
            {missingToday.map((p) => (
              <button
                key={p.id}
                type="button"
                className="sani-missing-chip"
                onClick={() => prefillPoint(p)}
                aria-label={`Prefill form for ${p.label} using ${p.chemistry}`}
              >
                {p.label} ({p.chemistry})
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="sani-card" aria-labelledby="sani-log-h">
        <h2 className="section-h" id="sani-log-h">Log a reading</h2>
        <form onSubmit={submit} className="sani-form" aria-busy={saving}>
          <label htmlFor="sani-point">
            <span>Point</span>
            <input
              id="sani-point"
              name="sani-point"
              type="text"
              value={pointLabel}
              onChange={(e) => setPointLabel(e.target.value)}
              placeholder="e.g. dish pit final rinse"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label htmlFor="sani-chem">
            <span>Chemistry</span>
            <select
              id="sani-chem"
              name="sani-chem"
              value={chemistry}
              onChange={(e) => setChemistry(e.target.value)}
            >
              {CHEMISTRIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="sani-ppm">
            <span>Strip reading (ppm)</span>
            <input
              id="sani-ppm"
              name="sani-ppm"
              type="text"
              inputMode="decimal"
              pattern="[0-9]*([.,][0-9]+)?"
              autoComplete="off"
              enterKeyHint="next"
              value={ppm}
              onChange={(e) => setPpm(e.target.value)}
              required
            />
          </label>
          <label htmlFor="sani-water">
            <span>Water temp °F {chemistry === 'chlorine' ? '(required for band)' : '(optional)'}</span>
            <input
              id="sani-water"
              name="sani-water"
              type="text"
              inputMode="decimal"
              pattern="-?[0-9]*([.,][0-9]+)?"
              autoComplete="off"
              value={waterTemp}
              onChange={(e) => setWaterTemp(e.target.value)}
            />
          </label>
          <label
            htmlFor="sani-note"
            className={`sani-form-wide ${needsNote ? 'sani-form-need' : ''}`}
          >
            <span>Corrective action {needsNote ? '(required — out of spec)' : '(required if out of spec)'}</span>
            <input
              id="sani-note"
              name="sani-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. re-dosed bucket, re-tested at 200 ppm, all surfaces re-wiped"
              autoComplete="off"
              maxLength={500}
              required={needsNote}
              aria-required={needsNote ? 'true' : undefined}
              aria-invalid={needsNote ? 'true' : undefined}
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? 'Saving sanitizer reading' : 'Record sanitizer reading'}
          >
            {saving ? 'Saving…' : 'Record reading'}
          </button>
        </form>
      </section>
    </div>
  );
}
