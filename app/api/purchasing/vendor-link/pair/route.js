// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { DEFAULT_LOCATION_ID } from '../../../../../lib/location';
import { pairCatalogRows, VendorMappingRejectedError } from '../../../../../lib/vendorMappingRepo.ts';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const body = await req.json();
    const db = getDb();
    const result = pairCatalogRows(db, {
      syscoKey: body.syscoKey,
      shamrockKey: body.shamrockKey,
      canonicalName: body.canonicalName,
      locationId: DEFAULT_LOCATION_ID,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof VendorMappingRejectedError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error('POST /api/purchasing/vendor-link/pair failed:', err);
    return Response.json({ error: 'Failed to link vendors' }, { status: 500 });
  }
}
