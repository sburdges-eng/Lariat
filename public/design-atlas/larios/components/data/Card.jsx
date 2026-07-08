import React from 'react';

/**
 * Card — a matte panel with a 1px hairline and minimal radius. Optional
 * header (title + right-slot). Depth is the border, not a shadow — pass
 * floating to add elevation for menus/modals only.
 */
export function Card({ title, right, children, floating = false, padded = true, style, ...rest }) {
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hair)',
        borderRadius: 'var(--radius)',
        boxShadow: floating ? 'var(--shadow-2)' : 'none',
        overflow: 'hidden',
        ...style,
      }}
      {...rest}
    >
      {(title || right) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderBottom: '1px solid var(--hair)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--display)',
              fontVariantCaps: 'small-caps',
              fontWeight: 500,
              fontSize: 14,
              letterSpacing: '.06em',
              color: 'var(--text)',
            }}
          >
            {title}
          </span>
          {right}
        </div>
      )}
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </div>
  );
}
