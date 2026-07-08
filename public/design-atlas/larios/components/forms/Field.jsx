import React from 'react';

/**
 * Field — a label + control wrapper. The label is a mono/uppercase micro-cap
 * above the control (the standard form row). Pass the control as children.
 */
export function Field({ label, hint, htmlFor, children, style, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }} {...rest}>
      {label && (
        <label
          htmlFor={htmlFor}
          style={{
            fontFamily: 'var(--sans)',
            fontSize: 11,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.08em',
            fontWeight: 700,
          }}
        >
          {label}
        </label>
      )}
      {children}
      {hint && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--sans)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}
