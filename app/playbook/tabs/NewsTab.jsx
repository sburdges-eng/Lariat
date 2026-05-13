// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
'use client';
import React from 'react';
import StatusPill from '../StatusPill';

export default function NewsTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
      <table className="tbl">
        <tbody>
          <tr>
            <td>Newsletter included</td>
            <td><StatusPill value={s.newsletter} column="newsletter" /></td>
          </tr>
          <tr>
            <td>Announce date</td>
            <td><StatusPill value={s.announce_date} column="announce_date" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
