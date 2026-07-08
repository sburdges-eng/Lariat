import React from 'react';

/**
 * StatusDot — a bare tone dot. The atomic status signal used across boards,
 * nav, and tiles. Ported from the .dot token primitive.
 */
export function StatusDot({ tone = 'muted', size = 8, pulse = false, style, ...rest }) {
  const color = {
    muted: 'var(--text-muted)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)',
    amber: 'var(--accent)',
  }[tone];
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
        ...style,
      }}
      {...rest}
    />
  );
}
