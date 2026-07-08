import React from 'react';

/** Textarea — inset multi-line field matching Input; vertical resize only. */
export function Textarea({ invalid = false, rows = 3, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <textarea
      rows={rows}
      onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
      style={{
        width: '100%',
        padding: '8px 11px',
        fontSize: 13,
        fontFamily: 'var(--sans)',
        background: 'var(--bg)',
        color: 'var(--text)',
        border: `1px solid ${invalid ? 'var(--fire)' : focus ? 'var(--accent)' : 'var(--hair)'}`,
        borderRadius: 'var(--radius-sm)',
        outline: 'none',
        resize: 'vertical',
        boxSizing: 'border-box',
        lineHeight: 1.5,
        transition: 'border-color var(--dur)',
        ...style,
      }}
      {...rest}
    />
  );
}
