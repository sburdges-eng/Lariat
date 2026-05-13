// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
// Interactive board for the cooling subpage. Kitchen-tough: one button
// to start a batch, one button per stage to log a reading, red countdown
// when the clock is actually down. No modals — inline forms only.

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';

function fmtClock(mins) {
  if (mins === null || mins === undefined || !Number.isFinite(mins)) return '—';
  const sign = mins < 0 ? '-' : '';
  const m = Math.abs(Math.round(mins));
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, '0');
  return `${sign}${h}:${mm}`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function CoolingBoard({ open, scan, closed, date, locationId }) {
  const router = useRouter();
  const [cookId, setCookId] = useState('');
  const [item, setItem] = useState('');
  const [station, setStation] = useState('');
  const [startTemp, setStartTemp] = useState('');
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  // Reading panel state is keyed by batch id so two cooks can log two
  // batches at once without their inputs colliding.
  const [reading, setReading] = useState({});
  const [note, setNote] = useState({});
  const [saving, setSaving] = useState({});
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    setCookId(window.localStorage.getItem('lariat_cook') || '');
  }, []);

  // Live clock tick — the deadline countdown stays accurate without a
  // server round-trip.
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const openLive = useMemo(() => {
    // Rebuild scan-like data from current time so countdowns don't stall
    // between server renders. For batches already past stage-2 close,
    // we keep the server scan's classification.
    return open.map((b) => {
      const serverScan = scan[b.id] || null;
      const startedMs = Date.parse(b.started_at);
      const elapsed = (nowTs - startedMs) / 60000;
      const stage1Elapsed = b.stage1_at ? (Date.parse(b.stage1_at) - startedMs) / 60000 : null;
      const inStage1 = !b.stage1_at;
      const stage1Remaining = 120 - elapsed;
      const stage2Remaining = stage1Elapsed !== null ? 240 - (elapsed - stage1Elapsed) : null;
      return {
        ...b,
        serverScan,
        stage: inStage1 ? 1 : 2,
        remaining: inStage1 ? stage1Remaining : stage2Remaining,
      };
    });
  }, [open, scan, nowTs]);

  const startBatch = async (e) => {
    e.preventDefault();
    if (!item.trim()) return;
    setStarting(true);
    setErr('');
    try {
      const res = await fetch('/api/cooling', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          item: item.trim(),
          station_id: station.trim() || null,
          started_at: new Date().toISOString(),
          start_reading_f: startTemp ? Number(startTemp) : null,
          cook_id: cookId || null,
          location_id: locationId,
          shift_date: date,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || 'Didn\u2019t save — try again');
        return;
      }
      setItem('');
      setStation('');
      setStartTemp('');
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setStarting(false);
    }
  };

  const logReading = async (id) => {
    const val = Number(reading[id]);
    if (!Number.isFinite(val)) {
      setErr('Enter a temperature in °F');
      return;
    }
    setSaving((s) => ({ ...s, [id]: true }));
    setErr('');
    try {
      const res = await fetch('/api/cooling', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          reading_f: val,
          at: new Date().toISOString(),
          corrective_action: note[id]?.trim() || null,
          cook_id: cookId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j.needs_corrective_action) {
          setErr(`${j.error} — enter a note and re-submit`);
        } else {
          setErr(j.error || 'Didn\u2019t save — try again');
        }
        return;
      }
      setReading((r) => ({ ...r, [id]: '' }));
      setNote((n) => ({ ...n, [id]: '' }));
      router.refresh();
    } catch {
      setErr('Lost connection — not saved');
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
  };

  return (
    <div className="cooling-page">
      <h1>Cooling</h1>
      <p className="subtitle">
        Two-stage cool — 135°F → 70°F inside 2 hours, then 70°F → 41°F inside 4 more. Start a batch the moment it leaves the hot line.
      </p>

      {err && (
        <div className="alert alert-red" role="alert" aria-live="assertive">
          {err}
        </div>
      )}

      <section className="cooling-card cooling-new" aria-labelledby="cooling-new-h">
        <form
          onSubmit={startBatch}
          className="cooling-new-form"
          aria-busy={starting}
          aria-labelledby="cooling-new-h"
        >
          <div className="cooling-new-label" id="cooling-new-h">New batch</div>
          <label htmlFor="cooling-item" className="sr-only">Item</label>
          <input
            id="cooling-item"
            name="cooling-item"
            type="text"
            placeholder="What is it? e.g. black beans, brisket"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            aria-label="Batch item"
          />
          <label htmlFor="cooling-station" className="sr-only">Station</label>
          <input
            id="cooling-station"
            name="cooling-station"
            type="text"
            placeholder="Station (optional)"
            value={station}
            onChange={(e) => setStation(e.target.value)}
            autoComplete="off"
            aria-label="Station (optional)"
          />
          <label htmlFor="cooling-start-temp" className="sr-only">Start temp °F</label>
          <input
            id="cooling-start-temp"
            name="cooling-start-temp"
            type="text"
            placeholder="Start temp °F (optional)"
            inputMode="decimal"
            pattern="-?[0-9]*([.,][0-9]+)?"
            autoComplete="off"
            value={startTemp}
            onChange={(e) => setStartTemp(e.target.value)}
            aria-label="Start temperature in Fahrenheit (optional)"
          />
          <button
            type="submit"
            disabled={starting}
            aria-label={starting ? 'Starting cooling batch' : 'Start cooling batch'}
          >
            {starting ? 'Starting…' : 'Start cooling'}
          </button>
        </form>
      </section>

      <section aria-labelledby="cooling-open-h">
        <h2 className="section-h" id="cooling-open-h">Open batches ({openLive.length})</h2>
        {openLive.length === 0 && (
          <div className="empty-row" role="status" aria-live="polite">
            Nothing cooling right now. Start a batch above the moment hot food leaves the line.
          </div>
        )}
        <div className="cooling-list">
          {openLive.map((b) => {
            const tone =
              b.remaining !== null && b.remaining < 0
                ? 'red'
                : b.remaining !== null && b.remaining <= 30
                ? 'amber'
                : 'green';
            const stageCeiling = b.stage === 1 ? 70 : 41;
            const readingId = `cooling-read-${b.id}`;
            const noteId = `cooling-note-${b.id}`;
            return (
              <article
                key={b.id}
                className={`cooling-batch cooling-tone-${tone}`}
                aria-label={`${b.item} — stage ${b.stage} cooling${tone === 'red' ? ' — over target' : ''}`}
              >
                <header className="cooling-batch-head">
                  <div>
                    <div className="cooling-batch-item">{b.item}</div>
                    <div className="cooling-batch-meta">
                      started <time dateTime={b.started_at}>{fmtTime(b.started_at)}</time>
                      {b.start_reading_f != null && ` @ ${b.start_reading_f}°F`}
                      {b.station_id && ` · ${b.station_id}`}
                    </div>
                  </div>
                  <div className="cooling-clock" aria-live="polite">
                    <div className="cooling-clock-big">{fmtClock(b.remaining)}</div>
                    <div className="cooling-clock-lbl">
                      Stage {b.stage} · {tone === 'red' ? 'OVER' : `to ≤${stageCeiling}°F`}
                    </div>
                  </div>
                </header>

                {b.stage1_at && (
                  <div className="cooling-stage-line">
                    Stage 1 closed <time dateTime={b.stage1_at}>{fmtTime(b.stage1_at)}</time> @ {b.stage1_reading_f}°F
                  </div>
                )}

                <div className="cooling-reading-row" role="group" aria-label={`Log reading for ${b.item}`}>
                  <label htmlFor={readingId} className="sr-only">Current temperature in Fahrenheit</label>
                  <input
                    id={readingId}
                    name={readingId}
                    type="text"
                    inputMode="decimal"
                    pattern="-?[0-9]*([.,][0-9]+)?"
                    autoComplete="off"
                    enterKeyHint="next"
                    placeholder={`Current temp °F (target ≤ ${stageCeiling})`}
                    value={reading[b.id] || ''}
                    onChange={(e) =>
                      setReading((r) => ({ ...r, [b.id]: e.target.value }))
                    }
                    aria-label={`Current temperature for ${b.item}, target at or below ${stageCeiling}°F`}
                  />
                  <label htmlFor={noteId} className="sr-only">Corrective action (if out of range)</label>
                  <input
                    id={noteId}
                    name={noteId}
                    type="text"
                    autoComplete="off"
                    maxLength={500}
                    placeholder="Corrective action (if out of range)"
                    value={note[b.id] || ''}
                    onChange={(e) =>
                      setNote((n) => ({ ...n, [b.id]: e.target.value }))
                    }
                    aria-label={`Corrective action for ${b.item} (fill if out of range)`}
                  />
                  <button
                    type="button"
                    onClick={() => logReading(b.id)}
                    disabled={saving[b.id]}
                    aria-label={saving[b.id] ? `Saving reading for ${b.item}` : `Log stage ${b.stage} reading for ${b.item}`}
                  >
                    {saving[b.id] ? 'Saving…' : `Log stage ${b.stage}`}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {closed.length > 0 && (
        <section aria-labelledby="cooling-closed-h">
          <h2 className="section-h" id="cooling-closed-h">Closed today ({closed.length})</h2>
          <ul className="cooling-closed-list" aria-label="Cooling batches closed today" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {closed.map((c) => (
              <li key={c.id} className={`cooling-closed cooling-tone-${c.status === 'breach' ? 'red' : 'green'}`}>
                <div className="cooling-closed-item">{c.item}</div>
                <div className="cooling-closed-meta">
                  <time dateTime={c.started_at}>{fmtTime(c.started_at)}</time>
                  {' → '}
                  <time dateTime={c.stage2_at || c.stage1_at}>{fmtTime(c.stage2_at || c.stage1_at)}</time>
                  {c.stage2_reading_f != null && ` · closed @ ${c.stage2_reading_f}°F`}
                </div>
                <div className="cooling-closed-status">
                  {c.status === 'breach' ? `Breach · ${c.breach_reason || 'see note'}` : 'OK'}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
