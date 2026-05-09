// Receiving log (F3 / FDA §3-202.11, §3-202.15, §3-101.11).
//
// POST /api/receiving   → record one delivery line; 422 if the rule
//                         module flags it as rejected or accept-with-note
//                         without a corrective note.
// GET  /api/receiving   → today's entries grouped by vendor + category
//                         with a per-category summary for the board.
//
// The rule module in lib/receiving.ts owns every threshold decision.
// This route is persistence + audit + UI-shape only.

import { getDb, todayISO } from '../../../lib/db';
import {
  DEFAULT_LOCATION_ID,
  locationFromBody,
  locationFromRequest,
} from '../../../lib/location';
import {
  RECEIVING_CATEGORIES,
  RECEIVING_RULES,
  classifyDeliveries,
  dbStatusFor,
  getReceivingRule,
  validateReceivingReading,
} from '../../../lib/receiving';
import { postAuditEvent } from '../../../lib/auditEvents';
import { triggerComputeEngine } from '../../../lib/computeEngine/index';
import { withIdempotency } from '../../../lib/idempotency';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

// YYYY-MM-DD — cheap parse check; the rule module only lex-compares
// so format correctness is all we need to assert here.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── POST /api/receiving ──────────────────────────────────────────

export async function POST(req) {
  return withIdempotency(req, () => receivingHandler(req));
}

async function receivingHandler(req) {
  try {
    const body = await req.json();

    const vendor = clip(body.vendor, 120);
    if (!vendor) {
      return Response.json({ error: 'vendor is required' }, { status: 400 });
    }

    const category = clip(body.category, 64);
    const rule = getReceivingRule(category);
    if (!rule) {
      return Response.json(
        {
          error: `unknown category — must be one of: ${RECEIVING_CATEGORIES.join(', ')}`,
          categories: RECEIVING_CATEGORIES,
        },
        { status: 400 },
      );
    }

    const invoice_ref = clip(body.invoice_ref ?? body.invoice_no, 120);
    const item = clip(body.item, 200);
    const shellstock_tag_ref = clip(body.shellstock_tag_ref, 120);
    const cook_id = clip(body.cook_id, 64);
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const location_id = locationFromBody(body);

    const expiration_date = clip(body.expiration_date, 32);
    if (expiration_date && !ISO_DATE.test(expiration_date)) {
      return Response.json(
        { error: 'expiration_date must be YYYY-MM-DD' },
        { status: 400 },
      );
    }

    // package_ok defaults to true — if the cook doesn't explicitly
    // flag a bad package, we assume intact. Rejecting on "unknown"
    // would cripple dry-goods entry where the checkbox is noise.
    const packageOkRaw = body.package_ok;
    let package_ok;
    if (packageOkRaw === false || packageOkRaw === 0 || packageOkRaw === 'false' || packageOkRaw === '0') {
      package_ok = false;
    } else {
      package_ok = true;
    }

    // reading_f is optional for dry/produce; required for temp
    // categories. The rule module does the actual branching — here we
    // just coerce.
    let reading_f = null;
    if (body.reading_f !== undefined && body.reading_f !== null && body.reading_f !== '') {
      const n = Number(body.reading_f);
      if (!Number.isFinite(n)) {
        return Response.json(
          { error: 'reading_f must be a number in °F or omitted' },
          { status: 400 },
        );
      }
      reading_f = n;
    }

    // Phase 3 closed-loop receiving — optional inventory crediting on
    // accepted lines. Coerce only; the rule-module validator (extended
    // by checkClosedLoopFields) does range/type checks so the live UI
    // and the API land on identical messages. Missing/blank → null →
    // closed loop is silently skipped on this row.
    let received_qty = null;
    if (body.received_qty !== undefined && body.received_qty !== null && body.received_qty !== '') {
      const n = Number(body.received_qty);
      if (!Number.isFinite(n)) {
        return Response.json(
          { error: 'received_qty must be a number or omitted' },
          { status: 400 },
        );
      }
      received_qty = n;
    }
    const received_unit = clip(body.received_unit, 32);

    // Reject (not silently truncate) over-long corrective actions.
    if (
      typeof body.corrective_action === 'string' &&
      body.corrective_action.length > 500
    ) {
      return Response.json(
        {
          error: 'corrective action too long (max 500 chars)',
          length: body.corrective_action.length,
        },
        { status: 400 },
      );
    }
    const corrective_action =
      typeof body.corrective_action === 'string'
        ? body.corrective_action.trim().slice(0, 500) || null
        : null;

    const decision = validateReceivingReading({
      category,
      reading_f,
      package_ok,
      expiration_date,
      received_at: shift_date,
      received_qty,
      received_unit,
    });

    // HACCP outright rejections take priority over input-shape errors.
    // If package_ok / temp / sell-by says "refuse this delivery", the
    // goods aren't entering the building — a malformed qty doesn't
    // change that, and 400ing on the qty would mask the real reason
    // the line failed (the cook would fix the qty, retry, and still
    // get a 422). The 'accept_with_note' branch stays AFTER the
    // closed_loop_error gate below: that path actually persists the
    // row and credits inventory, so a bad qty there has to block.
    if (decision.status === 'rejected' && !corrective_action) {
      // A rejection is an outright refusal — the goods are not coming
      // inside. Surface a wire-distinct flag from the drift-band
      // "add a fix note to accept" case (`needs_corrective_action`).
      // The cook still needs to record WHY the delivery was refused
      // (invoice credit, vendor callback) — that's a rejection note,
      // not a corrective fix.
      return Response.json(
        {
          error: decision.reason,
          status: decision.status,
          citation: decision.citation,
          needs_rejection_note: true,
        },
        { status: 422 },
      );
    }

    // Phase 3 closed-loop receiving — input-shape errors on the new
    // qty/unit fields surface as 400 (caller fix), NOT 422 (which is
    // reserved for "HACCP says you need a corrective note"). The
    // route refuses the whole write rather than writing the receiving
    // row and silently dropping the inventory crediting.
    // Skip for rejected-with-note: no inventory credit happens on a
    // rejection, so a malformed qty/unit is irrelevant — blocking the
    // rejection write would mask the real HACCP outcome and force the
    // cook to fix an unused field before the rejection can be logged.
    if (decision.closed_loop_error && decision.status !== 'rejected') {
      return Response.json(
        { error: decision.closed_loop_error, field: 'received_qty/received_unit' },
        { status: 400 },
      );
    }

    // Both 'rejected' (with corrective note) and 'accept_with_note'
    // need a corrective / rejection note. 'rejected' because the
    // audit chain needs to record WHY the delivery was refused
    // (invoice credit, vendor callback); 'accept_with_note' because
    // that is the whole point of the drift band — documented fix or
    // nothing. The note-less 'rejected' branch already returned above;
    // this gate now only fires on note-less 'accept_with_note'.
    if (decision.status !== 'ok' && !corrective_action) {
      return Response.json(
        {
          error: decision.reason,
          status: decision.status,
          citation: decision.citation,
          needs_corrective_action: true,
        },
        { status: 422 },
      );
    }

    const dbStatus = dbStatusFor(decision.status);

    const db = getDb();
    
    // Phase 3 closed-loop receiving — credit inventory only when
    // ALL of:
    //   1. status lands at 'accepted' or 'accepted_with_note'
    //      (rejected deliveries don't move on-hand — the product is
    //      not in the building)
    //   2. received_qty is present and positive (validator already
    //      enforced > 0 above; we re-test here as a tripwire so a
    //      future validator change can't silently break the gate)
    //   3. received_unit is a non-empty trimmed string
    //   4. item is present (without an item we'd be debiting "" —
    //      meaningless for inventory reconciliation)
    // Missing any one → graceful skip. The receiving row still lands.
    const shouldCreditInventory =
      (dbStatus === 'accepted' || dbStatus === 'accepted_with_note') &&
      typeof received_qty === 'number' &&
      received_qty > 0 &&
      typeof received_unit === 'string' &&
      received_unit.length > 0 &&
      typeof item === 'string' &&
      item.length > 0;

    const performWrite = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO receiving_log
             (shift_date, location_id, vendor, invoice_ref, category, item,
              reading_f, required_max_f, package_ok, expiration_date,
              received_qty, received_unit,
              status, rejection_reason, shellstock_tag_ref, cook_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          shift_date,
          location_id,
          vendor,
          invoice_ref,
          category,
          item,
          reading_f,
          decision.required_max_f,
          package_ok ? 1 : 0,
          expiration_date,
          received_qty,
          received_unit,
          dbStatus,
          corrective_action,
          shellstock_tag_ref,
          cook_id
        );

      const row = db
        .prepare('SELECT * FROM receiving_log WHERE id = ?')
        .get(info.lastInsertRowid);

      postAuditEvent({
        entity: 'receiving_log',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: cook_id,
        actor_source: 'cook_ui',
        payload: row,
        shift_date,
        location_id,
        note: decision.status === 'ok' ? null : `${decision.status}:${category}`,
      });

      // Phase 3 closed-loop receiving — credit inventory in the SAME
      // transaction as the receiving row. If this INSERT or its
      // companion audit row fails (e.g. table missing on a partial
      // deploy), the receiving_log row rolls back too. That's
      // intentional: a half-applied write would create exactly the
      // ghost-delivery + drifted-on-hand state this feature exists
      // to eliminate. The caller sees a 500.
      if (shouldCreditInventory) {
        // receiving_log_id stamps the source row so the partial UNIQUE
        // index in lib/db.ts (idx_inventory_updates_receiving_log_id)
        // can enforce at-most-once crediting per receiving_log row.
        // A second insert against the same source id raises a SQLITE
        // UNIQUE constraint, which propagates out of this transaction
        // and rolls back the receiving_log row + its audit too —
        // exactly the "no half-applied close" posture this feature
        // exists to enforce.
        const invInfo = db
          .prepare(
            `INSERT INTO inventory_updates
               (shift_date, location_id, item, delta, direction, note, cook_id, receiving_log_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            shift_date,
            location_id,
            item,
            `${received_qty} ${received_unit}`,
            'in',
            `closed-loop receiving from receiving_log #${info.lastInsertRowid}`,
            cook_id,
            Number(info.lastInsertRowid),
          );

        const invRow = db
          .prepare('SELECT * FROM inventory_updates WHERE id = ?')
          .get(invInfo.lastInsertRowid);

        postAuditEvent({
          entity: 'inventory_updates',
          entity_id: Number(invInfo.lastInsertRowid),
          action: 'insert',
          actor_cook_id: cook_id,
          actor_source: 'receiving_closed_loop',
          payload: invRow,
          shift_date,
          location_id,
          note: `receiving_log:${info.lastInsertRowid}`,
        });
      }

      return { info, row };
    });

    const { info, row } = performWrite();

    // Fire-and-forget: schedule the real-time cost + margin + variance
    // refresh on the next tick via `setImmediate` so the response can
    // flush before the (synchronous) better-sqlite3 work starts. A
    // microtask-chained `Promise.resolve().then(...)` would run BEFORE
    // the response flushes and defeat the deferral (Node schedules
    // microtasks before returning control to the I/O phase). Static
    // import so a transpile/resolver failure is caught at module load,
    // not silently swallowed.  See docs/PATTERNS.md §9.
    setImmediate(() => {
      try {
        triggerComputeEngine(location_id);
      } catch (err) {
        console.error('Compute Engine Trigger Error from receiving_log:', err);
      }
    });

    return Response.json({
      ok: true,
      id: info.lastInsertRowid,
      decision: {
        status: decision.status,
        reason: decision.reason,
        citation: decision.citation,
        required_max_f: decision.required_max_f,
      },
      entry: row,
    });
  } catch (err) {
    console.error('POST /api/receiving failed:', err);
    return Response.json(
      { error: 'Failed to save receiving entry' },
      { status: 500 },
    );
  }
}

// ── GET /api/receiving ───────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM receiving_log
           WHERE location_id = ? AND shift_date = ?
           ORDER BY created_at DESC, id DESC`,
      )
      .all(location_id, date);

    // Per-category roll-up for the board tiles.
    const wantSummary = url.searchParams.get('summary') !== '0';
    const summary = wantSummary
      ? classifyDeliveries(rows, { expectAllCategories: true })
      : null;

    // Group by vendor → list of lines, so the UI can render one card
    // per delivery without an extra client-side pass.
    const byVendor = new Map();
    for (const r of rows) {
      const v = r.vendor || '—';
      const list = byVendor.get(v) ?? [];
      list.push(r);
      byVendor.set(v, list);
    }
    const vendors = Array.from(byVendor.entries())
      .map(([vendor, entries]) => ({
        vendor,
        entries,
        counts: {
          accepted: entries.filter((e) => e.status === 'accepted').length,
          rejected: entries.filter((e) => e.status === 'rejected').length,
          accepted_with_note: entries.filter(
            (e) => e.status === 'accepted_with_note',
          ).length,
        },
      }))
      .sort((a, b) => (a.vendor < b.vendor ? -1 : 1));

    const totals = {
      accepted: rows.filter((r) => r.status === 'accepted').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      accepted_with_note: rows.filter((r) => r.status === 'accepted_with_note')
        .length,
    };

    return Response.json({
      date,
      location_id,
      entries: rows,
      vendors,
      totals,
      summary,
      categories: RECEIVING_CATEGORIES,
      rules: RECEIVING_RULES,
    });
  } catch (err) {
    console.error('GET /api/receiving failed:', err);
    return Response.json(
      { error: 'Failed to load receiving log' },
      { status: 500 },
    );
  }
}
