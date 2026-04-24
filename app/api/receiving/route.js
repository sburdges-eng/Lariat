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
import { triggerComputeEngine } from '../../../lib/computeEngine';

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
    });

    // Both 'rejected' and 'accept_with_note' require a corrective /
    // rejection note. 'rejected' because the audit chain needs to
    // record WHY the delivery was refused (invoice credit, vendor
    // callback); 'accept_with_note' because that is the whole point
    // of the drift band — documented fix or nothing.
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
    
    const performWrite = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO receiving_log
             (shift_date, location_id, vendor, invoice_ref, category, item,
              reading_f, required_max_f, package_ok, expiration_date,
              status, rejection_reason, shellstock_tag_ref, cook_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
