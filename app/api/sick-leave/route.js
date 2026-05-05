// Paid sick leave (HFWA / L2). Tracks per-cook per-year accrual, use,
// carryover, and cap. Manager PIN gates writes — accrual + use are
// payroll-sensitive and only PIC may post.
//
// POST /api/sick-leave   → log accrual or use (PIN-gated, idempotent)
// GET  /api/sick-leave   → balance + recent audit events
//
// Citation: C.R.S. §8-13.3-401 et seq. (HFWA).

import { getDb } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import {
  HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED,
  HFWA_ANNUAL_CAP_HOURS,
  accrueHours,
  useHours,
  summarizeBalance,
} from '../../../lib/sickLeave';

export const dynamic = 'force-dynamic';

const KIND_VALUES = new Set(['accrual', 'use']);

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

async function gate(req) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'pic.sick_leave'))) {
    return Response.json(
      { error: 'manager PIN required — sick-leave entries are payroll-sensitive' },
      { status: 403 },
    );
  }
  return null;
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  return withIdempotency(req, () => sickLeavePostHandler(req));
}

async function sickLeavePostHandler(req) {
  try {
    const body = await req.json();

    const kind = clip(body.kind, 16);
    if (!kind || !KIND_VALUES.has(kind)) {
      return Response.json(
        { error: 'kind must be "accrual" or "use"' },
        { status: 400 },
      );
    }

    const cook_id = clip(body.cook_id, 64);
    if (!cook_id) {
      return Response.json({ error: 'cook_id is required' }, { status: 400 });
    }

    const accrual_year = Number(body.accrual_year);
    if (!Number.isInteger(accrual_year) || accrual_year < 2000 || accrual_year > 2100) {
      return Response.json({ error: 'accrual_year must be a 4-digit year' }, { status: 400 });
    }

    const hoursWorked = body.hours_worked != null ? Number(body.hours_worked) : null;
    if (hoursWorked != null && (!Number.isFinite(hoursWorked) || hoursWorked < 0)) {
      return Response.json({ error: 'hours_worked must be a non-negative number' }, { status: 400 });
    }

    // For accrual: either `hours` (front-loaded direct add) or
    // `hours_worked` (HFWA ratio) must be the positive driver. For
    // use: `hours` is the only path.
    const hoursRaw = body.hours != null ? Number(body.hours) : NaN;
    const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;
    if (kind === 'accrual') {
      if (hoursWorked == null && (!Number.isFinite(hoursRaw) || hoursRaw <= 0)) {
        return Response.json({ error: 'hours or hours_worked must be a positive number' }, { status: 400 });
      }
    } else {
      if (!Number.isFinite(hoursRaw) || hoursRaw <= 0) {
        return Response.json({ error: 'hours must be a positive number' }, { status: 400 });
      }
    }

    const note = clip(body.note, 300);
    const dateOf = clip(body.dated_on, 10) || null;
    if (dateOf && !/^\d{4}-\d{2}-\d{2}$/.test(dateOf)) {
      return Response.json({ error: 'dated_on must be YYYY-MM-DD' }, { status: 400 });
    }

    const location_id = locationFromBody(body);

    const db = getDb();

    const performWrite = db.transaction(() => {
      // Upsert pattern: SELECT first, INSERT new shell if missing,
      // re-SELECT, then run the rule, then UPDATE. Keeping the rule
      // pure means it sees the row state, computes a delta, and the
      // route persists.
      let row = db.prepare(`
        SELECT * FROM paid_sick_leave_balances
         WHERE location_id=? AND cook_id=? AND accrual_year=?
      `).get(location_id, cook_id, accrual_year);

      let action = 'update';
      let entityId;

      if (!row) {
        const info = db.prepare(`
          INSERT INTO paid_sick_leave_balances
            (location_id, cook_id, accrual_year, hours_accrued, hours_used, cap_hours, carryover_hours)
          VALUES (?, ?, ?, 0, 0, ?, 0)
        `).run(location_id, cook_id, accrual_year, HFWA_ANNUAL_CAP_HOURS);
        entityId = Number(info.lastInsertRowid);
        row = db.prepare('SELECT * FROM paid_sick_leave_balances WHERE id=?').get(entityId);
        action = 'insert';
      } else {
        entityId = row.id;
      }

      let updated;
      let appliedHours;

      if (kind === 'accrual') {
        // If hours_worked is provided we use the HFWA ratio (1h per
        // 30h worked). If only `hours` is provided we treat it as
        // hours-to-add directly (front-loading path) by multiplying
        // by 30 so accrueHours' cap math sees the right "earned"
        // amount — front-loading still respects the annual cap.
        const drivingHoursWorked = hoursWorked != null
          ? hoursWorked
          : hours * HFWA_ACCRUAL_HOURS_WORKED_PER_HOUR_EARNED;
        const result = accrueHours(row, drivingHoursWorked);
        appliedHours = result.hours_added;
        if (appliedHours <= 0) {
          // Cap reached or zero accrual — surface the reason as 422
          // so the UI can show it without the cook thinking the row
          // was silently dropped.
          return {
            status: 422,
            body: {
              error: result.reason || 'no accrual applied',
              capped: result.capped,
              hours_uncapped: result.hours_uncapped,
            },
          };
        }
        const newAccrued = (row.hours_accrued || 0) + appliedHours;
        db.prepare(`
          UPDATE paid_sick_leave_balances
             SET hours_accrued=?, last_accrued_on=?, updated_at=datetime('now')
           WHERE id=?
        `).run(newAccrued, dateOf, entityId);
      } else {
        // kind === 'use'
        const result = useHours(row, hours);
        if (!result.ok) {
          return {
            status: 422,
            body: { error: result.reason, hours_available: result.new_balance },
          };
        }
        appliedHours = hours;
        const newUsed = (row.hours_used || 0) + appliedHours;
        db.prepare(`
          UPDATE paid_sick_leave_balances
             SET hours_used=?, updated_at=datetime('now')
           WHERE id=?
        `).run(newUsed, entityId);
      }

      updated = db.prepare('SELECT * FROM paid_sick_leave_balances WHERE id=?').get(entityId);

      postAuditEvent({
        entity: 'paid_sick_leave_balances',
        entity_id: entityId,
        action,
        actor_cook_id: null,
        actor_source: 'pic_ui',
        payload: {
          kind,
          hours: appliedHours,
          row: updated,
        },
        note: note ? `${kind}:${note}` : `${kind}`,
        location_id,
      });

      return { status: 200, body: { ok: true, kind, hours_applied: appliedHours, balance: summarizeBalance(updated) } };
    });

    const result = performWrite();
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error('POST /api/sick-leave failed:', err);
    return Response.json({ error: 'Failed to record sick-leave entry' }, { status: 500 });
  }
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const cook_id = url.searchParams.get('cook_id');
    const yearParam = url.searchParams.get('year') || url.searchParams.get('accrual_year');
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();

    if (cook_id) {
      const accrual_year = yearParam ? Number(yearParam) : new Date().getFullYear();
      if (!Number.isInteger(accrual_year)) {
        return Response.json({ error: 'year must be a 4-digit integer' }, { status: 400 });
      }
      const row = db.prepare(`
        SELECT * FROM paid_sick_leave_balances
         WHERE location_id=? AND cook_id=? AND accrual_year=?
      `).get(location_id, cook_id, accrual_year);

      const balance = row ? summarizeBalance(row) : {
        cook_id,
        accrual_year,
        hours_accrued: 0,
        hours_used: 0,
        hours_available: 0,
        cap_hours: HFWA_ANNUAL_CAP_HOURS,
        carryover_hours: 0,
        at_cap: false,
      };

      const events = row
        ? db.prepare(`
            SELECT id, action, payload_json, note, created_at
              FROM audit_events
             WHERE entity='paid_sick_leave_balances'
               AND entity_id=?
             ORDER BY id DESC
             LIMIT 50
          `).all(row.id)
        : [];

      return Response.json({ location_id, cook_id, accrual_year, balance, events });
    }

    // No cook_id → list all balances for the location, current year by default
    const accrual_year = yearParam ? Number(yearParam) : new Date().getFullYear();
    const rows = db.prepare(`
      SELECT * FROM paid_sick_leave_balances
       WHERE location_id=? AND accrual_year=?
       ORDER BY cook_id ASC
    `).all(location_id, accrual_year);

    return Response.json({
      location_id,
      accrual_year,
      balances: rows.map(summarizeBalance),
    });
  } catch (err) {
    console.error('GET /api/sick-leave failed:', err);
    return Response.json({ error: 'Failed to load sick-leave balances' }, { status: 500 });
  }
}
