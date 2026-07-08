import React from 'react';

/**
 * Kpi — a metric cell. Mono wide-tracked label, big display-grotesque value, and an
 * optional mono sub-line with an up/down/warn trend tone. Ported from the .kpi
 * token primitive. The value uses tabular figures.
 */
export function Kpi({ label, value, sub, trend, style, ...rest }) {
  const subColor = {
    up: 'var(--ok)',
    down: 'var(--fire)',
    warn: 'var(--accent)',
  }[trend] || 'var(--text-muted)';
  return (
    <div
      style={{
        padding: '14px 16px',
        border: '1px solid var(--hair)',
        borderRadius: 'var(--radius)',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        ...style,
      }}
      {...rest}
    >
      <div
        style={{
          fontFamily: 'var(--mono)',
          fontSize: '9.5px',
          letterSpacing: '.24em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--display)',
          fontSize: 38,
          lineHeight: 1,
          letterSpacing: '-.02em',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text)',
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: subColor }}>{sub}</div>
      )}
    </div>
  );
}
