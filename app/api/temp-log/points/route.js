import { TempPoints } from '../../../../lib/tempLog';

export const dynamic = 'force-dynamic';

// Static registry read. No DB, no auth — cooks pull this on page load
// to populate the temp-point dropdown. Cheap; regenerates every request
// because the underlying array is a tiny frozen list.

export async function GET() {
  try {
    return Response.json({ points: TempPoints });
  } catch (err) {
    console.error('GET /api/temp-log/points failed:', err);
    return Response.json({ error: 'Failed to load temp points' }, { status: 500 });
  }
}
