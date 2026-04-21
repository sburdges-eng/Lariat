'use client';
import { useEffect, useMemo, useState } from 'react';

/**
 * Service day phases — these define the horizontal timeline across the
 * top of the cockpit. The "now" marker slides through in real time.
 */
const PHASES = [
  { key: 'prep',  label: 'Prep',  start: 8,  end: 11 },
  { key: 'open',  label: 'Open',  start: 11, end: 17 },
  { key: 'rush',  label: 'Rush',  start: 17, end: 22 },
  { key: 'close', label: 'Close', start: 22, end: 24 },
];

function fmtTime(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  const mm = String(m).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm}${suffix}`;
}
function fmtPhaseTime(h) {
  const hh = ((h + 11) % 12) + 1;
  const s = h >= 12 ? 'p' : 'a';
  return `${hh}${s}`;
}

export default function ServiceStrip() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000); // every 30s
    return () => clearInterval(t);
  }, []);

  const phaseState = useMemo(() => {
    const h = now.getHours() + now.getMinutes() / 60;
    return PHASES.map((p) => {
      let state = 'future';
      if (h >= p.end) state = 'past';
      else if (h >= p.start) state = 'now';
      return { ...p, state };
    });
  }, [now]);

  // Position of the vertical now-marker across the 4-phase track
  const markerLeft = useMemo(() => {
    const h = now.getHours() + now.getMinutes() / 60;
    const dayStart = PHASES[0].start;
    const dayEnd = PHASES[PHASES.length - 1].end;
    const clamped = Math.max(dayStart, Math.min(dayEnd, h));
    const pct = (clamped - dayStart) / (dayEnd - dayStart);
    return `${pct * 100}%`;
  }, [now]);

  // Day name + date for the status chip
  const dateLine = useMemo(() => {
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    return now.toLocaleDateString(undefined, opts);
  }, [now]);

  const currentPhase = phaseState.find((p) => p.state === 'now');

  return (
    <header className="strip" role="banner">
      <div className="mark">
        <svg className="logo" viewBox="0 0 40 40" aria-hidden>
          {/* Lariat loop — rope motif */}
          <circle cx="20" cy="18" r="11" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M 20 29 Q 20 36 26 38" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="20" cy="18" r="2.2" fill="currentColor" />
        </svg>
        <div className="word">
          <b>The Lariat</b>
          <i>Kitchen Cockpit</i>
        </div>
      </div>

      <div className="phases" aria-label="Service timeline">
        <div className="phases-track">
          {phaseState.map((p) => (
            <div key={p.key} className={`phase ${p.state}`}>
              <span className="dot" aria-hidden />
              <span className="lbl">{p.label}</span>
              <span className="time">
                {fmtPhaseTime(p.start)}–{fmtPhaseTime(p.end)}
              </span>
            </div>
          ))}
          <div className="now-marker" style={{ left: markerLeft }} aria-hidden />
        </div>
      </div>

      <div className="status-chip" aria-live="polite">
        <span>{dateLine}</span>
        <span className="clock">{fmtTime(now)}</span>
        {currentPhase && <span className="heat">{currentPhase.label.toUpperCase()}</span>}
      </div>
    </header>
  );
}
