import { getDb } from '../../../lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, name, created_at FROM locations ORDER BY id`).all();
  return Response.json(rows);
}
