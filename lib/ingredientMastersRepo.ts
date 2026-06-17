// lib/ingredientMastersRepo.ts
//
// Read/update layer for the `ingredient_masters` table — the operator
// review surface lives at /costing/ingredient-masters.
//
// ingredient_masters is populated by ingest-costing.mjs (T7 pass) from
// confirmed vendor-ingredient → ingredient_key maps. Most of the rows
// are fine on first pass; operators only touch them when:
//
//   - a master has a low-quality canonical_name (e.g. a slug-style
//     placeholder),
//   - the category needs to be set (the upsert leaves NULL when the
//     seed didn't carry one — COALESCE keeps the prior value across
//     re-ingests),
//   - the preferred_vendor should be pinned to one of Sysco / Shamrock,
//   - the row needs a "last_reviewed" stamp so the dashboard shows it
//     as triaged (rows with NULL last_reviewed OR older than 90 days
//     sort to the top).
//
// All writes go through `updateMaster` which:
//   1. starts a tx,
//   2. UPDATEs the row,
//   3. posts an audit_events row with action='correction' inside the tx,
//   4. returns the post-update snapshot.
//
// docs/PATTERNS.md §3 — every regulated mutation posts one audit row
// inside the same transaction as the source UPDATE.

import type { Database as DB } from 'better-sqlite3';
import { postAuditEvent } from './auditEvents.ts';

export class MasterUpdateRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterUpdateRejectedError';
  }
}

export interface IngredientMasterRow {
  master_id: string;
  canonical_name: string;
  category: string | null;
  preferred_vendor: string | null;
  quality_locked: number;
  quality_lock_reason: string | null;
  last_reviewed: string | null;
  vendor_price_count: number;
  bom_line_count: number;
}

export interface ListMastersOpts {
  /** Substring match against master_id OR canonical_name. */
  q?: string | null;
  /** Limit; default 200, max 1000. */
  limit?: number | null;
  /** Filter by review state: 'needs_review' (NULL last_reviewed OR >90d), 'reviewed', 'all'. Default 'all'. */
  filter?: 'all' | 'needs_review' | 'reviewed' | null;
}

const STALE_AFTER_DAYS = 90;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function clampLimit(raw: number | null | undefined): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

/**
 * List masters with vendor_prices + bom_lines counts joined in. Pure SELECT.
 *
 * Sort order:
 *   - "needs review" first (NULL last_reviewed OR > 90 days old),
 *   - then by vendor_price_count DESC (the masters that touch more
 *     vendor rows are higher leverage to clean up),
 *   - then by canonical_name ASC (deterministic).
 */
export function listMasters(db: DB, opts: ListMastersOpts = {}): IngredientMasterRow[] {
  const q = opts.q?.trim() || null;
  const limit = clampLimit(opts.limit);
  const filter = opts.filter ?? 'all';

  const wheres: string[] = [];
  const params: Record<string, unknown> = { limit };

  if (q) {
    wheres.push(`(lower(im.master_id) LIKE lower(@q) OR lower(im.canonical_name) LIKE lower(@q))`);
    params.q = `%${q}%`;
  }
  if (filter === 'needs_review') {
    wheres.push(`(im.last_reviewed IS NULL OR julianday('now') - julianday(im.last_reviewed) > ${STALE_AFTER_DAYS})`);
  } else if (filter === 'reviewed') {
    wheres.push(`(im.last_reviewed IS NOT NULL AND julianday('now') - julianday(im.last_reviewed) <= ${STALE_AFTER_DAYS})`);
  }
  const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const sql = `
    SELECT
      im.master_id,
      im.canonical_name,
      im.category,
      im.preferred_vendor,
      im.quality_locked,
      im.quality_lock_reason,
      im.last_reviewed,
      COALESCE(vp.cnt, 0) AS vendor_price_count,
      COALESCE(bl.cnt, 0) AS bom_line_count,
      CASE
        WHEN im.last_reviewed IS NULL THEN 1
        WHEN julianday('now') - julianday(im.last_reviewed) > ${STALE_AFTER_DAYS} THEN 1
        ELSE 0
      END AS needs_review
    FROM ingredient_masters im
    LEFT JOIN (
      SELECT master_id, COUNT(*) AS cnt FROM vendor_prices
        WHERE master_id IS NOT NULL GROUP BY master_id
    ) vp ON vp.master_id = im.master_id
    LEFT JOIN (
      SELECT master_id, COUNT(*) AS cnt FROM bom_lines
        WHERE master_id IS NOT NULL GROUP BY master_id
    ) bl ON bl.master_id = im.master_id
    ${whereSql}
    ORDER BY needs_review DESC, vendor_price_count DESC, im.canonical_name ASC
    LIMIT @limit
  `;
  const rows = db.prepare(sql).all(params) as (IngredientMasterRow & { needs_review: number })[];
  return rows.map(({ needs_review: _ignore, ...r }) => r);
}

export function getMaster(db: DB, masterId: string): IngredientMasterRow | null {
  const row = db
    .prepare(
      `
      SELECT
        im.master_id,
        im.canonical_name,
        im.category,
        im.preferred_vendor,
        im.quality_locked,
        im.quality_lock_reason,
        im.last_reviewed,
        COALESCE(vp.cnt, 0) AS vendor_price_count,
        COALESCE(bl.cnt, 0) AS bom_line_count
      FROM ingredient_masters im
      LEFT JOIN (
        SELECT master_id, COUNT(*) AS cnt FROM vendor_prices
          WHERE master_id IS NOT NULL GROUP BY master_id
      ) vp ON vp.master_id = im.master_id
      LEFT JOIN (
        SELECT master_id, COUNT(*) AS cnt FROM bom_lines
          WHERE master_id IS NOT NULL GROUP BY master_id
      ) bl ON bl.master_id = im.master_id
      WHERE im.master_id = ?
    `,
    )
    .get(masterId) as IngredientMasterRow | undefined;
  return row ?? null;
}

export interface MasterUpdates {
  canonical_name?: string;
  category?: string | null;
  preferred_vendor?: string | null;
  quality_locked?: boolean | number | null;
  quality_lock_reason?: string | null;
  /** Pass 'now' to stamp datetime('now'); pass null to clear; pass an ISO string to set explicitly. */
  last_reviewed?: 'now' | string | null;
}

export interface UpdateMasterResult {
  found: boolean;
  changed: boolean;
  before: IngredientMasterRow | null;
  after: IngredientMasterRow | null;
}

/**
 * Apply a partial update to a master row. Writes audit_events row with
 * action='correction' inside the same transaction; rolls back atomically
 * on audit-event failure.
 *
 * Does NOT update master_id (the PK is immutable in this surface).
 * Empty `updates` is a no-op that returns changed=false with no audit row.
 */

function asBoolFlag(v: unknown): boolean | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v === true || v === 1 || v === '1') return true;
  if (v === false || v === 0 || v === '0') return false;
  return undefined;
}

function validateMasterUpdates(
  before: IngredientMasterRow,
  updates: MasterUpdates,
): void {
  const nextLocked = asBoolFlag(updates.quality_locked);
  const lockedNow = Boolean(before.quality_locked);
  const willBeLocked = nextLocked === undefined ? lockedNow : Boolean(nextLocked);

  if (nextLocked === true && updates.preferred_vendor === undefined && !before.preferred_vendor) {
    throw new MasterUpdateRejectedError('Pick a vendor before locking for quality.');
  }

  if (
    lockedNow &&
    updates.preferred_vendor !== undefined &&
    updates.preferred_vendor !== before.preferred_vendor &&
    !(nextLocked === false)
  ) {
    throw new MasterUpdateRejectedError('Quality lock is on — unlock before changing vendor.');
  }

  if (willBeLocked && updates.preferred_vendor === null) {
    throw new MasterUpdateRejectedError('Cannot clear preferred vendor while quality lock is on.');
  }
}

export function updateMaster(
  db: DB,
  masterId: string,
  updates: MasterUpdates,
  cookId: string | null,
  opts?: { actorSource?: string; locationId?: string },
): UpdateMasterResult {
  const before = getMaster(db, masterId);
  if (!before) {
    return { found: false, changed: false, before: null, after: null };
  }

  validateMasterUpdates(before, updates);

  // Build SET clause from only the present fields. Empty-update fast path.
  const sets: string[] = [];
  const params: Record<string, unknown> = { master_id: masterId };
  if (Object.prototype.hasOwnProperty.call(updates, 'canonical_name')) {
    sets.push('canonical_name = @canonical_name');
    params.canonical_name = updates.canonical_name;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'category')) {
    sets.push('category = @category');
    params.category = updates.category;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'preferred_vendor')) {
    sets.push('preferred_vendor = @preferred_vendor');
    params.preferred_vendor = updates.preferred_vendor;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'quality_locked')) {
    const flag = asBoolFlag(updates.quality_locked);
    sets.push('quality_locked = @quality_locked');
    params.quality_locked = flag ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'quality_lock_reason')) {
    sets.push('quality_lock_reason = @quality_lock_reason');
    params.quality_lock_reason = updates.quality_lock_reason;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'last_reviewed')) {
    if (updates.last_reviewed === 'now') {
      sets.push(`last_reviewed = datetime('now')`);
    } else {
      sets.push('last_reviewed = @last_reviewed');
      params.last_reviewed = updates.last_reviewed;
    }
  }
  if (sets.length === 0) {
    return { found: true, changed: false, before, after: before };
  }

  const actorSource = opts?.actorSource ?? 'manager_ui';
  const locationId = opts?.locationId ?? 'default';

  db.transaction(() => {
    db.prepare(
      `UPDATE ingredient_masters SET ${sets.join(', ')} WHERE master_id = @master_id`,
    ).run(params);
    postAuditEvent({
      entity: 'ingredient_masters',
      entity_id: null, // master_id is TEXT, not int; payload carries it
      action: 'correction',
      actor_cook_id: cookId,
      actor_source: actorSource,
      location_id: locationId,
      payload: { master_id: masterId, updates },
    });
  })();

  const after = getMaster(db, masterId);
  return { found: true, changed: true, before, after };
}
