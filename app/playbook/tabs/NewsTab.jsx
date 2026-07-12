// @ts-check
'use client';
import StatusPill from '../StatusPill';

/** @typedef {import('../../../lib/showsRepo.ts').ShowRow} ShowRow */

/** @param {{ show: ShowRow | null | undefined }} props */
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
