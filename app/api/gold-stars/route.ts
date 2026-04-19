import { NextRequest, NextResponse } from 'next/server';
import { getDb, GoldStar } from '../../../lib/db';
import { locationFromBody, locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const db = getDb();
  const loc = locationFromRequest(req);
  
  const rows = db
    .prepare('SELECT * FROM gold_stars WHERE location_id = ? ORDER BY id DESC LIMIT 50')
    .all(loc) as GoldStar[];
    
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cook_name, reason, stars } = body;
    
    if (!cook_name || !reason) {
      return NextResponse.json({ error: 'cook_name and reason required' }, { status: 400 });
    }
    
    const db = getDb();
    const loc = locationFromBody(body);
    
    // Explicit bounding on stars 1-3
    const parsedStars = Math.min(Math.max(Number(stars) || 1, 1), 3);
    
    const info = db
      .prepare('INSERT INTO gold_stars (cook_name, reason, stars, location_id) VALUES (?,?,?,?)')
      .run(cook_name, reason, parsedStars, loc);
      
    return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
