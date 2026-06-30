// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID } from '../../../lib/location';
import { hasPinCookie, hasPinOrTempPin, pinRequiredForPic, requirePin } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import { parseCourseIdPatch } from '../../../lib/beoCourses';

export const dynamic = 'force-dynamic';

// Per-body gate (T2 of beo-pin-gate-fixes — closes the bug where a
// sous chef with a temp PIN could create a course but couldn't bind
// line items to it). An update_line that ONLY touches course_id
// accepts hasPinOrTempPin('beo.fire_at_edit'). Any other field —
// item_name, prices, prep_notes, etc. — keeps the master-only gate.
//
// The allowed-keys whitelist is the safety boundary: ANY data field
// outside this set forces the strict gate. New action shapes that want
// the relaxed gate must opt in by explicit listing here.
const COURSE_ONLY_ALLOWED_KEYS = new Set([
  'action', 'id', 'course_id', 'location', 'location_id', 'cook_id',
]);
function isCourseIdOnlyPatch(body) {
  if (!body || body.action !== 'update_line') return false;
  if (!('course_id' in body)) return false;
  for (const k of Object.keys(body)) {
    if (!COURSE_ONLY_ALLOWED_KEYS.has(k)) return false;
  }
  return true;
}

async function checkPostGate(req, body) {
  if (!pinRequiredForPic()) return null;
  const ok = isCourseIdOnlyPatch(body)
    ? await hasPinOrTempPin(req, 'beo.fire_at_edit')
    : await hasPinCookie(req);
  if (ok) return null;
  return Response.json({ error: 'PIN required' }, { status: 401 });
}

const MAX_TITLE = 200;
const MAX_TASK = 500;
const MAX_NOTES = 2000;

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// Prepared-statement cache for the GET handler, keyed by db instance.
// WeakMap survives `setDbPathForTest()` (which closes + nulls the cached
// connection) because each rebound test DB is a different instance and
// the old one is GC'd along with its cached statements.
const _getStatementCache = new WeakMap();
function _getBeoStatements(db) {
  let stmts = _getStatementCache.get(db);
  if (!stmts) {
    stmts = {
      events: db.prepare(
        `SELECT * FROM beo_events WHERE location_id = ? ORDER BY event_date DESC, id DESC`,
      ),
      tasks: db.prepare(
        `SELECT * FROM beo_prep_tasks WHERE location_id = ? ORDER BY event_id, sort_order, id`,
      ),
      // line_items has no location_id column, so we filter via a correlated
      // subquery on beo_events. That keeps a single stable SQL string with
      // one bound parameter regardless of event count, vs. building a
      // variable `WHERE event_id IN (?, ?, ...)` clause that would defeat
      // statement caching and could hit SQLite's host-parameter limit
      // (default 32766) at scale.
      lineItems: db.prepare(
        `SELECT * FROM beo_line_items
          WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
          ORDER BY event_id, sort_order, id`,
      ),
    };
    _getStatementCache.set(db, stmts);
  }
  return stmts;
}

export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  try {
    const u = new URL(req.url);
    const loc = u.searchParams.get('location') || DEFAULT_LOCATION_ID;
    const db = getDb();
    // Statements are prepared once per db instance and reused across requests.
    const stmts = _getBeoStatements(db);
    const events = stmts.events.all(loc);
    const tasks = stmts.tasks.all(loc);
    const lineItems = stmts.lineItems.all(loc);
    return Response.json({ location_id: loc, events, prep_tasks: tasks, line_items: lineItems });
  } catch (err) {
    console.error('GET /api/beo failed:', err);
    return Response.json({ error: 'Failed to load BEO' }, { status: 500 });
  }
}

export async function POST(req) {
  return withIdempotency(req, () => beoPostHandler(req));
}

async function beoPostHandler(req) {
  try {
    const body = await req.json();
    const gateFail = await checkPostGate(req, body);
    if (gateFail) return gateFail;
    const loc = body.location_id || DEFAULT_LOCATION_ID;
    const db = getDb();

    if (body.action === 'event') {
      const title = clip(body.title, MAX_TITLE);
      if (!title) return Response.json({ error: 'title required' }, { status: 400 });
      const gc = body.guest_count == null ? null : Number(body.guest_count);
      const taxRate = Number.isFinite(Number(body.tax_rate)) ? Number(body.tax_rate) : 0.0675;
      const serviceFeePct = Number.isFinite(Number(body.service_fee_pct)) ? Number(body.service_fee_pct) : 20;
      // Increment 2: optional F&B minimum spend ($). Empty/absent -> NULL;
      // negative is soft-rejected (the operator typed a bad value).
      let minSpend = null;
      if (body.min_spend != null && body.min_spend !== '') {
        const n = Number(body.min_spend);
        if (!Number.isFinite(n) || n < 0) {
          return Response.json({ error: 'min_spend must be a non-negative number' }, { status: 400 });
        }
        minSpend = n;
      }
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_events
               (title, event_date, event_time, contact_name, guest_count,
                notes, status, tax_rate, service_fee_pct, min_spend, location_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
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
            minSpend,
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
      // Title and status remain unconditional COALESCE keys — those are
      // the fields the UI explicitly edits, and the existing semantics
      // were already partial-patch friendly.
      const title = clip(body.title, MAX_TITLE);
      const status = clip(body.status, 32);
      // Every other column is a partial-patch field. If the request body
      // omits the key (or sends null/undefined), we pass SQL NULL so the
      // `col = COALESCE(?, col)` clause preserves the existing value.
      // For numeric columns we only coerce when the body actually carries
      // the field, so an omitted tax_rate doesn't reset to the default.
      const eventDate = 'event_date' in body ? clip(body.event_date, 32) : null;
      const eventTime = 'event_time' in body ? clip(body.event_time, 32) : null;
      const contactName = 'contact_name' in body ? clip(body.contact_name, 120) : null;
      const notes = 'notes' in body ? clip(body.notes, MAX_NOTES) : null;
      let guestCount = null;
      if ('guest_count' in body) {
        const raw = body.guest_count;
        if (raw === null || raw === '' || raw === undefined) {
          guestCount = null;
        } else {
          const n = Number(raw);
          guestCount = Number.isFinite(n) ? n : null;
        }
      }
      const taxRate = 'tax_rate' in body && Number.isFinite(Number(body.tax_rate))
        ? Number(body.tax_rate)
        : null;
      const serviceFeePct = 'service_fee_pct' in body && Number.isFinite(Number(body.service_fee_pct))
        ? Number(body.service_fee_pct)
        : null;
      // Increment 2: F&B minimum spend. Soft-reject negatives. Unlike the
      // COALESCE columns above, min_spend is explicitly clearable — an empty
      // value writes NULL — so it uses a provided-flag CASE: present -> set
      // (number or NULL), omitted -> preserve.
      const minSpendProvided = 'min_spend' in body ? 1 : 0;
      let minSpendValue = null;
      if (minSpendProvided) {
        const raw = body.min_spend;
        if (raw === null || raw === '' || raw === undefined) {
          minSpendValue = null;
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0) {
            return Response.json({ error: 'min_spend must be a non-negative number' }, { status: 400 });
          }
          minSpendValue = n;
        }
      }
      db.transaction(() => {
        db.prepare(
          `UPDATE beo_events SET
             title           = COALESCE(?, title),
             event_date      = COALESCE(?, event_date),
             event_time      = COALESCE(?, event_time),
             contact_name    = COALESCE(?, contact_name),
             guest_count     = COALESCE(?, guest_count),
             notes           = COALESCE(?, notes),
             status          = COALESCE(?, status),
             tax_rate        = COALESCE(?, tax_rate),
             service_fee_pct = COALESCE(?, service_fee_pct),
             min_spend       = CASE WHEN ? = 1 THEN ? ELSE min_spend END
           WHERE id = ? AND location_id = ?`,
        ).run(
          title,
          eventDate,
          eventTime,
          contactName,
          guestCount,
          notes,
          status,
          taxRate,
          serviceFeePct,
          minSpendProvided,
          minSpendValue,
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

      // course_id (T5): absent = no change, null = clear binding, integer = set.
      // parseCourseIdPatch throws on a malformed value (e.g. "abc"); convert
      // that to a 422 instead of letting it 500 inside the transaction.
      let coursePatch;
      try {
        coursePatch = parseCourseIdPatch(body);
      } catch (err) {
        return Response.json({ error: String(err.message || err) }, { status: 422 });
      }
      const courseTouch = coursePatch.kind !== 'absent' ? 1 : 0;
      const courseVal = coursePatch.kind === 'set' ? coursePatch.course_id : null;

      db.transaction(() => {
        // beo_line_items has no location_id of its own — it inherits
        // via event_id → beo_events.location_id. Scope the UPDATE so a
        // request from location A cannot mutate a line attached to an
        // event in location B (Bundle-H follow-up, T4).
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
             group_note            = CASE WHEN ? THEN ? ELSE group_note END,
             course_id             = CASE WHEN ? THEN ? ELSE course_id END
           WHERE id = ?
             AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(
          item_name, cost, qty, clip(body.category, 64),
          'prep_notes'           in body ? 1 : 0, prep.val,
          'secondary_prep_notes' in body ? 1 : 0, sec.val,
          'order_items_notes'    in body ? 1 : 0, ord.val,
          'order_time'           in body ? 1 : 0, time.val,
          'group_note'           in body ? 1 : 0, grp.val,
          courseTouch, courseVal,
          id,
          loc,
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
        // Scope by parent event's location_id; see update_line above
        // for the rationale (Bundle-H follow-up, T4).
        db.prepare(
          `DELETE FROM beo_line_items
             WHERE id = ?
               AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(id, loc);
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
      // Both beo_line_items.event_id and beo_prep_tasks.event_id declare
      // ON DELETE CASCADE against beo_events(id), and PRAGMA foreign_keys
      // is ON for every connection (lib/db.ts::getDb), so the single
      // DELETE on beo_events sweeps both child tables atomically.
      db.transaction(() => {
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
