import React from 'react';

/**
 * StationRing — the line-station progress ring from the cockpit's left rail.
 * A thin circular track with an amber (or tone-colored) fill sweep, a numeric
 * glyph punched in the center. Tone is derived from progress unless overridden:
 * flagged/not-started -> fire (oxblood), in-progress -> amber, done -> bone.
 *
 * Ported from the shipping app (app/_components/Sidebar.jsx · StationRing).
 */
export function StationRing({
  done = 0,
  total = 0,
  flagged = 0,
  signedOff = false,
  glyph,
  size = 36,
  tone: toneOverride,
}) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = total ? Math.min(1, done / total) : 0;
  const off = c * (1 - pct);

  const tone =
    toneOverride ||
    (flagged > 0
      ? 'fire'
      : signedOff || (total && done >= total)
      ? 'done'
      : done > 0
      ? 'amber'
      : 'fire');

  const fillColor =
    tone === 'fire'
      ? 'var(--fire)'
      : tone === 'amber'
      ? 'var(--accent)'
      : tone === 'ok'
      ? 'var(--ok)'
      : 'var(--text)';

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg viewBox="0 0 36 36" width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--hair)" strokeWidth="2.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke={fillColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: 'stroke-dashoffset .4s var(--easing)' }}
        />
      </svg>
      {glyph != null && (
        <span
          style={{
            position: 'absolute',
            fontFamily: 'var(--mono)',
            fontSize: size * 0.3,
            fontWeight: 700,
            color: 'var(--text)',
          }}
        >
          {glyph}
        </span>
      )}
    </div>
  );
}
