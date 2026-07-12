// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { searchVendorCatalog, summarizeMappingCoverage } from '../../../../lib/vendorMapping.ts';

export const dynamic = 'force-dynamic';

/**
 * @param {string | null} raw
 * @returns {'sysco' | 'shamrock' | null}
 */
function parseVendor(raw) {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'sysco' || v === 'shamrock') return v;
  return null;
}

/** @param {Request} req */
export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const vendor = parseVendor(url.searchParams.get('vendor'));
    if (!vendor) {
      return Response.json({ error: 'vendor must be sysco or shamrock' }, { status: 422 });
    }
    const q = url.searchParams.get('q');
    const unlinkedOnly = url.searchParams.get('unlinkedOnly') === '1';
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw != null ? Number(limitRaw) : undefined;
    const db = getDb();
    const rows = searchVendorCatalog(db, {
      vendor,
      q,
      unlinkedOnly,
      locationId: DEFAULT_LOCATION_ID,
      limit,
    });
    const coverage = summarizeMappingCoverage(db, DEFAULT_LOCATION_ID);
    return Response.json({ rows, coverage });
  } catch (err) {
    console.error('GET /api/purchasing/vendor-catalog failed:', err);
    return Response.json({ error: 'Failed to load vendor catalog' }, { status: 500 });
  }
}
