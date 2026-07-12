// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { listVendorCompareRows } from '../../../../lib/vendorCompare.ts';
import { listSingleVendorMasters, summarizeMappingCoverage } from '../../../../lib/vendorMapping.ts';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

/**
 * @param {string | null} raw
 * @returns {number}
 */
function clampLimit(raw) {
  if (raw == null || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

/** @param {Request} req */
export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const db = getDb();
    const summary = listVendorCompareRows(db, { locationId: DEFAULT_LOCATION_ID, limit });
    const coverage = summarizeMappingCoverage(db, DEFAULT_LOCATION_ID);
    const single_vendor_masters = listSingleVendorMasters(db, DEFAULT_LOCATION_ID);
    return Response.json({ ...summary, coverage, single_vendor_masters });
  } catch (err) {
    console.error('GET /api/purchasing/vendor-compare failed:', err);
    return Response.json({ error: 'Failed to load vendor compare' }, { status: 500 });
  }
}
