import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { logAuditAction } from '../../../lib/auditLog.mjs';
import { validateScores } from '../../../lib/performanceReviews';
import { requirePin } from '../../../lib/pin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Employee reviews are HR records — manager PIN required even to read
  // (closes the "not yet middleware-gated" follow-up from the 2026-05-08
  // audit; the /management page shell was already behind the matcher).
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
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
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
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

    // Two-track audit per docs/PATTERNS.md §3:
    //   - DB audit (audit_events) MUST be inside the same db.transaction
    //     as the source INSERT — a rollback wipes the audit row with the
    //     source row.
    //   - File audit (data/audit/management-actions.jsonl, via
    //     lib/auditLog.mjs::logAuditAction) is a separate track, owned
    //     by the management-actions surface, and writes via
    //     fs.appendFileSync.
    //
    // The two MUST NOT mix. Calling logAuditAction inside the
    // db.transaction was a regression: a synchronous file-write failure
    // (disk full, audit dir missing) would abort the SQLite transaction
    // and roll back the already-INSERTed review row. Inverse: a SQLite
    // commit failure AFTER the file write left a ghost JSONL entry with
    // no DB row backing it.
    //
    // Fix: emit the file audit AFTER the transaction commits. If the
    // file-write fails the DB row + audit_events row are durable and
    // authoritative; we log and move on (best-effort, mirrors the
    // recipes/[slug] PUT pattern).
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

      return id;
    })();

    // File-track audit fires after the DB tx commits. Best-effort —
    // a write failure here is logged but does NOT roll back the
    // (already-committed) DB row + audit_events row.
    try {
      logAuditAction({
        action: 'performance_review_logged',
        user: reviewerName,
        changes: { cook: cookName, cook_uuid: cookUuid, date: reviewDate },
        location: loc,
      });
    } catch (auditErr) {
      console.error('POST /api/performance-reviews: file-audit write failed:', auditErr);
    }

    return Response.json({ ok: true, id: newId });
  } catch (err) {
    console.error('POST /api/performance-reviews error:', err);
    return Response.json({ error: 'Did not save. Try again.' }, { status: 500 });
  }
}
