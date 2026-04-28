/**
 * /api/costing/pack-changes — list + acknowledge T6 pack-size changes.
 *
 * GET: returns the triage queue (defaults to acknowledged=0). Pure read.
 * POST: acknowledges one row by id. Acknowledgement is idempotent and
 *       writes a management-action audit row via lib/auditLog.mjs.
 *
 * PIN-gated via the /api/costing matcher in middleware.js.
 */

import { getDb } from '../../../../lib/db';
import {
  listPackChanges,
  unacknowledgedCount,
  acknowledgePackChange,
} from '../../../../lib/packChangesRepo';
import { logAuditAction } from '../../../../lib/auditLog.mjs';

export const dynamic = 'force-dynamic';

const VALID_FILTERS = new Set(['open', 'acknowledged', 'all']);

function clampLimit(raw) {
  if (raw == null || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const filterRaw = url.searchParams.get('filter') ?? 'open';
    const filter = VALID_FILTERS.has(filterRaw) ? filterRaw : 'open';
    const vendor = url.searchParams.get('vendor');
    const limit = clampLimit(url.searchParams.get('limit'));

    const db = getDb();
    const changes = listPackChanges(db, {
      filter,
      vendor: vendor && vendor.trim() ? vendor.trim() : null,
      limit,
    });
    const counts = unacknowledgedCount(db);

    return Response.json({
      filter,
      vendor: vendor || null,
      total: changes.length,
      unacknowledged: counts.total,
      changes,
    });
  } catch (err) {
    console.error('GET /api/costing/pack-changes failed:', err);
    return Response.json(
      { error: 'Failed to load pack-size changes' },
      { status: 500 },
    );
  }
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json(
      { error: 'Body.id must be a positive integer' },
      { status: 400 },
    );
  }
  const note =
    typeof body?.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 500)
      : null;

  try {
    const db = getDb();
    const result = acknowledgePackChange(db, id);
    if (!result.found) {
      return Response.json(
        { error: 'pack_size_changes row not found', id },
        { status: 404 },
      );
    }
    if (!result.was_already_acknowledged) {
      logAuditAction({
        action: 'pack_size_change_acknowledged',
        pack_size_changes_id: id,
        vendor: result.row?.vendor ?? null,
        sku: result.row?.sku ?? null,
        prev_pack: result.row?.prev_pack ?? null,
        new_pack: result.row?.new_pack ?? null,
        note,
      });
    }
    return Response.json({
      id,
      acknowledged: 1,
      was_already_acknowledged: result.was_already_acknowledged,
      row: result.row,
    });
  } catch (err) {
    console.error('POST /api/costing/pack-changes failed:', err);
    return Response.json(
      { error: 'Failed to acknowledge pack-size change' },
      { status: 500 },
    );
  }
}
