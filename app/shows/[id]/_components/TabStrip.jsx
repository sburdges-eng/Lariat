// @ts-check
import Link from 'next/link';

const TABS = [
  { k: 'stage', l: 'Stage', sub: 'Room + run-of-show' },
  { k: 'sound', l: 'Sound', sub: 'Scenes + monitors' },
  { k: 'box-office', l: 'Box Office', sub: 'Tickets + scans' },
  { k: 'settlement', l: 'Settlement', sub: 'Payout + net door' },
];

/** @param {{ showId: number, locationId: string, active?: string }} props */
export default function TabStrip({ showId, locationId, active }) {
  const locQuery = locationId && locationId !== 'default' ? `?location=${locationId}` : '';
  return (
    <nav className="toggles" style={{ marginBottom: 18 }}>
      {TABS.map((t) => (
        <Link
          key={t.k}
          className={`btn sm ${active === t.k ? 'primary' : ''}`}
          href={`/shows/${showId}/${t.k}${locQuery}`}
        >
          {t.l}
        </Link>
      ))}
    </nav>
  );
}
