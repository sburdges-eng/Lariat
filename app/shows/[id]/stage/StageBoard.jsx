'use client';
import { useState, useCallback } from 'react';
import { humanize } from '../../../../lib/userError';

const EMPTY_RIDER = '{}';

function fmtJsonField(v, fallback) {
  if (!v) return fallback;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return fallback;
  }
}

function parseJson(s, fallback) {
  if (!s.trim()) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default function StageBoard({
  showId,
  locationId,
  initialSetup,
  completeness,
  roomConfigs,
}) {
  const [roomConfig, setRoomConfig] = useState(initialSetup?.room_config ?? '');
  const [runOfShowText, setRunOfShowText] = useState(
    fmtJsonField(initialSetup?.run_of_show, '[]'),
  );
  const [hospitalityText, setHospitalityText] = useState(
    fmtJsonField(initialSetup?.hospitality_rider, EMPTY_RIDER),
  );
  const [techText, setTechText] = useState(
    fmtJsonField(initialSetup?.tech_rider, EMPTY_RIDER),
  );
  const [notes, setNotes] = useState(initialSetup?.notes ?? '');
  const [score, setScore] = useState(completeness?.score ?? 0);
  const [saveState, setSaveState] = useState({ status: 'idle', error: null });

  const commit = useCallback(
    async (override = {}) => {
      if (!roomConfig) {
        setSaveState({ status: 'error', error: 'Pick a room first' });
        return;
      }
      const runOfShow = parseJson(override.runOfShow ?? runOfShowText, []);
      const hospitality = parseJson(override.hospitality ?? hospitalityText, {});
      const tech = parseJson(override.tech ?? techText, {});
      if (runOfShow == null || hospitality == null || tech == null) {
        setSaveState({ status: 'error', error: 'A JSON field is invalid' });
        return;
      }
      setSaveState({ status: 'saving', error: null });
      try {
        const res = await fetch(`/api/shows/${showId}/stage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            room_config: override.roomConfig ?? roomConfig,
            run_of_show: runOfShow,
            hospitality_rider: hospitality,
            tech_rider: tech,
            notes: notes || null,
            location_id: locationId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setScore(data.completeness?.score ?? score);
        setSaveState({ status: 'saved', error: null });
      } catch (err) {
        console.error('StageBoard save failed:', err);
        setSaveState({ status: 'error', error: humanize(err) });
      }
    },
    [showId, locationId, roomConfig, runOfShowText, hospitalityText, techText, notes, score],
  );

  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row-meta" style={{ marginBottom: 6 }}>
        Completeness · {(score * 100).toFixed(0)}%
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Room layout</div>
        <select
          className="input"
          value={roomConfig}
          onChange={(e) => setRoomConfig(e.target.value)}
          onBlur={() => roomConfig !== (initialSetup?.room_config ?? '') && commit({ roomConfig })}
        >
          <option value="">— Pick a room —</option>
          {Object.entries(roomConfigs).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.name} · cap {cfg.capacity}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Run of show (JSON array of {'{ t, what, who }'} entries)</div>
        <textarea
          className="input"
          rows={6}
          value={runOfShowText}
          onChange={(e) => setRunOfShowText(e.target.value)}
          onBlur={() => commit()}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Hospitality rider (JSON)</div>
        <textarea
          className="input"
          rows={4}
          value={hospitalityText}
          onChange={(e) => setHospitalityText(e.target.value)}
          onBlur={() => commit()}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Tech rider (JSON)</div>
        <textarea
          className="input"
          rows={4}
          value={techText}
          onChange={(e) => setTechText(e.target.value)}
          onBlur={() => commit()}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Notes</div>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => commit()}
        />
      </label>

      <div className="row-meta">
        {saveState.status === 'saving' && 'Saving…'}
        {saveState.status === 'saved' && 'Saved.'}
        {saveState.status === 'error' && (
          <span style={{ color: 'var(--red, #c00)' }}>Error: {saveState.error}</span>
        )}
      </div>
    </section>
  );
}
