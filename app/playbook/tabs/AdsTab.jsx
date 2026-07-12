// @ts-check
'use client';
import StatusPill from '../StatusPill';

/** @typedef {import('../../../lib/showsRepo.ts').ShowRow} ShowRow */

/** @type {Array<{ key: string, label: string }>} */
const FIELDS = [
  { key: 'media_list', label: 'Media list' },
  { key: 'mkting_adv', label: 'Marketing advance' },
  { key: 'meta_ads', label: 'Meta ads' },
  { key: 'fb_event', label: 'FB event' },
  { key: 'listing_jambase_bit_songkick', label: 'Jambase / BIT / Songkick' },
];

/** @param {{ show: ShowRow | null | undefined }} props */
export default function AdsTab({ show }) {
  const s = show?.status ?? {};
  return (
    <div className="card" style={{ padding: 14 }}>
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
