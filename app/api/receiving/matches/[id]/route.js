// @ts-nocheck - pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/**
 * PATCH /api/receiving/matches/[id]
 *
 * Resolve one unmatched receiving row to an ingredient master and backfill
 * the missing inventory credit in the same transaction as the audit rows.
 */

import { getDb } from '../../../../../lib/db';
import { requirePin } from '../../../../../lib/pin';
import { withIdempotency } from '../../../../../lib/idempotency';
import { locationFromBody, locationFromRequest } from '../../../../../lib/location';
import { postAuditEvent } from '../../../../../lib/auditEvents';
import { appendOp } from '../../../../../lib/syncFeed';
import { localIdentityFields } from '../../../../../lib/localIdentity';

export const dynamic = 'force-dynamic';

function clip(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function parseId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req, ctx) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  return withIdempotency(req, () => patchHandler(req, ctx));
}

async function patchHandler(req, { params }) {
  const id = parseId(params?.id);
  if (!id) {
    return Response.json({ error: 'receiving id required' }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const masterId = clip(body?.master_id, 200);
  if (!masterId) {
    return Response.json({ error: 'master_id required' }, { status: 400 });
  }
  const cookId = clip(body?.cook_id, 64);
  const location_id = locationFromBody(body) || locationFromRequest(req);

  try {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM receiving_log WHERE id = ? AND location_id = ?')
      .get(id, location_id);
    if (!row) {
      return Response.json({ error: 'receiving row not found' }, { status: 404 });
    }

    const master = db
      .prepare('SELECT * FROM ingredient_masters WHERE master_id = ?')
      .get(masterId);
    if (!master) {
      return Response.json({ error: 'master not found', master_id: masterId }, { status: 404 });
    }

    const existingCredit = db
      .prepare('SELECT * FROM inventory_updates WHERE receiving_log_id = ?')
      .get(id);

    if (!['accepted', 'accepted_with_note'].includes(row.status)) {
      return Response.json({ error: 'rejected deliveries cannot add stock' }, { status: 409 });
    }
    if (!(Number(row.received_qty) > 0) || !String(row.received_unit ?? '').trim() || !row.item) {
      return Response.json({ error: 'delivery has no stock count to add' }, { status: 409 });
    }

    const result = db.transaction(() => {
      db
        .prepare(
          `UPDATE receiving_log
              SET master_id = ?,
                  match_status = 'matched',
                  match_reason = 'manager_selected'
            WHERE id = ?`,
        )
        .run(masterId, id);

      const after = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(id);

      postAuditEvent({
        entity: 'receiving_log',
        entity_id: id,
        action: 'correction',
        actor_cook_id: cookId,
        actor_source: 'manager_ui',
        payload: {
          before: {
            id: row.id,
            master_id: row.master_id,
            match_status: row.match_status,
            match_reason: row.match_reason,
          },
          after: {
            id: after.id,
            master_id: after.master_id,
            match_status: after.match_status,
            match_reason: after.match_reason,
          },
        },
        shift_date: row.shift_date,
        location_id,
        note: `receiving_match:${id}`,
      });

      const receivingIdentity = localIdentityFields();
      appendOp({
        opId: receivingIdentity.opId,
        tableName: 'receiving_log',
        locationId: location_id,
        opKind: 'update',
        rowPk: String(id),
        rowJson: JSON.stringify(after),
        createdAt: receivingIdentity.createdAt,
        sourceHost: receivingIdentity.sourceHost,
        sourceStartedAt: receivingIdentity.sourceStartedAt,
      });

      let invRow;
      if (existingCredit) {
        db
          .prepare(`UPDATE inventory_updates SET master_id = ? WHERE id = ?`)
          .run(masterId, existingCredit.id);
        invRow = db
          .prepare('SELECT * FROM inventory_updates WHERE id = ?')
          .get(existingCredit.id);

        postAuditEvent({
          entity: 'inventory_updates',
          entity_id: Number(existingCredit.id),
          action: 'correction',
          actor_cook_id: cookId,
          actor_source: 'receiving_match_resolution',
          payload: {
            before: {
              id: existingCredit.id,
              master_id: existingCredit.master_id,
              receiving_log_id: existingCredit.receiving_log_id,
            },
            after: {
              id: invRow.id,
              master_id: invRow.master_id,
              receiving_log_id: invRow.receiving_log_id,
            },
          },
          shift_date: row.shift_date,
          location_id,
          note: `receiving_match:${id}`,
        });

        const inventoryIdentity = localIdentityFields();
        appendOp({
          opId: inventoryIdentity.opId,
          tableName: 'inventory_updates',
          locationId: location_id,
          opKind: 'update',
          rowPk: String(existingCredit.id),
          rowJson: JSON.stringify(invRow),
          createdAt: inventoryIdentity.createdAt,
          sourceHost: inventoryIdentity.sourceHost,
          sourceStartedAt: inventoryIdentity.sourceStartedAt,
        });
      } else {
        const invInfo = db
          .prepare(
            `INSERT INTO inventory_updates
               (shift_date, location_id, item, master_id, delta, direction, note, cook_id, receiving_log_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            row.shift_date,
            location_id,
            row.item,
            masterId,
            `${row.received_qty} ${row.received_unit}`,
            'in',
            `manager matched receiving_log #${id}`,
            cookId,
            id,
          );
        invRow = db
          .prepare('SELECT * FROM inventory_updates WHERE id = ?')
          .get(invInfo.lastInsertRowid);

        postAuditEvent({
          entity: 'inventory_updates',
          entity_id: Number(invInfo.lastInsertRowid),
          action: 'insert',
          actor_cook_id: cookId,
          actor_source: 'receiving_match_resolution',
          payload: invRow,
          shift_date: row.shift_date,
          location_id,
          note: `receiving_match:${id}`,
        });

        const inventoryIdentity = localIdentityFields();
        appendOp({
          opId: inventoryIdentity.opId,
          tableName: 'inventory_updates',
          locationId: location_id,
          opKind: 'insert',
          rowPk: String(invInfo.lastInsertRowid),
          rowJson: JSON.stringify(invRow),
          createdAt: inventoryIdentity.createdAt,
          sourceHost: inventoryIdentity.sourceHost,
          sourceStartedAt: inventoryIdentity.sourceStartedAt,
        });
      }

      return { receiving: after, inventory_update: invRow };
    })();

    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error('PATCH /api/receiving/matches/[id] failed:', err);
    return Response.json(
      { error: 'Failed to resolve receiving match' },
      { status: 500 },
    );
  }
}
