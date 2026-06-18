// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import Link from 'next/link';
import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { summarizeMappingCoverage } from '../../../lib/vendorMapping.ts';
import LinkPairForm from './LinkPairForm.jsx';

export const dynamic = 'force-dynamic';

export default function LinkVendorsPage() {
  const db = getDb();
  const coverage = summarizeMappingCoverage(db, DEFAULT_LOCATION_ID);

  return (
    <div>
      <p className="subtitle" style={{ marginTop: 0 }}>
        <Link href="/purchasing">← Order guide</Link>
        {' · '}
        <Link href="/purchasing/compare">Compare</Link>
      </p>
      <h1>Link vendors</h1>
      <p className="subtitle">Pick a Sysco and Shamrock item for the same staple. You confirm every link.</p>
      <div className="card">
        <LinkPairForm coverage={coverage} />
      </div>
    </div>
  );
}
