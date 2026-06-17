// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { listVendorCompareRows } from '../../../../lib/vendorCompare.ts';
import { DEFAULT_LOCATION_ID } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

function clampLimit(raw) {
  if (raw == null || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const db = getDb();
    const summary = listVendorCompareRows(db, { locationId: DEFAULT_LOCATION_ID, limit });
    return Response.json(summary);
  } catch (err) {
    console.error('GET /api/purchasing/vendor-compare failed:', err);
    return Response.json({ error: 'Failed to load vendor compare' }, { status: 500 });
  }
}
