// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import React, { useMemo, useState } from 'react';

export default function ArchiveSearch({ initialRows, eras }) {
  const [q, setQ] = useState('');
  const [era, setEra] = useState('');

  const rows = useMemo(() => {
    return initialRows.filter((r) => {
      if (era && String(r.era_year) !== era) return false;
      if (q && !r.band_name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [initialRows, q, era]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <input
          type="search"
          placeholder="Search band name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: '8px 12px' }}
        />
        <label>
          <span className="row-meta" style={{ marginRight: 6 }}>Era</span>
          <select value={era} onChange={(e) => setEra(e.target.value)}>
            <option value="">All</option>
            {eras.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="row-meta" style={{ padding: 18 }}>No matches.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Band</th>
              <th>Date</th>
              <th>Era</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.band_name}</td>
                <td className="mono">{r.show_date}</td>
                <td>{r.era_year ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
