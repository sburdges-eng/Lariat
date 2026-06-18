// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';
import { searchVendorCatalog, summarizeMappingCoverage } from '../../../../lib/vendorMapping.ts';

export const dynamic = 'force-dynamic';

function parseVendor(raw) {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'sysco' || v === 'shamrock') return v;
  return null;
}

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
