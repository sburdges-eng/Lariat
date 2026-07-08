import React from 'react';

/** Select — inset dropdown matching Input. */
export function Select({ children, size = 'md', invalid = false, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'lg' ? '12px 14px' : '8px 11px';
  const fs = size === 'lg' ? 15 : 13;
  return (
    <select
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={{
        width: '100%',
        padding: pad,
        fontSize: fs,
        fontFamily: 'var(--sans)',
        background: 'var(--bg)',
        color: 'var(--text)',
        border: `1px solid ${invalid ? 'var(--fire)' : focus ? 'var(--accent)' : 'var(--hair)'}`,
        borderRadius: 'var(--radius-sm)',
        outline: 'none',
        cursor: 'pointer',
        boxSizing: 'border-box',
        transition: 'border-color var(--dur)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
