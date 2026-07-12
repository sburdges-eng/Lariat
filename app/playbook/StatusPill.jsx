// @ts-check
'use client';
import { statusColor } from '../../lib/showStatus';

/** @param {{ value: unknown, column: string }} props */
export default function StatusPill({ value, column }) {
  const { color, label } = statusColor(value, column);
  return (
    <span className={`pill pill-${color}`} title={`${column}: ${value ?? '—'}`}>
      {label}
    </span>
  );
}
