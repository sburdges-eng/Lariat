// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { requirePinOrScope } from '../../../../lib/pin';
import {
  getItemPrepHistory,
  getRecentEvents,
} from '../../../../lib/beoPrepHistory';

export const dynamic = 'force-dynamic';

const MAX_ITEMS_PER_REQUEST = 50;

const SCOPE = 'menu.prep_history';

/** @param {Request} req */
export async function GET(req) {
  const pinFail = await requirePinOrScope(req, SCOPE);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const items = url.searchParams.getAll('item').slice(0, MAX_ITEMS_PER_REQUEST);
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const includeRecent = url.searchParams.get('recent') === '1';
    const loc = locationFromRequest(req);
    const db = getDb();

    const matches = items.length
      ? getItemPrepHistory(db, loc, items, limit)
      : [];
    const recent = includeRecent ? getRecentEvents(db, loc, limit) : null;

    return Response.json({ matches, recent });
  } catch (err) {
    console.error('GET /api/beo/prep-history failed:', err);
    return Response.json(
      { error: 'Failed to load prep history' },
      { status: 500 }
    );
  }
}
