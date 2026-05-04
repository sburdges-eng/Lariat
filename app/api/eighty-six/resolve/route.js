import { getDb } from '../../../../lib/db';
import { locationFromBody } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  return withIdempotency(req, () => eightySixResolvePostHandler(req));
}

async function eightySixResolvePostHandler(req) {
  try {
    const body = await req.json();
    const { id, cook_id } = body || {};
    if (!id) return Response.json({ error: 'id required' }, { status: 400 });
    const loc = locationFromBody(body);
    const db = getDb();
    db.prepare(`
      UPDATE eighty_six
      SET resolved_at = datetime('now'), resolved_by = ?
      WHERE id = ? AND location_id = ?
    `).run(cook_id || null, id, loc);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('POST /api/eighty-six/resolve failed:', err);
    return Response.json({ error: 'Failed to resolve 86' }, { status: 500 });
  }
}
