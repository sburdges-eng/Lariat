'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

const AUTOSAVE_INTERVAL_MS = 30_000;

// djb2 — cheap content hash so identical autosave ticks are skipped.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function emptyPlot() {
  return { channels: [], monitors: [] };
}

function plotToText(plot) {
  try {
    return JSON.stringify(plot ?? emptyPlot(), null, 2);
  } catch {
    return JSON.stringify(emptyPlot(), null, 2);
  }
}

function parsePlot(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      monitors: Array.isArray(parsed.monitors) ? parsed.monitors : [],
    };
  } catch {
    return null;
  }
}

export default function SoundBoard({ showId, locationId, initialScenes, completeness }) {
  const [scenes, setScenes] = useState(initialScenes ?? []);
  const [score, setScore] = useState(completeness?.score ?? 0);

  const latest = scenes[0];
  const [currentSceneId, setCurrentSceneId] = useState(latest?.id ?? null);
  const [sceneName, setSceneName] = useState(latest?.scene_name ?? '');
  const [plotText, setPlotText] = useState(plotToText(latest?.plot ?? emptyPlot()));
  const [splLimit, setSplLimit] = useState(
    latest?.spl_limit_db != null ? String(latest.spl_limit_db) : '',
  );
  const [notes, setNotes] = useState(latest?.notes ?? '');
  const [saveState, setSaveState] = useState({ status: 'idle', error: null, savedAt: null });

  const lastHashRef = useRef(null);
  const inFlightRef = useRef(null); // promise of current save

  const buildPayload = useCallback(() => {
    const plot = parsePlot(plotText);
    if (!plot || !sceneName.trim()) return null;
    return {
      scene_name: sceneName.trim(),
      plot,
      spl_limit_db: splLimit.trim() === '' ? null : Number(splLimit),
      notes: notes || null,
      location_id: locationId,
    };
  }, [sceneName, plotText, splLimit, notes, locationId]);

  const save = useCallback(async () => {
    const payload = buildPayload();
    if (!payload) return;
    const sig = hash(JSON.stringify(payload) + (currentSceneId ?? 'NEW'));
    if (sig === lastHashRef.current) return;
    if (inFlightRef.current) {
      await inFlightRef.current; // serialize: wait for first POST before PATCHing
    }

    setSaveState((s) => ({ ...s, status: 'saving', error: null }));

    const promise = (async () => {
      try {
        let res;
        if (currentSceneId == null) {
          res = await fetch(`/api/shows/${showId}/sound`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
        } else {
          res = await fetch(`/api/shows/${showId}/sound/${currentSceneId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (data.scene?.id && currentSceneId == null) setCurrentSceneId(data.scene.id);
        lastHashRef.current = sig;
        setSaveState({ status: 'saved', error: null, savedAt: new Date() });
      } catch (err) {
        setSaveState({ status: 'error', error: err.message, savedAt: null });
        throw err;
      }
    })();
    inFlightRef.current = promise.catch(() => {});
    return promise;
  }, [buildPayload, currentSceneId, showId]);

  // Autosave on a 30s tick.
  useEffect(() => {
    const t = setInterval(() => {
      save().catch(() => {});
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [save]);

  // Save on tab close — sendBeacon, fire-and-forget, includes current id.
  useEffect(() => {
    const onUnload = () => {
      const payload = buildPayload();
      if (!payload) return;
      const url =
        currentSceneId == null
          ? `/api/shows/${showId}/sound`
          : `/api/shows/${showId}/sound/${currentSceneId}`;
      const method = currentSceneId == null ? 'POST' : 'PATCH';
      // sendBeacon only does POST. Method falls back to a sync fetch with keepalive.
      if (method === 'POST' && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(url, blob);
      } else {
        try {
          fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
          });
        } catch {
          /* best-effort */
        }
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [buildPayload, currentSceneId, showId]);

  const startNewScene = () => {
    setCurrentSceneId(null);
    setSceneName('');
    setPlotText(plotToText(emptyPlot()));
    setSplLimit('');
    setNotes('');
    lastHashRef.current = null;
    setSaveState({ status: 'idle', error: null, savedAt: null });
  };

  const switchScene = (id) => {
    const target = scenes.find((s) => s.id === id);
    if (!target) return;
    setCurrentSceneId(id);
    setSceneName(target.scene_name);
    setPlotText(plotToText(target.plot));
    setSplLimit(target.spl_limit_db != null ? String(target.spl_limit_db) : '');
    setNotes(target.notes ?? '');
    lastHashRef.current = null;
    setSaveState({ status: 'idle', error: null, savedAt: null });
  };

  return (
    <section className="card" style={{ padding: 18 }}>
      <div className="row-meta" style={{ marginBottom: 6 }}>
        Completeness · {(score * 100).toFixed(0)}% · {scenes.length} scene
        {scenes.length === 1 ? '' : 's'}
      </div>

      <div className="toggles" style={{ marginBottom: 14, gap: 6 }}>
        {scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`btn sm ${s.id === currentSceneId ? 'primary' : ''}`}
            onClick={() => switchScene(s.id)}
          >
            {s.scene_name}
          </button>
        ))}
        <button type="button" className="btn sm" onClick={startNewScene}>
          + New scene
        </button>
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Scene name</div>
        <input
          type="text"
          className="input"
          value={sceneName}
          onChange={(e) => setSceneName(e.target.value)}
          onBlur={() => save().catch(() => {})}
          placeholder="soundcheck / set 1 / encore"
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">SPL limit (dB) — optional</div>
        <input
          type="number"
          className="input"
          value={splLimit}
          onChange={(e) => setSplLimit(e.target.value)}
          onBlur={() => save().catch(() => {})}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">
          Plot JSON · {'{ channels: [...], monitors: [...] }'}
        </div>
        <textarea
          className="input"
          rows={12}
          value={plotText}
          onChange={(e) => setPlotText(e.target.value)}
          onBlur={() => save().catch(() => {})}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div className="row-meta">Notes</div>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => save().catch(() => {})}
        />
      </label>

      <div className="row-meta">
        {saveState.status === 'saving' && 'Saving…'}
        {saveState.status === 'saved' &&
          `Saved ${saveState.savedAt ? saveState.savedAt.toLocaleTimeString() : ''}`}
        {saveState.status === 'error' && (
          <span style={{ color: 'var(--red, #c00)' }}>Error: {saveState.error}</span>
        )}
      </div>
    </section>
  );
}
