import React from 'react';

export interface BarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fill percentage 0–100. */
  value?: number;
  tone?: 'amber' | 'ok' | 'warn' | 'alert';
  height?: number;
}

/** Thin data/progress bar — sunk track, tone-colored fill. */
export function Bar(props: BarProps): JSX.Element;
