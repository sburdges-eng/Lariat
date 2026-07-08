import React from 'react';

/**
 * Pill — a small status capsule. Uppercase, wide-tracked, tinted by tone.
 * Ported from the .pill token primitive. Tones map to the warm status
 * palette: ok (sage), warn (brass), alert (oxblood), amber, ink, lari.
 */
const TONES = {
  neutral: { background: 'var(--panel-2)', color: 'var(--text-muted)', border: '1px solid var(--hair)' },
  ok: { background: 'rgba(122,160,127,.18)', color: 'var(--ok)', border: '1px solid transparent' },
  warn: { background: 'rgba(194,145,47,.20)', color: 'var(--metal)', border: '1px solid transparent' },
  alert: { background: 'rgba(224,90,60,.18)', color: 'var(--fire)', border: '1px solid transparent' },
  amber: { background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid var(--accent)' },
  ink: { background: 'var(--text)', color: 'var(--panel)', border: 'none' },
  lari: {
    background: '#1d1a15',
    color: 'var(--ember-glow)',
    border: '1px solid var(--ember-deep)',
    fontFamily: 'var(--mono)',
    fontSize: '9.5px',
  },
};

export function Pill({ children, tone = 'neutral', dot = false, style, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 99,
        fontSize: '10px',
        letterSpacing: '.14em',
        textTransform: 'uppercase',
        fontWeight: 700,
        fontFamily: 'var(--sans)',
        lineHeight: 1.2,
        ...t,
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
