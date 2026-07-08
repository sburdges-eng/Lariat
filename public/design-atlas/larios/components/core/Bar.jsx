import React from 'react';

/**
 * Bar — a thin data/progress bar. A sunk track with a tone-colored fill.
 * Ported from the .bar token primitive.
 */
export function Bar({ value = 0, tone = 'amber', height = 6, style, ...rest }) {
  const color = {
    amber: 'var(--accent)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)',
  }[tone];
  return (
    <div
      style={{
        height,
        background: 'var(--panel-2)',
        borderRadius: 99,
        overflow: 'hidden',
        position: 'relative',
        ...style,
      }}
      {...rest}
    >
      <i
        style={{
          display: 'block',
          height: '100%',
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: color,
          borderRadius: 99,
          transition: 'width var(--dur-slow) var(--easing)',
        }}
      />
    </div>
  );
}
