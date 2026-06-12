import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gold-stars               → the BOARD feed: today's stars only.
 *   The recognition wall resets every day by design — yesterday's stars
 *   leave the board but are never deleted.
 * GET /api/gold-stars?view=leaderboard → the permanent per-employee record:
 *   all-time totals per cook (sum of stars, award count, last award date).
 * "Today" is the venue's local day (created_at in localtime), so a star
 * given during evening service doesn't vanish at the UTC rollover.
 */
export async function GET(req: Request) {
  const db = getDb();
  const loc = locationFromRequest(req);
  const view = new URL(req.url).searchParams.get('view');

  if (view === 'leaderboard') {
    const rows = db
      .prepare(
        `SELECT cook_name,
                SUM(stars)        AS total_stars,
                COUNT(*)          AS awards,
                MAX(awarded_date) AS last_awarded
           FROM gold_stars
          WHERE location_id = ?
            AND deleted_at IS NULL
          GROUP BY cook_name
          ORDER BY total_stars DESC, cook_name ASC`,
      )
      .all(loc);
    return Response.json(rows);
  }

  const rows = db
    .prepare(
      `SELECT * FROM gold_stars
        WHERE location_id = ?
          AND deleted_at IS NULL
          AND date(created_at, 'localtime') = date('now', 'localtime')
        ORDER BY id DESC
        LIMIT 50`,
    )
    .all(loc);

  return Response.json(rows);
}

export async function POST(req: Request) {
  return withIdempotency(req, () => goldStarsPostHandler(req));
}

async function goldStarsPostHandler(req: Request) {
  // HR/personal data — awarding a star is manager authority, same as
  // removing one (DELETE in [id]/route.ts has carried this gate since
  // PR #313-era hardening).
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const body = await req.json();
    const cookName = typeof body.cook_name === 'string' ? body.cook_name.trim() : '';
    const reasonText = typeof body.reason === 'string' ? body.reason.trim() : '';
    const { stars } = body;
    
    if (!cookName || !reasonText) {
      return Response.json({ error: 'Cook and reason needed' }, { status: 400 });
    }
    
    const db = getDb();
    const loc = locationFromBody(body);
    
    // Explicit bounding on stars 1-3
    const parsedStars = Math.min(Math.max(Number(stars) || 1, 1), 3);
    
    // ACID: HR/personal data — transaction + audit trail.
    const newId = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?,?,?,?)')
        .run(cookName, reasonText, parsedStars, loc);
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'gold_stars', entity_id: id, action: 'insert',
        actor_cook_id: null, actor_source: 'api',
        location_id: loc, payload: { cook_name: cookName, reason: reasonText, stars: parsedStars },
      });
      return id;
    })();
      
    return Response.json({ ok: true, id: newId });
  } catch {
    return Response.json({ error: 'Did not save. Try again.' }, { status: 500 });
  }
}
