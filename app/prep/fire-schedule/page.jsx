'use client';

import { useEffect, useState, useRef } from 'react';
import StationColumn from './_components/StationColumn';

const POLL_MS = 15_000;
const CONSENT_KEY = 'lariat_fire_sound_consent';

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readConsent() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeConsent() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    // private mode / quota — degrades gracefully (button reappears next load)
  }
}

export default function FireSchedulePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [audioCtx, setAudioCtx] = useState(null);
  const [needsResume, setNeedsResume] = useState(false);
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

  // T12: if the cook has consented to sound on a previous load, create
  // the AudioContext immediately. It comes up suspended (autoplay policy)
  // and resumes on the next user gesture (any Ack tap, or the inline
  // "wake sound" button below).
  useEffect(() => {
    if (audioCtxRef.current) return;
    if (!readConsent()) return;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      setAudioCtx(ctx);
      setNeedsResume(ctx.state === 'suspended');
    } catch {
      /* visual cues still work */
    }
  }, []);

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
    if (audioCtxRef.current) {
      audioCtxRef.current.resume?.().then(() => setNeedsResume(false), () => {});
      writeConsent();
      return;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      setAudioCtx(ctx);
      setNeedsResume(false);
      writeConsent();
    } catch {
      // No-op — visual cues still work.
    }
  };

  // Whether the audio is *actually playable*: we have a context AND it
  // isn't suspended. This is the gate the "Turn sound on" button watches.
  const audioReady = !!audioCtx && !needsResume;

  return (
    <div className="fs-page" data-testid="fire-schedule-page">
      <header className="fs-page-head">
        <h1>Fire schedule — {date}</h1>
        {!audioReady && (
          <button type="button" className="btn" onClick={enableSound} data-testid="enable-sound">
            {needsResume ? 'Tap to wake sound' : 'Turn sound on'}
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
