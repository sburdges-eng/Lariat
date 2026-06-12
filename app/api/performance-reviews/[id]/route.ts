import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { withIdempotency } from '../../../../lib/idempotency';
import { requirePin } from '../../../../lib/pin';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withIdempotency(req, () => performanceReviewDeleteHandler(req, ctx));
}

async function performanceReviewDeleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // HR record deletion — manager PIN required (same gate as the
  // collection routes).
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  const resolvedParams = await params;
  try {
    const id = Number(resolvedParams?.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 });
    }

    const db = getDb();
    const loc = locationFromRequest(req);
    
    const info = db
      .prepare('DELETE FROM performance_reviews WHERE id = ? AND location_id = ?')
      .run(id, loc);
      
    if (info.changes === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
