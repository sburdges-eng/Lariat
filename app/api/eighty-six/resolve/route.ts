// POST /api/eighty-six/resolve — mark an active 86 row resolved.
//
// Pre-2026-05-08 this route did:
//   - read `loc` from `body.location_id` (caller-asserted)
//   - UPDATE eighty_six WHERE id=? AND location_id=?
// which let a cook scoped to site-A resolve site-B's 86 by sending
// the target's location_id in the body. Two-key control of the WHERE
// clause is no guard at all.
//
// As of this PR: the location key comes from `?location=` via
// locationFromRequest(req), the row is snapshotted first, the
// existing.location_id is compared to the caller's, and the
// UPDATE + audit run in a single db.transaction. 404 on the
// cross-location guard fires WITHOUT leaking existence (the same
// status as "id never existed").
//
// Audit: 86 inserts already emit a `cloud_bridge`-style audit row
// (see ../route.js POST). Resolves now do the same — entity
// `eighty_six`, action `update` (or `resolve`-flavored via the note),
// inside the same transaction so a stranded resolution is impossible.

import { getDb } from '../../../../lib/db';
import { locationFromRequest } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';

export const dynamic = 'force-dynamic';

interface EightySixRow {
  id: number;
  shift_date: string;
  item: string;
  resolved_at: string | null;
  resolved_by: string | null;
  location_id: string;
}

type ResolveResult =
  | { status: 404 | 409; error: string; entry?: EightySixRow }
  | { status: 200; updated: EightySixRow };

const clip = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(req: Request) {
  return withIdempotency(req, () => eightySixResolvePostHandler(req));
}

async function eightySixResolvePostHandler(req: Request) {
  try {
    const body = (await req.json()) as { id?: unknown; cook_id?: unknown };
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Response.json({ error: 'id required' }, { status: 400 });
    }
    const cook_id = clip(body?.cook_id, 64);
    const callerLocation = locationFromRequest(req);

    const db = getDb();

    const performUpdate = db.transaction((): ResolveResult => {
      const existing = db.prepare('SELECT * FROM eighty_six WHERE id=?').get(id) as
        | EightySixRow
        | undefined;
      if (!existing) return { status: 404, error: 'unknown 86' };

      // Cross-location IDOR guard: 404 (not 403) so existence at
      // another site does not leak to a guessing caller.
      if (existing.location_id !== callerLocation) {
        return { status: 404, error: 'unknown 86' };
      }

      if (existing.resolved_at) {
        return { status: 409, error: '86 already resolved', entry: existing };
      }

      db.prepare(`
        UPDATE eighty_six
        SET resolved_at = datetime('now'), resolved_by = ?
        WHERE id = ?
      `).run(cook_id || null, id);

      const updated = db.prepare('SELECT * FROM eighty_six WHERE id=?').get(id) as EightySixRow;

      postAuditEvent({
        entity: 'eighty_six',
        entity_id: id,
        action: 'update',
        actor_cook_id: cook_id,
        actor_source: 'api',
        payload: updated,
        shift_date: existing.shift_date,
        location_id: existing.location_id,
        note: 'resolved',
      });

      return { status: 200, updated };
    });

    const result = performUpdate();
    if (result.status !== 200) {
      const { status, ...rest } = result;
      return Response.json(rest, { status });
    }
    return Response.json({ ok: true, entry: result.updated });
  } catch (err) {
    console.error('POST /api/eighty-six/resolve failed:', err);
    return Response.json({ error: 'Failed to resolve 86' }, { status: 500 });
  }
}
