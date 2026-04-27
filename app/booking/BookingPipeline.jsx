'use client';
import React from 'react';

const STAGES = ['Inquiry', 'Hold', 'Offer Out', 'Confirmed', 'On Sale', 'Settled'];

export default function BookingPipeline({ counts }) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(${STAGES.length},1fr)`, gap: 8 }}
    >
      {STAGES.map((s, i) => (
        <div
          key={s}
          className="card"
          style={{ padding: '12px 14px', position: 'relative', background: i >= 4 ? 'var(--cream)' : 'var(--paper)' }}
        >
          <div className="row-meta" style={{ fontSize: 10, letterSpacing: '.16em' }}>
            STAGE {i + 1}
          </div>
          <div className="serif" style={{ fontSize: 34, lineHeight: 1 }}>
            {counts?.[s] ?? 0}
          </div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>{s}</div>
        </div>
      ))}
    </div>
  );
}
