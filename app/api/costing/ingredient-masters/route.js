// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * /api/costing/ingredient-masters
 *
 *   GET  ?q=&filter=&limit=    list with vendor_prices/bom_lines counts
 *   PATCH { master_id, updates: {...}, cook_id? }
 *                              update one master + post one audit row
 *
 * PIN-gated via middleware.js + a defensive re-check at the route.
 */

import { getDb } from '../../../../lib/db';
import { requirePin } from '../../../../lib/pin';
import { withIdempotency } from '../../../../lib/idempotency';
import {
  listMasters,
  getMaster,
  updateMaster,
} from '../../../../lib/ingredientMastersRepo';
import { locationFromBody, locationFromRequest } from '../../../../lib/location';

export const dynamic = 'force-dynamic';

const VALID_FILTERS = new Set(['all', 'needs_review', 'reviewed']);

function clampLimit(raw) {
  if (raw == null || raw === '') return 200;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.min(1000, Math.floor(n)));
}

const MAX_NAME = 200;
const MAX_CATEGORY = 80;
const MAX_VENDOR = 80;

function clipOrNull(v, max) {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined; // signal validation failure
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q');
    const filterRaw = url.searchParams.get('filter') ?? 'all';
    const filter = VALID_FILTERS.has(filterRaw) ? filterRaw : 'all';
    const limit = clampLimit(url.searchParams.get('limit'));

    const db = getDb();
    const masters = listMasters(db, { q, filter, limit });
    return Response.json({
      filter,
      q: q || null,
      total: masters.length,
      masters,
    });
  } catch (err) {
    console.error('GET /api/costing/ingredient-masters failed:', err);
    return Response.json({ error: 'Failed to load ingredient masters' }, { status: 500 });
  }
}

export async function PATCH(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => patchHandler(req));
}

async function patchHandler(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const masterId =
    typeof body?.master_id === 'string' && body.master_id.trim()
      ? body.master_id.trim()
      : null;
  if (!masterId) {
    return Response.json({ error: 'master_id required' }, { status: 400 });
  }

  const rawUpdates = body?.updates;
  if (!rawUpdates || typeof rawUpdates !== 'object' || Array.isArray(rawUpdates)) {
    return Response.json({ error: 'updates must be an object' }, { status: 400 });
  }

  // Validate fields. Each field is optional; only fields actually
  // present in `updates` are forwarded. canonical_name must be a
  // non-empty string when present; category/preferred_vendor may be
  // null to clear; last_reviewed accepts 'now' | null | ISO string.
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(rawUpdates, 'canonical_name')) {
    const v = clipOrNull(rawUpdates.canonical_name, MAX_NAME);
    if (v === undefined) return Response.json({ error: 'canonical_name must be a string' }, { status: 422 });
    if (v === null || v === '') return Response.json({ error: 'canonical_name cannot be empty' }, { status: 422 });
    updates.canonical_name = v;
  }
  if (Object.prototype.hasOwnProperty.call(rawUpdates, 'category')) {
    const v = clipOrNull(rawUpdates.category, MAX_CATEGORY);
    if (v === undefined) return Response.json({ error: 'category must be a string or null' }, { status: 422 });
    updates.category = v;
  }
  if (Object.prototype.hasOwnProperty.call(rawUpdates, 'preferred_vendor')) {
    const v = clipOrNull(rawUpdates.preferred_vendor, MAX_VENDOR);
    if (v === undefined) return Response.json({ error: 'preferred_vendor must be a string or null' }, { status: 422 });
    updates.preferred_vendor = v;
  }
  if (Object.prototype.hasOwnProperty.call(rawUpdates, 'last_reviewed')) {
    const v = rawUpdates.last_reviewed;
    if (v === null || v === 'now' || (typeof v === 'string' && v.trim())) {
      updates.last_reviewed = v === null ? null : v === 'now' ? 'now' : v.trim();
    } else {
      return Response.json({ error: "last_reviewed must be null, 'now', or an ISO string" }, { status: 422 });
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'updates is empty' }, { status: 400 });
  }

  const cookId =
    typeof body?.cook_id === 'string' && body.cook_id.trim()
      ? body.cook_id.trim().slice(0, 64)
      : null;
  const locationId = locationFromBody(body) || locationFromRequest(req) || 'default';

  try {
    const db = getDb();
    const result = updateMaster(db, masterId, updates, cookId, {
      locationId,
      actorSource: 'manager_ui',
    });
    if (!result.found) {
      return Response.json({ error: 'master not found', master_id: masterId }, { status: 404 });
    }
    return Response.json({
      master_id: masterId,
      changed: result.changed,
      master: result.after,
    });
  } catch (err) {
    console.error('PATCH /api/costing/ingredient-masters failed:', err);
    return Response.json({ error: 'Failed to update ingredient master' }, { status: 500 });
  }
}
