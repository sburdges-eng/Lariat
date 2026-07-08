import React from 'react';

/**
 * Button — the LaRiOS action control. Compact, uppercase, wide-tracked; a
 * matte fill with a 1px border that lights to amber on hover and depresses on
 * press. Never rounded past --radius-sm. Ported from the token primitive
 * (.btn) in the shipping app.
 *
 * variants: primary (amber fill) · default (matte) · ghost (transparent) ·
 *           ink (bone fill) · danger (oxblood) · ok (sage)
 * sizes: xs · sm · md (default) · lg
 */
const PAD = {
  xs: '3px 8px',
  sm: '5px 10px',
  md: '8px 14px',
  lg: '12px 20px',
};
const FS = { xs: '9.5px', sm: '10px', md: '11.5px', lg: '13px' };

export function Button({
  children,
  variant = 'default',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  style,
  ...rest
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: PAD[size] || PAD.md,
    fontFamily: 'var(--sans)',
    fontSize: FS[size] || FS.md,
    fontWeight: 700,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    border: '1px solid var(--hair)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--panel)',
    color: 'var(--text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'background var(--dur), border-color var(--dur), color var(--dur), transform var(--dur-fast)',
    lineHeight: 1.1,
  };

  const variants = {
    default: {},
    primary: { background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)' },
    ghost: { background: 'transparent' },
    ink: { background: 'var(--text)', color: 'var(--panel)', borderColor: 'var(--text)' },
    danger: { background: 'var(--fire)', color: 'var(--on-accent)', borderColor: 'var(--fire)' },
    ok: { background: 'var(--ok)', color: 'var(--on-accent)', borderColor: 'var(--ok)' },
  };

  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);

  const hoverStyle =
    hover && !disabled
      ? variant === 'default' || variant === 'ghost'
        ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
        : { filter: 'brightness(1.08)' }
      : null;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        ...base,
        ...variants[variant],
        ...hoverStyle,
        ...(active && !disabled ? { transform: 'scale(0.97)' } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
