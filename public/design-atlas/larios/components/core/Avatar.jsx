import React from 'react';

/**
 * Avatar — a round initials chip in the display grotesque on amber (the cook/staff mark).
 * Ported from the .av token primitive. Sizes sm / md / lg.
 */
const DIM = { sm: 22, md: 30, lg: 42 };
const FS = { sm: 11, md: 14, lg: 18 };

export function Avatar({ initials, name, size = 'md', tone = 'amber', style, ...rest }) {
  const dim = DIM[size] || DIM.md;
  const label = initials || (name ? name.split(' ').map((w) => w[0]).slice(0, 2).join('') : '?');
  const bg = tone === 'ink' ? 'var(--text)' : 'var(--accent)';
  const fg = tone === 'ink' ? 'var(--panel)' : 'var(--on-accent)';
  return (
    <span
      title={name}
      style={{
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--display)',
        fontSize: FS[size] || FS.md,
        fontWeight: 500,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    >
      {label}
    </span>
  );
}
