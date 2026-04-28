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
