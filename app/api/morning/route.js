// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { todayISO } from '../../../lib/db';
import { locationFromRequest } from '../../../lib/location';
import { buildMorningDigest } from '../../../lib/morningDigest';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const dateParam = url.searchParams.get('date');
    const today =
      typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : todayISO();
    const loc = locationFromRequest(req);
    const digest = buildMorningDigest(loc, today);
    return Response.json(digest, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/morning failed:', err);
    return Response.json({ error: 'Could not load morning digest' }, { status: 500 });
  }
}
