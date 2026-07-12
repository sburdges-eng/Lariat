// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { DEFAULT_LOCATION_ID } from '../../../../../lib/location';
import { withIdempotency } from '../../../../../lib/idempotency';
import { attachCatalogRow, VendorMappingRejectedError } from '../../../../../lib/vendorMappingRepo.ts';

export const dynamic = 'force-dynamic';

/** @param {Request} req */
export async function POST(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  // Replaying a queued POST would double-write the vendor attachment.
  return withIdempotency(req, () => attachPostHandler(req));
}

/** @param {Request} req */
async function attachPostHandler(req) {
  try {
    const body = await req.json();
    const db = getDb();
    const result = attachCatalogRow(db, {
      masterId: body.masterId,
      catalogKey: body.catalogKey,
      locationId: DEFAULT_LOCATION_ID,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof VendorMappingRejectedError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error('POST /api/purchasing/vendor-link/attach failed:', err);
    return Response.json({ error: 'Failed to attach vendor' }, { status: 500 });
  }
}
