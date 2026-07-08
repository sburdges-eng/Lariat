import React from 'react';

/**
 * Tabs — a mono uppercase tab strip on a hairline baseline; the active tab
 * carries an amber underline. Ported from the .tabs primitive. Controlled via
 * value/onChange, or uncontrolled with defaultValue.
 */
export function Tabs({ tabs = [], value, defaultValue, onChange, style, ...rest }) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]?.value);
  const active = value !== undefined ? value : internal;
  const pick = (v) => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--hair)', ...style }} {...rest}>
      {tabs.map((t) => {
        const on = t.value === active;
        return (
          <button
            key={t.value}
            onClick={() => pick(t.value)}
            style={{
              padding: '10px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 10.5,
              letterSpacing: '.22em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: on ? 'var(--text)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1,
              cursor: 'pointer',
              transition: 'color var(--dur)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
