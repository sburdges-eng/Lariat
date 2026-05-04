'use client';

import { useEffect, useState, useRef } from 'react';
import StationColumn from './_components/StationColumn';

const POLL_MS = 15_000;

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function FireSchedulePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [audioCtx, setAudioCtx] = useState(null);
  const [now, setNow] = useState(new Date());
  const audioCtxRef = useRef(null);

  const date = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('date')
    ? new URLSearchParams(window.location.search).get('date')
    : todayLocal();

  const load = async () => {
    try {
      const res = await fetch(`/api/beo/fire-schedule?date=${encodeURIComponent(date)}`);
      if (!res.ok) {
        setErr('Couldn’t load — refresh the page');
        return;
      }
      setErr('');
      setData(await res.json());
    } catch {
      setErr('Lost connection');
    }
  };

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    // Tick now once a minute so age coloring updates without a fetch.
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const enableSound = () => {
    if (audioCtxRef.current) return;
    try {
      // Browser autoplay rules require a user gesture before AudioContext().
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      setAudioCtx(ctx);
    } catch {
      // No-op — visual cues still work.
    }
  };

  return (
    <div className="fs-page" data-testid="fire-schedule-page">
      <header className="fs-page-head">
        <h1>Fire schedule — {date}</h1>
        {!audioCtx && (
          <button type="button" className="btn" onClick={enableSound} data-testid="enable-sound">
            Turn sound on
          </button>
        )}
      </header>

      {err && <div className="fs-err" role="alert">{err}</div>}

      {!data && !err && <div className="fs-loading">Loading…</div>}

      {data && data.stations.length === 0 && (
        <div className="fs-day-empty">No fires today.</div>
      )}

      {data && data.stations.length > 0 && (
        <div className="fs-grid">
          {data.stations.map((s) => (
            <StationColumn key={s.station_id} station={s} audioCtx={audioCtx} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
