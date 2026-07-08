import React from 'react';

/**
 * Tag — a hairline mono micro-label with an optional leading dot. Squared
 * corners (2px). Ported from the .tag token primitive. Quieter than a Pill:
 * used for metadata, categories, station codes.
 */
export function Tag({ children, dot, dotTone = 'muted', style, ...rest }) {
  const dotColor = {
    muted: 'var(--text-muted)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)',
    amber: 'var(--accent)',
  }[dotTone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--mono)',
        fontSize: '9.5px',
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'var(--text-muted)',
        padding: '2px 6px',
        border: '1px solid var(--hair)',
        borderRadius: 2,
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      )}
      {children}
    </span>
  );
}
