// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import React from 'react';
import Link from 'next/link';

const fmtUSD = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const fmtDate = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function BookingCalendar({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="serif" style={{ fontSize: 22, marginBottom: 6 }}>
          No shows ingested yet
        </div>
        <div className="row-meta">
          Run <code>npm run ingest:shows</code> after Lauren updates the workbook.
        </div>
      </div>
    );
  }
  return (
    <div className="card flush">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 110 }}>Date</th>
            <th>Artist</th>
            <th className="num">Cap</th>
            <th className="num">Sold</th>
            <th>Sell-thru</th>
            <th className="num">Price</th>
            <th>Door</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">{fmtDate(r.show_date)}</td>
              <td>
                <Link href={`/playbook?show=${r.id}`}>{r.band_name}</Link>
              </td>
              <td className="num">—</td>
              <td className="num">—</td>
              <td>—</td>
              <td className="num">{fmtUSD(r.price)}</td>
              <td>{r.door_tix ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-meta" style={{ padding: '8px 14px' }}>
        Cap / Sold / Sell-thru — ticketing data not yet wired (DICE integration deferred).
      </div>
    </div>
  );
}
