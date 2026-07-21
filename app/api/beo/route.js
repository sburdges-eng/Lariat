// @ts-check
// Migrated off the pre-#250 @ts-nocheck baseline (GH #250): JSDoc types
// only, no behavior change.
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
/** @param {Record<string, unknown> | null | undefined} body */
function isCourseIdOnlyPatch(body) {
  if (!body || body.action !== 'update_line') return false;
  if (!('course_id' in body)) return false;
  for (const k of Object.keys(body)) {
    if (!COURSE_ONLY_ALLOWED_KEYS.has(k)) return false;
  }
  return true;
}

/**
 * @param {Request} req
 * @param {Record<string, unknown> | null | undefined} body
 */
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

/** @param {unknown} s @param {number} max @returns {string | null} */
const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// Event-model wave (docs/superpowers/specs/2026-07-21-beo-event-model-design.md):
// enum values are route-validated — house style keeps CHECK constraints out of
// the DDL (status/category precedent).
const SERVICE_STYLES = new Set(['passed', 'buffet', 'plated']);
const BAR_MODES = new Set(['fill', 'fixed']);
const CHARGE_KINDS = new Set(['av', 'fee']);

/** @param {unknown} v */
const isBlank = (v) => v === null || v === undefined || v === '';

/**
 * Resolve the six event-model planning fields (space, service_style,
 * service_hours, bar_mode, bar_amount, bar_notes) from a request body.
 * Shared by `event` (create) and `update_event` (partial patch). Per field:
 * `provided` mirrors `'key' in body` so update_event's provided-flag CASE
 * can distinguish "set/clear" from "preserve"; `value` is the validated
 * write value — null/'' clears (min_spend precedent). Returns `{ error }`
 * instead on a bad enum or numeric value so callers 400 before touching
 * the transaction.
 * @param {Record<string, any>} body
 * @returns {{ error: string, fields?: undefined } | { error?: undefined, fields: {
 *   space: { provided: number, value: string | null },
 *   serviceStyle: { provided: number, value: string | null },
 *   serviceHours: { provided: number, value: number | null },
 *   barMode: { provided: number, value: string | null },
 *   barAmount: { provided: number, value: number | null },
 *   barNotes: { provided: number, value: string | null },
 * } }}
 */
function resolveEventModelFields(body) {
  const space = { provided: 'space' in body ? 1 : 0, value: clip(body.space, 120) };
  const barNotes = { provided: 'bar_notes' in body ? 1 : 0, value: clip(body.bar_notes, 500) };

  const serviceStyle = { provided: 'service_style' in body ? 1 : 0, value: /** @type {string | null} */ (null) };
  if (serviceStyle.provided && !isBlank(body.service_style)) {
    const v = String(body.service_style).trim();
    if (!SERVICE_STYLES.has(v)) return { error: "service_style must be 'passed', 'buffet', or 'plated'" };
    serviceStyle.value = v;
  }

  const barMode = { provided: 'bar_mode' in body ? 1 : 0, value: /** @type {string | null} */ (null) };
  if (barMode.provided && !isBlank(body.bar_mode)) {
    const v = String(body.bar_mode).trim();
    if (!BAR_MODES.has(v)) return { error: "bar_mode must be 'fill' or 'fixed'" };
    barMode.value = v;
  }

  const serviceHours = { provided: 'service_hours' in body ? 1 : 0, value: /** @type {number | null} */ (null) };
  if (serviceHours.provided && !isBlank(body.service_hours)) {
    const n = Number(body.service_hours);
    if (!Number.isFinite(n) || n <= 0) return { error: 'service_hours must be a positive number' };
    serviceHours.value = n;
  }

  const barAmount = { provided: 'bar_amount' in body ? 1 : 0, value: /** @type {number | null} */ (null) };
  if (barAmount.provided && !isBlank(body.bar_amount)) {
    const n = Number(body.bar_amount);
    if (!Number.isFinite(n) || n < 0) return { error: 'bar_amount must be a non-negative number' };
    barAmount.value = n;
  }

  return { fields: { space, serviceStyle, serviceHours, barMode, barAmount, barNotes } };
}

// Prepared-statement cache for the GET handler, keyed by db instance.
// WeakMap survives `setDbPathForTest()` (which closes + nulls the cached
// connection) because each rebound test DB is a different instance and
// the old one is GC'd along with its cached statements.
const _getStatementCache = new WeakMap();
/** @param {ReturnType<typeof getDb>} db */
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
      // Event-model wave: same correlated-subquery location scoping as
      // lineItems (neither child table carries location_id of its own).
      charges: db.prepare(
        `SELECT * FROM beo_event_charges
          WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
          ORDER BY event_id, sort_order, id`,
      ),
      runOfShow: db.prepare(
        `SELECT * FROM beo_run_of_show
          WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
          ORDER BY event_id, sort_order, id`,
      ),
    };
    _getStatementCache.set(db, stmts);
  }
  return stmts;
}

/** @param {Request} req */
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
    const charges = stmts.charges.all(loc);
    const runOfShow = stmts.runOfShow.all(loc);
    return Response.json({
      location_id: loc, events, prep_tasks: tasks, line_items: lineItems,
      charges, run_of_show: runOfShow,
    });
  } catch (err) {
    console.error('GET /api/beo failed:', err);
    return Response.json({ error: 'Failed to load BEO' }, { status: 500 });
  }
}

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => beoPostHandler(req));
}

/** @param {Request} req */
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
      // Event-model wave: six planning fields (validated; absent → NULL).
      const em = resolveEventModelFields(body);
      if (em.error !== undefined) return Response.json({ error: em.error }, { status: 400 });
      const emf = em.fields;
      const id = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_events
               (title, event_date, event_time, contact_name, guest_count,
                notes, status, tax_rate, service_fee_pct, min_spend,
                space, service_style, service_hours, bar_mode, bar_amount, bar_notes,
                location_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
            emf.space.value,
            emf.serviceStyle.value,
            emf.serviceHours.value,
            emf.barMode.value,
            emf.barAmount.value,
            emf.barNotes.value,
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
      // Event-model wave: partial-patch the six planning fields with the
      // same provided-flag CASE pattern as min_spend — present sets
      // (including explicit NULL/'' to clear), omitted preserves. Bad
      // enum/numeric values 400 here, before the transaction.
      const em = resolveEventModelFields(body);
      if (em.error !== undefined) return Response.json({ error: em.error }, { status: 400 });
      const emf = em.fields;
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
             min_spend       = CASE WHEN ? = 1 THEN ? ELSE min_spend END,
             space           = CASE WHEN ? = 1 THEN ? ELSE space END,
             service_style   = CASE WHEN ? = 1 THEN ? ELSE service_style END,
             service_hours   = CASE WHEN ? = 1 THEN ? ELSE service_hours END,
             bar_mode        = CASE WHEN ? = 1 THEN ? ELSE bar_mode END,
             bar_amount      = CASE WHEN ? = 1 THEN ? ELSE bar_amount END,
             bar_notes       = CASE WHEN ? = 1 THEN ? ELSE bar_notes END
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
          emf.space.provided, emf.space.value,
          emf.serviceStyle.provided, emf.serviceStyle.value,
          emf.serviceHours.provided, emf.serviceHours.value,
          emf.barMode.provided, emf.barMode.value,
          emf.barAmount.provided, emf.barAmount.value,
          emf.barNotes.provided, emf.barNotes.value,
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
      // Parent-event location guard (event-model wave follow-up): update_line
      // and delete_line were scoped via the parent event (Bundle-H T4), but
      // the insert wasn't — a request scoped to location A could attach a
      // line to location B's event. Same up-front 404 as the charge/soe
      // inserts.
      const parentEvent = db
        .prepare(`SELECT id FROM beo_events WHERE id = ? AND location_id = ?`)
        .get(event_id, loc);
      if (!parentEvent) return Response.json({ error: 'event not found' }, { status: 404 });
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
      /** @param {string} key @param {number} max */
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
        const e = /** @type {{ message?: unknown } | null} */ (err);
        return Response.json({ error: String(e?.message || err) }, { status: 422 });
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

    // ── Event-model wave: AV/production + additional-fee charges ──────
    // (docs/superpowers/specs/2026-07-21-beo-event-model-design.md — the
    // charge-vs-cost split is deliberate: charge bills the client, cost is
    // the house's spend, and folding these into beo_line_items would lose it.)

    if (body.action === 'charge') {
      const event_id = Number(body.event_id);
      const item_name = clip(body.item_name, MAX_TITLE);
      if (!Number.isInteger(event_id) || !item_name) {
        return Response.json({ error: 'event_id and item_name required' }, { status: 400 });
      }
      const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
      if (!CHARGE_KINDS.has(kind)) {
        return Response.json({ error: "kind must be 'av' or 'fee'" }, { status: 400 });
      }
      const charge = Number.isFinite(Number(body.charge)) ? Number(body.charge) : 0;
      const cost = Number.isFinite(Number(body.cost)) ? Number(body.cost) : 0;
      if (charge < 0 || cost < 0) {
        return Response.json({ error: 'charge and cost must be non-negative' }, { status: 400 });
      }
      // Inserts verify the parent event's location up front — a request
      // scoped to location A cannot attach rows to location B's event.
      const parent = db
        .prepare(`SELECT id FROM beo_events WHERE id = ? AND location_id = ?`)
        .get(event_id, loc);
      if (!parent) return Response.json({ error: 'event not found' }, { status: 404 });
      const newId = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_event_charges (event_id, kind, item_name, charge, cost, sort_order)
             VALUES (?,?,?,?,?,?)`,
          )
          .run(event_id, kind, item_name, charge, cost, Number(body.sort_order) || 0);
        const id = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'beo_event_charges', entity_id: id, action: 'insert',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { event_id, kind, item_name, charge, cost },
        });
        return id;
      })();
      return Response.json({ ok: true, id: newId });
    }

    if (body.action === 'update_charge') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      const item_name = clip(body.item_name, MAX_TITLE);
      // charge/cost patch only on a valid number; negatives 400 before the
      // transaction. kind is immutable (delete + re-add to reclassify).
      let charge = null;
      if ('charge' in body && !isBlank(body.charge)) {
        const n = Number(body.charge);
        if (!Number.isFinite(n) || n < 0) {
          return Response.json({ error: 'charge must be a non-negative number' }, { status: 400 });
        }
        charge = n;
      }
      let cost = null;
      if ('cost' in body && !isBlank(body.cost)) {
        const n = Number(body.cost);
        if (!Number.isFinite(n) || n < 0) {
          return Response.json({ error: 'cost must be a non-negative number' }, { status: 400 });
        }
        cost = n;
      }
      db.transaction(() => {
        // Scoped through the parent event's location (update_line precedent).
        db.prepare(
          `UPDATE beo_event_charges SET
             item_name = COALESCE(?, item_name),
             charge    = COALESCE(?, charge),
             cost      = COALESCE(?, cost)
           WHERE id = ?
             AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(item_name, charge, cost, id, loc);
        postAuditEvent({
          entity: 'beo_event_charges', entity_id: id, action: 'update',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { item_name, charge, cost },
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'delete_charge') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.transaction(() => {
        db.prepare(
          `DELETE FROM beo_event_charges
             WHERE id = ?
               AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(id, loc);
        postAuditEvent({
          entity: 'beo_event_charges', entity_id: id, action: 'delete',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc,
        });
      })();
      return Response.json({ ok: true });
    }

    // ── Event-model wave: run of show ─────────────────────────────────

    if (body.action === 'soe') {
      const event_id = Number(body.event_id);
      const note = clip(body.note, MAX_TASK);
      if (!Number.isInteger(event_id) || !note) {
        return Response.json({ error: 'event_id and note required' }, { status: 400 });
      }
      const parent = db
        .prepare(`SELECT id FROM beo_events WHERE id = ? AND location_id = ?`)
        .get(event_id, loc);
      if (!parent) return Response.json({ error: 'event not found' }, { status: 404 });
      const newId = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO beo_run_of_show (event_id, show_time, note, sort_order)
             VALUES (?,?,?,?)`,
          )
          .run(event_id, clip(body.show_time, 32), note, Number(body.sort_order) || 0);
        const id = Number(info.lastInsertRowid);
        postAuditEvent({
          entity: 'beo_run_of_show', entity_id: id, action: 'insert',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { event_id, note },
        });
        return id;
      })();
      return Response.json({ ok: true, id: newId });
    }

    if (body.action === 'update_soe') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      const note = clip(body.note, MAX_TASK);
      // show_time is clearable (provided-flag CASE); note is COALESCE-only —
      // a run-of-show row without a note is meaningless, so blank preserves.
      const showTouch = 'show_time' in body ? 1 : 0;
      const showVal = clip(body.show_time, 32);
      db.transaction(() => {
        db.prepare(
          `UPDATE beo_run_of_show SET
             note      = COALESCE(?, note),
             show_time = CASE WHEN ? = 1 THEN ? ELSE show_time END
           WHERE id = ?
             AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(note, showTouch, showVal, id, loc);
        postAuditEvent({
          entity: 'beo_run_of_show', entity_id: id, action: 'update',
          actor_cook_id: clip(body.cook_id, 64), actor_source: 'api',
          location_id: loc, payload: { note },
        });
      })();
      return Response.json({ ok: true });
    }

    if (body.action === 'delete_soe') {
      const id = Number(body.id);
      if (!Number.isInteger(id)) return Response.json({ error: 'id required' }, { status: 400 });
      db.transaction(() => {
        db.prepare(
          `DELETE FROM beo_run_of_show
             WHERE id = ?
               AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`,
        ).run(id, loc);
        postAuditEvent({
          entity: 'beo_run_of_show', entity_id: id, action: 'delete',
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
        db.prepare(`UPDATE beo_prep_tasks SET done = ? WHERE id = ? AND location_id = ?`).run(body.done ? 1 : 0, id, loc);
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
      // Every BEO child table (beo_line_items, beo_prep_tasks,
      // beo_event_charges, beo_run_of_show) declares ON DELETE CASCADE
      // against beo_events(id), and PRAGMA foreign_keys is ON for every
      // connection (lib/db.ts::getDb), so the single DELETE on beo_events
      // sweeps the children atomically.
      db.transaction(() => {
        db.prepare(`DELETE FROM beo_events WHERE id = ? AND location_id = ?`).run(id, loc);
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
