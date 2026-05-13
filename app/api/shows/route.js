// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * GET /api/shows
 *   ?op=upcoming&today=&weeks=         → list upcoming shows
 *   ?op=playbook&show=<id>&today=      → one show with parsed status
 *   ?op=archive&q=&era=                → archive search
 *
 * PIN gating is performed by middleware.js (route registers in
 * SENSITIVE_PREFIXES). This handler trusts the gate.
 */
import { getDb } from '../../../lib/db';
import {
  upcomingShows, pipelineCounts, archiveSearch, archiveEras, getShowById,
} from '../../../lib/showsRepo';
import { locationFromRequest } from '../../../lib/location';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const url = new URL(req.url);
  const op = url.searchParams.get('op');
  const today = url.searchParams.get('today') || undefined;
  const loc = locationFromRequest(req);

  const db = getDb();
  if (op === 'upcoming') {
    const weeks = Number(url.searchParams.get('weeks') ?? 5) || 5;
    const rows = upcomingShows(db, loc, { today, weeks });
    const counts = pipelineCounts(db, loc, { today, weeks: 52 });
    return Response.json({ rows, counts });
  }
  if (op === 'playbook') {
    const id = Number(url.searchParams.get('show'));
    if (!Number.isFinite(id) || id <= 0) {
      return Response.json({ error: 'invalid show id' }, { status: 400 });
    }
    const row = getShowById(db, loc, id);
    if (!row) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json({ row });
  }
  if (op === 'archive') {
    const q = url.searchParams.get('q') ?? undefined;
    const eraStr = url.searchParams.get('era');
    const era = eraStr ? Number(eraStr) : undefined;
    const rows = archiveSearch(db, loc, { q, era });
    const eras = archiveEras(db, loc);
    return Response.json({ rows, eras });
  }
  return Response.json(
    { error: 'invalid op (expected upcoming|playbook|archive)' },
    { status: 400 },
  );
}
