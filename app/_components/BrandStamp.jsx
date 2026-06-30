// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
//
// BrandStamp — the Lariat signature mark.
//
// A cattle-brand / lariat-loop monogram: a single coiled rope loop with a
// trailing tail that hooks back, plus a hard-stamped center dot (the "branding
// iron" punch). One confident geometric glyph — legible at sidebar/inline size
// and large. Drawn with currentColor so it inherits the surrounding text color
// (gaslight amber when active, bone otherwise) and scales with font-size
// (default 1em square).
//
// Pure presentational SVG — no hooks, so no 'use client' needed.

export default function BrandStamp({
  label = 'Lariat',
  decorative = false,
  size,
  className,
  ...rest
}) {
  // a11y: visible standalone mark gets role="img" + label; when it sits beside
  // the wordmark text it is decorative (aria-hidden, no name).
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
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      {...rest}
    >
      {/* The loop — the open noose of the lariat, slightly ovoid so it reads as
          rope under tension rather than a plain ring. */}
      <ellipse cx="20" cy="17" rx="11.5" ry="10" />
      {/* The tail — rope feeds out the bottom of the loop and curls back, the
          gesture that makes it a lariat and not a circle. */}
      <path d="M20 27 C 20 33, 23 36, 29 35.5" />
      {/* The honda / branding punch — the hard center stamp. */}
      <circle cx="20" cy="17" r="2.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
