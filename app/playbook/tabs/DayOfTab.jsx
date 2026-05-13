// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

const FIELDS = [
  { key: 'dice_email', label: 'DICE email (tix, DOS)' },
  { key: 'assets', label: 'Assets ready' },
  { key: 'posts', label: 'Posts' },
  { key: 'whbv', label: 'WHBV' },
];

export default function DayOfTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
      <header className="row-meta" style={{ marginBottom: 8, letterSpacing: '.18em' }}>
        DAY OF
      </header>
      <table className="tbl">
        <tbody>
          {FIELDS.map((f) => (
            <tr key={f.key}>
              <td>{f.label}</td>
              <td><StatusPill value={s[f.key]} column={f.key} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
