// @ts-check
'use client';

/**
 * Floorplan — a spatial, top-down navigator for the Lariat Cockpit.
 *
 * The big idea: the nav is the floor. Cooks navigate the cockpit the same
 * way they navigate the physical kitchen. Stations are drawn as hatched
 * paper-ink zones, tinted live with line-check progress. Dining room,
 * pass, walk-ins, and dish pit are all on the map so the map *is* the app.
 *
 * Toggle with the "M" key or the book-rib button in the footer.
 * This is deliberately editorial — no backdrop-filter glass, no neon glow.
 * Pens, paper, ember. That's it.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NAV_BY_ID, withLocation } from './navRegistry.js';
import { useLocation } from './useLocation.js';

// Floor plan viewBox — kept square-ish for flexible layout. All coords are
// hand-tuned to feel like a kitchen, not a grid. Imperfect angles on purpose.
const VB_W = 960;
const VB_H = 640;

/** @typedef {{ x: number, y: number }} Point */

/**
 * Line-check progress summary for a station, as returned by GET
 * /api/stations (see app/api/stations/route.js).
 * @typedef {{ total: number, done: number, flagged: number, signedOff: boolean }} LineCheckProgress
 */

/**
 * Station shape returned by GET /api/stations.
 * @typedef {{ id: string, name: string, line: string | null, prog: LineCheckProgress | null }} StationStatus
 */

/**
 * Fields shared by every zone, regardless of kind.
 * @typedef {{
 *   name: string,
 *   points: string,
 *   label: Point,
 *   badge?: Point,
 *   wide?: boolean,
 * }} ZoneBase
 */

/**
 * A hot-line zone bound by index into the API-ordered stations[] array.
 * @typedef {ZoneBase & { kind: 'station', stationIdx: number }} StationZoneDef
 */

/**
 * A fixed utility zone that links to a named navRegistry route.
 * @typedef {ZoneBase & { kind: 'nav', navId: string, accent: string }} NavZoneDef
 */

/** @typedef {StationZoneDef | NavZoneDef} ZoneDef */

/**
 * A zone after live station/nav data has been merged in for rendering.
 * @typedef {ZoneDef & {
 *   key: string,
 *   href: string | null,
 *   tone: string,
 *   sub: string,
 *   shortcut: string,
 *   disabled: boolean,
 * }} ResolvedZone
 */

/**
 * Zone definitions. Each zone is either:
 *   - a station (binds by `stationIdx` to the API-ordered stations[], so
 *     zone 0 = station slot 1, etc.), OR
 *   - a fixed utility zone that links to a named route (`navId`).
 *
 * Coordinates are the polygon's points ("x,y x,y …") and a label anchor.
 * They're drawn once; live status recolors them.
 * @type {ZoneDef[]}
 */
const ZONES = [
  // ── Hot line, left-to-right along the bottom wall ────────────────────
  {
    kind: 'station',
    stationIdx: 0,
    name: 'Grill / Sauté',
    points: '120,360 280,360 280,470 120,470',
    label: { x: 200, y: 420 },
    badge: { x: 135, y: 378 },
  },
  {
    kind: 'station',
    stationIdx: 1,
    name: 'Fry',
    points: '290,360 400,360 400,470 290,470',
    label: { x: 345, y: 420 },
    badge: { x: 305, y: 378 },
  },
  {
    kind: 'station',
    stationIdx: 2,
    name: 'Garde Manger',
    points: '410,360 560,360 560,470 410,470',
    label: { x: 485, y: 420 },
    badge: { x: 425, y: 378 },
  },
  // ── Brunch — tucked off the cold line ────────────────────────────────
  {
    kind: 'station',
    stationIdx: 3,
    name: 'Brunch',
    points: '570,360 700,360 700,470 570,470',
    label: { x: 635, y: 420 },
    badge: { x: 585, y: 378 },
  },
  // ── Expo / the pass ──────────────────────────────────────────────────
  {
    kind: 'station',
    stationIdx: 4,
    name: 'The Pass',
    points: '120,270 700,270 700,340 120,340',
    label: { x: 410, y: 312 },
    badge: { x: 135, y: 288 },
    wide: true,
  },
  // ── Runner / dining entry ────────────────────────────────────────────
  {
    kind: 'station',
    stationIdx: 5,
    name: 'Runner',
    points: '720,270 840,270 840,470 720,470',
    label: { x: 780, y: 370 },
    badge: { x: 735, y: 288 },
  },
  // ── Fixed zones ──────────────────────────────────────────────────────
  {
    kind: 'nav',
    navId: 'receiving',
    name: 'Receiving dock',
    points: '120,150 300,150 300,240 120,240',
    label: { x: 210, y: 200 },
    accent: 'brass',
  },
  {
    kind: 'nav',
    navId: 'inventory',
    name: 'Walk-ins + dry',
    points: '310,150 560,150 560,240 310,240',
    label: { x: 435, y: 200 },
    accent: 'brass',
  },
  {
    kind: 'nav',
    navId: 'food-safety',
    name: 'Dish pit',
    points: '570,150 700,150 700,240 570,240',
    label: { x: 635, y: 200 },
    accent: 'brass',
  },
  {
    kind: 'nav',
    navId: 'specials',
    name: 'Dining room',
    points: '720,150 840,150 840,260 720,260',
    label: { x: 780, y: 208 },
    accent: 'sage',
  },
  {
    kind: 'nav',
    navId: 'eighty-six',
    name: '86 Board',
    points: '120,490 400,490 400,560 120,560',
    label: { x: 260, y: 528 },
    accent: 'rust',
  },
  {
    kind: 'nav',
    navId: 'recipes',
    name: 'Recipe book',
    points: '410,490 700,490 700,560 410,560',
    label: { x: 555, y: 528 },
    accent: 'ember',
  },
  {
    kind: 'nav',
    navId: 'kitchen-assistant',
    name: 'Ask the kitchen',
    points: '720,490 840,490 840,560 720,560',
    label: { x: 780, y: 528 },
    accent: 'sage',
  },
];

/**
 * Map a line-check progress summary onto a color token.
 * @param {LineCheckProgress | null | undefined} prog
 * @returns {string}
 */
function toneFor(prog) {
  if (!prog) return 'muted';
  if (prog.flagged > 0) return 'rust';
  if (prog.signedOff) return 'sage';
  if (prog.done >= prog.total) return 'sage';
  if (prog.done > 0) return 'brass';
  return 'rust';
}

/**
 * @param {LineCheckProgress | null | undefined} prog
 * @returns {string}
 */
function statusLine(prog) {
  if (!prog) return 'No line check';
  if (prog.signedOff) return 'Signed off';
  if (prog.flagged > 0) return `${prog.flagged} flagged`;
  if (prog.done >= prog.total) return 'Ready to sign off';
  if (prog.done > 0) return `${prog.done} of ${prog.total}`;
  return 'Not checked';
}

/**
 * Produce the "lighting wash" polygon that tracks the current service phase.
 * @param {number} hours
 * @returns {number}
 */
function washPoly(hours) {
  // A soft ember gradient that sweeps from left (prep) to right (close)
  // across the kitchen. Returns an x-offset (0..1) for the gradient.
  const clamped = Math.max(8, Math.min(23.9, hours));
  return (clamped - 8) / 16; // 0 at 8am, 1 at midnight.
}

/** @returns {number} */
function useHours() {
  const [hours, setHours] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date();
      setHours(d.getHours() + d.getMinutes() / 60);
    }, 60000);
    return () => clearInterval(t);
  }, []);
  return hours;
}

/**
 * @param {{ open: boolean, onClose?: () => void }} props
 */
export default function Floorplan({ open, onClose }) {
  const router = useRouter();
  const { locQuery } = useLocation();
  const [stations, setStations] = useState(/** @type {StationStatus[]} */ ([]));
  const [hover, setHover] = useState(/** @type {string | null} */ (null));
  const hours = useHours();

  // Pull stations when the overlay mounts — lightweight, no polling here
  // (the sidebar's 30s poll keeps the underlying state warm in cache).
  useEffect(() => {
    if (!open) return;
    fetch(`/api/stations${locQuery}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setStations(d))
      .catch(() => {});
  }, [open, locQuery]);

  // Close on Escape (the opener handles "M").
  useEffect(() => {
    if (!open) return;
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const resolvedZones = useMemo(() => {
    return ZONES.map((z, i) => {
      if (z.kind === 'station') {
        const s = stations[z.stationIdx];
        const tone = toneFor(s?.prog);
        const href = s ? withLocation(`/stations/${s.id}`, locQuery) : null;
        return {
          ...z,
          key: `zone-${i}`,
          href,
          tone,
          name: s?.name || z.name,
          sub: s ? statusLine(s.prog) : 'Awaiting line data',
          shortcut: String(z.stationIdx + 1),
          disabled: !s,
        };
      }
      const nav = NAV_BY_ID[z.navId];
      return {
        ...z,
        key: `zone-${i}`,
        href: nav ? withLocation(nav.href, locQuery) : null,
        tone: z.accent || 'ember',
        name: z.name,
        sub: nav?.sub || '',
        shortcut: nav?.shortcut || '',
        disabled: !nav,
      };
    });
  }, [stations, locQuery]);

  const washX = washPoly(hours);

  if (!open) return null;

  return (
    <div className="floorplan-scrim" onClick={onClose} role="dialog" aria-modal="true" aria-label="Kitchen floorplan navigator">
      <div
        className="floorplan"
        onClick={
          /** @param {React.MouseEvent<HTMLDivElement>} e */
          (e) => e.stopPropagation()
        }
      >
        <div className="floorplan-head">
          <div className="fp-title">
            <span className="fp-eyebrow">Floor</span>
            <h2 className="serif">The Lariat, from above</h2>
          </div>
          <div className="fp-legend" aria-hidden>
            <span><i className="sw sage" />Ready</span>
            <span><i className="sw brass" />In progress</span>
            <span><i className="sw rust" />Flagged</span>
            <span className="fp-hint">M or Esc to close</span>
          </div>
        </div>

        <svg className="floorplan-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} role="img">
          <defs>
            {/* Diagonal paper-ink hatch used inside zone fills */}
            <pattern id="hatch" width="7" height="7" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(29,26,21,0.08)" strokeWidth="1" />
            </pattern>
            <pattern id="hatch-ember" width="7" height="7" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="0" y2="7" stroke="rgba(200,90,42,0.25)" strokeWidth="1.2" />
            </pattern>
            {/* Service-phase wash: a subtle ember glow that tracks the time of day */}
            <linearGradient id="phaseWash" x1="0" x2="1" y1="0" y2="0">
              <stop offset={`${Math.max(0, washX - 0.12) * 100}%`} stopColor="rgba(200,90,42,0)" />
              <stop offset={`${washX * 100}%`} stopColor="rgba(200,90,42,0.12)" />
              <stop offset={`${Math.min(1, washX + 0.12) * 100}%`} stopColor="rgba(200,90,42,0)" />
            </linearGradient>
          </defs>

          {/* Outer wall — off-axis for a hand-drafted look */}
          <path
            d={`M 92 128 L 880 122 L 876 580 L 96 584 Z`}
            fill="var(--cream)"
            stroke="var(--ink)"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />

          {/* Compass rose in the top-right corner */}
          <g transform="translate(840,80)" opacity="0.7">
            <circle r="18" fill="none" stroke="var(--ink)" strokeWidth="0.8" />
            <path d="M 0 -18 L 0 -2" stroke="var(--ember)" strokeWidth="2" />
            <path d="M 0 2 L 0 18" stroke="var(--ink)" strokeWidth="0.8" />
            <text x="0" y="-22" textAnchor="middle" fontSize="9" fill="var(--ink)" fontFamily="'JetBrains Mono', monospace">N</text>
          </g>

          {/* Pass-through rail behind the pass */}
          <line x1="110" y1="350" x2="710" y2="350" stroke="var(--hair)" strokeWidth="1" strokeDasharray="3 4" />

          {/* Service-phase wash (under zones but above the floor) */}
          <rect x="92" y="122" width="788" height="462" fill="url(#phaseWash)" pointerEvents="none" />

          {/* Zones */}
          {resolvedZones.map((z) => {
            const isHover = hover === z.key;
            const baseFill = `var(--fp-fill-${z.tone}, var(--paper))`;
            return (
              <g
                key={z.key}
                className={`fp-zone fp-tone-${z.tone} ${isHover ? 'hover' : ''} ${z.disabled ? 'disabled' : ''}`}
                onMouseEnter={() => setHover(z.key)}
                onMouseLeave={() => setHover((h) => (h === z.key ? null : h))}
                onFocus={() => setHover(z.key)}
                onBlur={() => setHover((h) => (h === z.key ? null : h))}
                onClick={() => {
                  if (!z.href) return;
                  router.push(z.href);
                  onClose?.();
                }}
                tabIndex={z.href ? 0 : -1}
                role={z.href ? 'link' : undefined}
                aria-label={z.href ? `${z.name} — ${z.sub}` : z.name}
                onKeyDown={
                  /** @param {React.KeyboardEvent<SVGGElement>} e */
                  (e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && z.href) {
                      e.preventDefault();
                      router.push(z.href);
                      onClose?.();
                    }
                  }
                }
              >
                <polygon points={z.points} fill={baseFill} stroke="var(--ink)" strokeWidth="1.2" />
                <polygon points={z.points} fill="url(#hatch)" opacity="0.6" pointerEvents="none" />
                {isHover && (
                  <polygon
                    points={z.points}
                    fill="url(#hatch-ember)"
                    opacity="0.9"
                    pointerEvents="none"
                  />
                )}
                {/* Slot number badge — the keyboard shortcut */}
                {z.shortcut && (
                  <g pointerEvents="none" transform={`translate(${z.badge?.x || 0},${z.badge?.y || 0})`}>
                    <rect x="0" y="0" width="22" height="18" rx="3" fill="var(--ink)" />
                    <text
                      x="11"
                      y="13"
                      textAnchor="middle"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize="11"
                      fill="var(--cream)"
                    >
                      {z.shortcut}
                    </text>
                  </g>
                )}
                {/* Zone label */}
                <text
                  x={z.label.x}
                  y={z.label.y}
                  textAnchor="middle"
                  className="fp-zone-label"
                  pointerEvents="none"
                >
                  {z.name}
                </text>
                {/* Status sub-label */}
                {z.sub && (
                  <text
                    x={z.label.x}
                    y={z.label.y + 16}
                    textAnchor="middle"
                    className="fp-zone-sub"
                    pointerEvents="none"
                  >
                    {z.sub}
                  </text>
                )}
              </g>
            );
          })}

          {/* Dining room separator (a dotted line — no wall) */}
          <line x1="710" y1="270" x2="710" y2="465" stroke="var(--hair)" strokeDasharray="2 4" strokeWidth="1" />

          {/* Cardinal labels outside the floor */}
          <text x={VB_W / 2} y={110} textAnchor="middle" className="fp-card">Back of house</text>
          <text x={VB_W / 2} y={608} textAnchor="middle" className="fp-card">To the dining room →</text>
        </svg>

        <div className="fp-foot">
          <div className="fp-key">
            {resolvedZones.slice(0, 6).map((z) => (
              <Link
                key={z.key}
                href={z.href || '#'}
                className={`fp-chip fp-tone-${z.tone} ${z.disabled ? 'disabled' : ''}`}
                onClick={() => onClose?.()}
              >
                <kbd>{z.shortcut || '·'}</kbd>
                <span>{z.name}</span>
              </Link>
            ))}
          </div>
          <div className="fp-meta">
            <span className="serif fp-time">{new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
            <span className="fp-kicker">— phase wash follows the clock</span>
          </div>
        </div>
      </div>
    </div>
  );
}
