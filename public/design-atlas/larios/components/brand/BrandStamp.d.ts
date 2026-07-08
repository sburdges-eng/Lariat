import React from 'react';

export interface BrandStampProps {
  /** Accessible name when the mark stands alone. Default "Lariat". */
  label?: string;
  /** When true the mark is aria-hidden (sits beside the wordmark text). */
  decorative?: boolean;
  /** Explicit px/CSS size. Defaults to 1em so it scales with font-size. */
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The Lariat signature mark — a lariat-loop / branding-iron monogram in
 * currentColor. Use inline beside the wordmark or standalone as a section seal.
 * @startingPoint section="Brand" subtitle="The Lariat rope-loop mark" viewport="700x150"
 */
export function BrandStamp(props: BrandStampProps): JSX.Element;
