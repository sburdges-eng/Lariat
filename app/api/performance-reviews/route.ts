import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { logAuditAction } from '../../../lib/auditLog.mjs';
import { validateScores } from '../../../lib/performanceReviews';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = getDb();
    const loc = locationFromRequest(req);
    
    const rows = db
      .prepare('SELECT * FROM performance_reviews WHERE location_id = ? ORDER BY review_date DESC, id DESC')
      .all(loc);
      
    return Response.json(rows);
  } catch {
    return Response.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return withIdempotency(req, () => performanceReviewPostHandler(req));
}

async function performanceReviewPostHandler(req: Request) {
  try {
    const body = await req.json();
    const cookName = typeof body.cook_name === 'string' ? body.cook_name.trim() : '';
    const cookUuid = typeof body.cook_uuid === 'string' ? body.cook_uuid.trim() : null;
    const reviewDate = typeof body.review_date === 'string' ? body.review_date.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const reviewerName = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : '';
    
    const punctuality = Number(body.punctuality_score);
    const technique = Number(body.technique_score);
    const speed = Number(body.speed_score);

    if (!cookName || !reviewDate || !reviewerName) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validationError = validateScores({
      punctuality_score: punctuality,
      technique_score: technique,
      speed_score: speed,
    });

    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const db = getDb();
    const loc = locationFromBody(body);

    const newId = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO performance_reviews (
          cook_name, cook_uuid, review_date, punctuality_score, technique_score, speed_score, 
          notes, reviewer_name, location_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cookName, cookUuid, reviewDate, punctuality, technique, speed, notes, reviewerName, loc);
      
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'performance_reviews', 
        entity_id: id, 
        action: 'insert',
        actor_cook_id: null, 
        actor_source: 'api',
        location_id: loc, 
        payload: { 
          cook_name: cookName, 
          cook_uuid: cookUuid,
          review_date: reviewDate, 
          punctuality, technique, speed, 
          reviewer_name: reviewerName 
        },
      });

      logAuditAction({
        action: 'performance_review_logged',
        user: reviewerName,
        changes: { cook: cookName, cook_uuid: cookUuid, date: reviewDate },
        location: loc,
      });

      return id;
    })();

    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/performance-reviews error:', err);
    return Response.json({ error: 'Did not save. Try again.' }, { status: 500 });
  }
}
