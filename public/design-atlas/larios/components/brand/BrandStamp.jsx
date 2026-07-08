import React from 'react';

/**
 * BrandStamp — the Lariat signature mark: a cattle-brand / lariat-loop
 * monogram. A single coiled rope loop with a trailing tail that hooks back,
 * plus a hard-stamped center dot (the "branding iron" punch). Drawn with
 * currentColor so it inherits the surrounding text color (gaslight amber when
 * active, bone otherwise) and scales with font-size (default 1em square).
 *
 * Ported verbatim from the shipping app (app/_components/BrandStamp.jsx).
 */
export function BrandStamp({
  label = 'Lariat',
  decorative = false,
  size,
  className,
  style,
  ...rest
}) {
  const a11y = decorative
    ? { 'aria-hidden': 'true' }
    : { role: 'img', 'aria-label': label };
  const dim = size != null ? size : '1em';

  return (
    <svg
      viewBox="0 0 40 40"
      width={dim}
      height={dim}
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      {/* The loop — the open noose of the lariat, slightly ovoid. */}
      <ellipse cx="20" cy="17" rx="11.5" ry="10" />
      {/* The tail — rope feeds out the bottom of the loop and curls back. */}
      <path d="M20 27 C 20 33, 23 36, 29 35.5" />
      {/* The honda / branding punch — the hard center stamp. */}
      <circle cx="20" cy="17" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
