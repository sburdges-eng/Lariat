import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const db = getDb();
  const loc = locationFromRequest(req);
  
  const rows = db
    .prepare('SELECT * FROM gold_stars WHERE location_id = ? ORDER BY id DESC LIMIT 50')
    .all(loc);
    
  return Response.json(rows);
}

export async function POST(req: Request) {
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
