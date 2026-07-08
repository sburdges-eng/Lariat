import React from 'react';

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  dot?: boolean;
  dotTone?: 'muted' | 'ok' | 'warn' | 'alert' | 'amber';
}

/** Hairline mono micro-label with squared 2px corners. Metadata, codes, categories. */
export function Tag(props: TagProps): JSX.Element;
