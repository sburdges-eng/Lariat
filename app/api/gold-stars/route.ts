import { getDb } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const db = getDb();
  const loc = locationFromRequest(req);
  
  const rows = db
    .prepare('SELECT * FROM gold_stars WHERE location_id = ? ORDER BY id DESC LIMIT 50')
    .all(loc);
    
  return Response.json(rows);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { cook_name, reason, stars } = body;
    
    if (!cook_name || !reason) {
      return Response.json({ error: 'cook_name and reason required' }, { status: 400 });
    }
    
    const db = getDb();
    const loc = locationFromBody(body);
    
    // Explicit bounding on stars 1-3
    const parsedStars = Math.min(Math.max(Number(stars) || 1, 1), 3);
    
    // ACID: HR/personal data — transaction + audit trail.
    const newId = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?,?,?,?)')
        .run(cook_name, reason, parsedStars, loc);
      const id = Number(info.lastInsertRowid);
      postAuditEvent({
        entity: 'gold_stars', entity_id: id, action: 'insert',
        actor_cook_id: null, actor_source: 'api',
        location_id: loc, payload: { cook_name, reason, stars: parsedStars },
      });
      return id;
    })();
      
    return Response.json({ ok: true, id: newId });
  } catch (error) {
    return Response.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
