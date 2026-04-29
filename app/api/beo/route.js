import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';

export const dynamic = 'force-dynamic';

const MAX_TITLE = 200;
const MAX_TASK = 500;
const MAX_NOTES = 2000;

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

export async function GET(req) {
  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const db = getDb();
    const events = db.prepare(`SELECT * FROM beo_events WHERE location_id = ? ORDER BY event_date DESC, id DESC`).all(loc);
    const tasks = db.prepare(`SELECT * FROM beo_prep_tasks WHERE location_id = ? ORDER BY event_id, sort_order, id`).all(loc);
    // line_items has no location_id column, so the previous code built
    // `WHERE event_id IN (?, ?, ...)` with one bound parameter per event.
    // That hits SQLite's compile-time host-parameter limit (default 32766)
    // at scale and changes the SQL string on every call, defeating
    // prepared-statement reuse. The correlated subquery form keeps a
    // single stable SQL string with one bound parameter regardless of
    // event count.
    const lineItems = db.prepare(
      `SELECT * FROM beo_line_items
        WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
        ORDER BY event_id, sort_order, id`,
    ).all(loc);
    return Response.json({ location_id: loc, events, prep_tasks: tasks, line_items: lineItems });
  } catch (err) {
    console.error('GET /api/beo failed:', err);
    return Response.json({ error: 'Failed to load BEO' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const loc = body.location_id || DEFAULT_LOCATION_ID;
    const db = getDb();

    if (body.action === 'event') {
      const title = clip(body.title, MAX_TITLE);
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const gc = body.guest_count == null ? null : Number(body.guest_count);
      const taxRate = Number.isFinite(Number(body.tax_rate)) ? Number(body.tax_rate) : 0.0675;
      const serviceFeePct = Number.isFinite(Number(body.service_fee_pct)) ? Number(body.service_fee_pct) : 20;
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_events
               (title, event_date, event_time, contact_name, guest_count,
                notes, status, tax_rate, service_fee_pct, location_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            title,
            clip(body.event_date, 32) || todayISO(),
            clip(body.event_time, 32),
            clip(body.contact_name, 120),
            Number.isFinite(gc) ? gc : null,
            clip(body.notes, MAX_NOTES),
            clip(body.status, 32) || 'planned',
            taxRate,
            serviceFeePct,
            loc,
          );
        const newId = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'beo_events', entity_id: newId, action: 'insert',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { title, tax_rate: taxRate, service_fee_pct: serviceFeePct },
        });
        return newId;
      })();
      return Response.json({ ok: true, id });
    }

    if (body.action === 'update_event') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      const title = clip(body.title, MAX_TITLE);
      const gc = body.guest_count == null || body.guest_count === ''
        ? null
        : Number(body.guest_count);
      const taxRate = Number.isFinite(Number(body.tax_rate)) ? Number(body.tax_rate) : 0.0675;
      const serviceFeePct = Number.isFinite(Number(body.service_fee_pct)) ? Number(body.service_fee_pct) : 20;
      db.transaction(() => {
        db.prepare(
          `UPDATE beo_events SET
             title = COALESCE(?, title),
             event_date = ?,
             event_time = ?,
             contact_name = ?,
             guest_count = ?,
             notes = ?,
             status = COALESCE(?, status),
             tax_rate = ?,
             service_fee_pct = ?
           WHERE id = ? AND location_id = ?`,
        ).run(
          title,
          clip(body.event_date, 32),
          clip(body.event_time, 32),
          clip(body.contact_name, 120),
          Number.isFinite(gc) ? gc : null,
          clip(body.notes, MAX_NOTES),
          clip(body.status, 32),
          taxRate,
          serviceFeePct,
          id,
          loc,
        );
        postAuditEvent({
          entity: 'beo_events', entity_id: id, action: 'update',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { title, tax_rate: taxRate, service_fee_pct: serviceFeePct },
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'line') {
      const event_id = Number(body.event_id);
      const item_name = clip(body.item_name, MAX_TITLE);
      if (!Number.isInteger(event_id) || !item_name) {
        return Response.json({ error: 'event_id and item_name required' }, { status: 400 });
      }
      const cost = Number.isFinite(Number(body.unit_cost)) ? Number(body.unit_cost) : 0;
      const qty = Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : 1;
      const newId = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_line_items
               (event_id, sort_order, item_name, category, unit_cost, quantity,
                prep_notes, secondary_prep_notes, order_items_notes, order_time, group_note)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            event_id,
            Number(body.sort_order) || 0,
            item_name,
            clip(body.category, 64),
            cost,
            qty,
            clip(body.prep_notes, MAX_NOTES),
            clip(body.secondary_prep_notes, MAX_NOTES),
            clip(body.order_items_notes, MAX_NOTES),
            clip(body.order_time, 32),
            clip(body.group_note, MAX_NOTES),
          );
        const lineId = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'beo_line_items', entity_id: lineId, action: 'insert',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { item_name, unit_cost: cost, quantity: qty, event_id },
        });
        return lineId;
      })();
      return Response.json({ ok: true, id: newId });
    }

    if (body.action === 'update_line') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      const item_name = clip(body.item_name, MAX_TITLE);
      const cost = Number.isFinite(Number(body.unit_cost)) ? Number(body.unit_cost) : null;
      const qty = Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : null;
      // Prep-sheet text fields: '' means "clear", undefined means "don't touch".
      const textPatch = (key, max) => {
        if (!(key in body)) return { sql: null, val: null };
        const v = clip(body[key], max);
        return { sql: v, val: v };
      };
      const prep = textPatch('prep_notes', MAX_NOTES);
      const sec  = textPatch('secondary_prep_notes', MAX_NOTES);
      const ord  = textPatch('order_items_notes', MAX_NOTES);
      const time = textPatch('order_time', 32);
      const grp  = textPatch('group_note', MAX_NOTES);
      db.transaction(() => {
        db.prepare(
          `UPDATE beo_line_items SET
             item_name             = COALESCE(?, item_name),
             unit_cost             = COALESCE(?, unit_cost),
             quantity              = COALESCE(?, quantity),
             category              = COALESCE(?, category),
             prep_notes            = CASE WHEN ? THEN ? ELSE prep_notes END,
             secondary_prep_notes  = CASE WHEN ? THEN ? ELSE secondary_prep_notes END,
             order_items_notes     = CASE WHEN ? THEN ? ELSE order_items_notes END,
             order_time            = CASE WHEN ? THEN ? ELSE order_time END,
             group_note            = CASE WHEN ? THEN ? ELSE group_note END
           WHERE id = ?`,
        ).run(
          item_name, cost, qty, clip(body.category, 64),
          'prep_notes'           in body ? 1 : 0, prep.val,
          'secondary_prep_notes' in body ? 1 : 0, sec.val,
          'order_items_notes'    in body ? 1 : 0, ord.val,
          'order_time'           in body ? 1 : 0, time.val,
          'group_note'           in body ? 1 : 0, grp.val,
          id,
        );
        postAuditEvent({
          entity: 'beo_line_items', entity_id: id, action: 'update',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { item_name, unit_cost: cost, quantity: qty },
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'delete_line') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.transaction(() => {
        db.prepare(`DELETE FROM beo_line_items WHERE id = ?`).run(id);
        postAuditEvent({
          entity: 'beo_line_items', entity_id: id, action: 'delete',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc,
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'prep') {
      const event_id = Number(body.event_id);
      const task = clip(body.task, MAX_TASK);
      if (!Number.isInteger(event_id) || !task) {
        return Response.json({ error: 'event_id and task required' }, { status: 400 });
      }
      const newId = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, sort_order, location_id) VALUES (?,?,?,?,?,?)`
          )
          .run(event_id, task, clip(body.due_date, 32), 0, Number(body.sort_order) || 0, loc);
        const id = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'beo_prep_tasks', entity_id: id, action: 'insert',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { event_id, task },
        });
        return id;
      })();
      return Response.json({ ok: true, id: newId });
    }

    if (body.action === 'prep_done') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.transaction(() => {
        db.prepare(`UPDATE beo_prep_tasks SET done = ? WHERE id = ?`).run(body.done ? 1 : 0, id);
        postAuditEvent({
          entity: 'beo_prep_tasks', entity_id: id, action: 'update',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { done: body.done ? 1 : 0 },
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'delete_event') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      // beo_prep_tasks has no ON DELETE CASCADE (legacy schema), so delete
      // manually. beo_line_items DOES cascade via FK. Wrap in a transaction
      // so we can't end up with an event whose prep_tasks survived a crash.
      db.transaction(() => {
        db.prepare(`DELETE FROM beo_prep_tasks WHERE event_id = ?`).run(id);
        db.prepare(`DELETE FROM beo_events WHERE id = ?`).run(id);
        postAuditEvent({
          entity: 'beo_events', entity_id: id, action: 'delete',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc,
        });
      })();
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/beo failed:', err);
    return Response.json({ error: 'Failed to save BEO change' }, { status: 500 });
  }
}
