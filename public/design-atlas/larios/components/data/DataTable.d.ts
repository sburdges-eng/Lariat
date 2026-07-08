import React from 'react';

export interface DataColumn {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'right';
  /** Force the mono/tabular figure font (auto-on for right-aligned columns). */
  mono?: boolean;
  width?: number | string;
}

export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  columns: DataColumn[];
  /** Row objects keyed by column.key; optional `id` for the React key. */
  rows: Array<Record<string, React.ReactNode> & { id?: string | number }>;
  /** Barely-perceptible alternating row fill. Default true. */
  zebra?: boolean;
}

/**
 * Dense data grid — sticky mono header, right-aligned tabular numerics, faint
 * zebra striping. Right-align every numeric column.
 * @startingPoint section="Data" subtitle="Dense data grid / table" viewport="700x150"
 */
export function DataTable(props: DataTableProps): JSX.Element;
