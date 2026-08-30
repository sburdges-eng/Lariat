// @ts-check
import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { summarizeMappingCoverage } from '../../../lib/vendorMapping.ts';
import LinkPairForm from './LinkPairForm.jsx';

export const dynamic = 'force-dynamic';

/** @param {{ searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined> }} props */
export default async function LinkVendorsPage({ searchParams } = {}) {
  const sp = (await searchParams) || {};
  const loc =
    typeof sp.location === 'string' && sp.location.trim()
      ? sp.location.trim()
      : DEFAULT_LOCATION_ID;
  // Every hop between these three pages has to carry the venue, or the
  // location dies on the first click and the next page silently shows
  // 'default'. Empty for the default venue so ordinary URLs stay clean.
  const locQuery = loc !== DEFAULT_LOCATION_ID ? `?location=${encodeURIComponent(loc)}` : '';
  const db = getDb();
  const coverage = summarizeMappingCoverage(db, loc);

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        <Link href={`/purchasing${locQuery}`}>← Order guide</Link>
        {' · '}
        <Link href={`/purchasing/compare${locQuery}`}>Compare</Link>
      </p>
      <h1>Link vendors</h1>
      <p className="subtitle">Pick a Sysco and Shamrock item for the same staple. You confirm every link.</p>
      <div className="card">
        <LinkPairForm coverage={coverage} />
      </div>
    </div>
  );
}
