// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import React from 'react';
import { statusColor } from '../../lib/showStatus';

export default function StatusPill({ value, column }) {
  const { color, label } = statusColor(value, column);
  return (
    <span className={`pill pill-${color}`} title={`${column}: ${value ?? '—'}`}>
      {label}
    </span>
  );
}
