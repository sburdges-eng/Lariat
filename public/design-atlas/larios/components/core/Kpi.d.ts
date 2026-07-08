import React from 'react';

export interface KpiProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Mono uppercase label. */
  label: React.ReactNode;
  /** Big display value (Archivo grotesque, tabular). */
  value: React.ReactNode;
  /** Optional mono sub-line (delta, note). */
  sub?: React.ReactNode;
  /** Colors the sub-line: up (sage) / down (oxblood) / warn (amber). */
  trend?: 'up' | 'down' | 'warn';
}

/**
 * Metric cell — mono label, big grotesque tabular value, optional trend sub.
 * @startingPoint section="Data" subtitle="KPI metric cell" viewport="700x150"
 */
export function Kpi(props: KpiProps): JSX.Element;
