/**
 * T-5: GET /api/vendor-prices/history
 *
 * Read-only price-trend endpoint. Thin wrapper over
 * `listPriceSeries(db, ...)` in lib/vendorPricesRepo.ts — the helper
 * owns the SQL, clamping, and column shape; this route handles
 * transport only.
 *
 * Shape:
 *   GET /api/vendor-prices/history?vendor=Sysco&sku=SYSCO-ONION
 *       &location=default&limit=50
 *   →
 *   {
 *     vendor,
 *     sku,
 *     location_id,
 *     limit,          // the effective limit actually used (post-clamp)
 *     count,          // series.length — handy for a zero-state branch
 *     series: [ { snapshot_at, run_id, pack_price, unit_price, ... }, ... ]
 *   }
 *
 *   Missing vendor or sku → 400 { error }.
 *   Empty history for a real (vendor, sku) → 200 with series: [] (the
 *   operator's asking "does this SKU have history?"; "no snapshots yet"
 *   is a truthful 200, not a 404).
 *
 * No PIN gate — operators and future UI need this without friction.
 * `location` is aliased from `location_id` via locationFromRequest().
 */

import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { listPriceSeries } from '../../../../lib/vendorPricesRepo';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const vendor = (url.searchParams.get('vendor') ?? '').trim();
    const sku = (url.searchParams.get('sku') ?? '').trim();

    if (!vendor || !sku) {
      return Response.json(
        { error: 'vendor and sku are required' },
        { status: 400 },
      );
    }

    const location_id = locationFromRequest(req);

    // Parse limit; fall back to default (100) if absent, non-integer,
    // or non-positive. The helper clamps again defensively.
    const limitRaw = url.searchParams.get('limit');
    let limit = 100;
    if (limitRaw != null && limitRaw !== '') {
      const parsed = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(1000, parsed);
      }
    }

    const db = getDb();
    const series = listPriceSeries(db, { vendor, sku, location_id, limit });

    return Response.json({
      vendor,
      sku,
      location_id,
      limit,
      count: series.length,
      series,
    });
  } catch (err) {
    console.error('GET /api/vendor-prices/history failed:', err);
    return Response.json(
      { error: 'Failed to load price history' },
      { status: 500 },
    );
  }
}
