import React from 'react';

export interface StatusDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: 'muted' | 'ok' | 'warn' | 'alert' | 'amber';
  size?: number;
  /** Add a soft halo ring in the tone color. */
  pulse?: boolean;
}

/** Bare tone dot — the atomic status signal for boards, tiles, nav. */
export function StatusDot(props: StatusDotProps): JSX.Element;
