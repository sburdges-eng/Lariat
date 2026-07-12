// @ts-check
'use client';
import { useEffect, useMemo, useState } from 'react';
import BrandStamp from './BrandStamp.jsx';

/**
 * @typedef {{ key: string, label: string, start: number, end: number }} Phase
 * @typedef {Phase & { state: 'past' | 'now' | 'future' }} PhaseWithState
 */

/**
 * Service day phases — these define the horizontal timeline across the
 * top of the cockpit. The "now" marker slides through in real time.
 * @type {Phase[]}
 */
const PHASES = [
  { key: 'prep',  label: 'Prep',  start: 8,  end: 11 },
  { key: 'open',  label: 'Open',  start: 11, end: 17 },
  { key: 'rush',  label: 'Rush',  start: 17, end: 22 },
  { key: 'close', label: 'Close', start: 22, end: 24 },
];

/** @param {Date} d */
function fmtTime(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  const mm = String(m).padStart(2, '0');
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm}${suffix}`;
}
/** @param {number} h */
function fmtPhaseTime(h) {
  const hh = ((h + 11) % 12) + 1;
  const s = (h % 24) >= 12 ? 'p' : 'a';
  return `${hh}${s}`;
}

export default function ServiceStrip() {
  const [now, setNow] = useState(/** @type {Date | null} */ (null));

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 30000); // every 30s
    return () => clearInterval(t);
  }, []);

  const phaseState = useMemo(() => {
    if (!now) {
      return PHASES.map((p) => /** @type {PhaseWithState} */ ({ ...p, state: 'future' }));
    }
    const h = now.getHours() + now.getMinutes() / 60;
    return PHASES.map((p) => {
      /** @type {PhaseWithState['state']} */
      let state = 'future';
      if (h >= p.end) state = 'past';
      else if (h >= p.start) state = 'now';
      return { ...p, state };
    });
  }, [now]);

  // Position of the vertical now-marker across the 4-phase track
  const markerLeft = useMemo(() => {
    if (!now) return '0%';
    const h = now.getHours() + now.getMinutes() / 60;
    const dayStart = /** @type {Phase} */ (PHASES[0]).start;
    const dayEnd = /** @type {Phase} */ (PHASES[PHASES.length - 1]).end;
    const clamped = Math.max(dayStart, Math.min(dayEnd, h));
    const pct = (clamped - dayStart) / (dayEnd - dayStart);
    return `${pct * 100}%`;
  }, [now]);

  // Day name + date for the status chip
  const dateLine = useMemo(() => {
    if (!now) return 'Today';
    /** @type {Intl.DateTimeFormatOptions} */
    const opts = { weekday: 'short', month: 'short', day: 'numeric' };
    return now.toLocaleDateString(undefined, opts);
  }, [now]);

  const currentPhase = phaseState.find((p) => p.state === 'now');
  const clockText = now ? fmtTime(now) : '--:--';

  return (
    <header className="strip" role="banner">
      <div className="mark">
        <BrandStamp className="logo" decorative size={undefined} />
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
        <span className="clock">{clockText}</span>
        {currentPhase && <span className="heat">{currentPhase.label.toUpperCase()}</span>}
      </div>
    </header>
  );
}
