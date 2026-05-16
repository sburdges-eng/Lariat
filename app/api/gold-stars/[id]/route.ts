import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  ctx: { params: { id: string } }
) {
  return withIdempotency(req, () => goldStarDeleteHandler(req, ctx));
}

async function goldStarDeleteHandler(
  req: NextRequest,
  { params }: { params: { id: string } }
) {

  params = await params;
  const id = Number(params?.id);

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  const db = getDb();
  const loc = locationFromRequest(req);
  
  const info = db
    .prepare('DELETE FROM gold_stars WHERE id = ? AND location_id = ?')
    .run(id, loc);
    
  if (info.changes === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  
  return NextResponse.json({ ok: true, id });
}
