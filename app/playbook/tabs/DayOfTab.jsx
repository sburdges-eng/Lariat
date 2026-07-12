// @ts-check
'use client';
import StatusPill from '../StatusPill';

/** @typedef {import('../../../lib/showsRepo.ts').ShowRow} ShowRow */

/** @type {Array<{ key: string, label: string }>} */
const FIELDS = [
  { key: 'dice_email', label: 'DICE email (tix, DOS)' },
  { key: 'assets', label: 'Assets ready' },
  { key: 'posts', label: 'Posts' },
  { key: 'whbv', label: 'WHBV' },
];

/** @param {{ show: ShowRow | null | undefined }} props */
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
