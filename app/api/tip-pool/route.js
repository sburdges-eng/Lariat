// Tip pool ledger (L4 / COMPS #39 §3.3, §3.4 + 29 CFR 531.52).
//
// POST /api/tip-pool   → log a tip / service-charge / direct-tip line
// GET  /api/tip-pool   → daily / weekly summary, optionally by pool
//
// Manager-PIN gated — distributions are payroll-sensitive. Money is
// integer cents end-to-end (the schema enforces INTEGER NOT NULL on
// amount_cents; the rule module re-checks).

import { getDb, todayISO } from '../../../lib/db';
import { DEFAULT_LOCATION_ID, locationFromBody, locationFromRequest } from '../../../lib/location';
import { hasPinOrTempPin, pinRequiredForPic } from '../../../lib/pin';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import {
  CO_STD_MIN_WAGE_CENTS_2026,
  CO_TIPPED_MIN_WAGE_CENTS_2026,
  CO_TIP_CREDIT_CENTS_2026,
  isPoolEligible,
  summarizePool,
  validateDistributionShape,
  validateTipCreditPeriod,
} from '../../../lib/tipPool';

export const dynamic = 'force-dynamic';

const clip = (s, max) => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
};

async function gate(req) {
  if (pinRequiredForPic() && !(await hasPinOrTempPin(req, 'pic.tip_pool'))) {
    return Response.json(
      { error: 'manager PIN required — tip-pool entries are payroll-sensitive' },
      { status: 403 },
    );
  }
  return null;
}

// ── POST ─────────────────────────────────────────────────────────

export async function POST(req) {
  const blocked = await gate(req);
  if (blocked) return blocked;
  return withIdempotency(req, () => tipPoolPostHandler(req));
}

async function tipPoolPostHandler(req) {
  try {
    const body = await req.json();
    const shift_date = clip(body.shift_date, 32) || todayISO();
    const pool_ref = clip(body.pool_ref, 120);
    const cook_id = clip(body.cook_id, 64);
    const role = clip(body.role, 64);
    const kind = clip(body.kind, 32);
    const note = clip(body.note, 300);
    const location_id = locationFromBody(body);

    // Reject floats explicitly — the validator's isInt check would
    // catch this, but be explicit so the error is targeted.
    const rawAmount = body.amount_cents;
    if (typeof rawAmount !== 'number' || !Number.isInteger(rawAmount)) {
      return Response.json(
        { error: 'amount_cents must be a non-negative integer (cents — no floats)' },
        { status: 422 },
      );
    }

    const shape = validateDistributionShape({
      shift_date, pool_ref, cook_id, role, kind, amount_cents: rawAmount,
    });
    if (!shape.ok) {
      return Response.json({ error: shape.reason }, { status: 400 });
    }

    // Eligibility check: a manager/owner must NOT be in a tip pool
    // (COMPS §3.4). Service charges and direct tips are not pool
    // contributions — those distinct categories DO flow to managers
    // legally, but a `tip_pool` line for a manager is invalid.
    if (kind === 'tip_pool') {
      const db0 = getDb();
      const flags = db0.prepare(`
        SELECT cook_id, flag, effective_to
          FROM staff_flags
         WHERE location_id=? AND cook_id=? AND effective_to IS NULL
      `).all(location_id, cook_id);
      if (!isPoolEligible(flags, role)) {
        return Response.json(
          {
            error: 'cook is excluded from tip pool — managers/owners may not receive pooled tips per COMPS §3.4',
            citation: '7 CCR 1103-1 §3.4',
          },
          { status: 422 },
        );
      }
    }

    const db = getDb();
    const performWrite = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO tip_pool_distributions
          (shift_date, location_id, pool_ref, cook_id, role, kind, amount_cents, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(shift_date, location_id, pool_ref, cook_id, role, kind, rawAmount, note);

      const row = db.prepare('SELECT * FROM tip_pool_distributions WHERE id=?').get(info.lastInsertRowid);

      postAuditEvent({
        entity: 'tip_pool_distributions',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'pic_ui',
        payload: row,
        shift_date,
        location_id,
      });

      return row;
    });

    const row = performWrite();
    return Response.json({ ok: true, entry: row });
  } catch (err) {
    console.error('POST /api/tip-pool failed:', err);
    return Response.json({ error: 'Failed to record tip-pool line' }, { status: 500 });
  }
}

// ── GET ──────────────────────────────────────────────────────────

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date') || todayISO();
    const dateEnd = url.searchParams.get('date_end');
    const poolRef = url.searchParams.get('pool_ref');
    const location_id = locationFromRequest(req) || DEFAULT_LOCATION_ID;

    const db = getDb();
    let sql = `SELECT * FROM tip_pool_distributions
                WHERE location_id=? AND shift_date >= ?`;
    const args = [location_id, date];
    if (dateEnd) {
      sql += ' AND shift_date <= ?';
      args.push(dateEnd);
    } else {
      sql += ' AND shift_date <= ?';
      args.push(date);
    }
    if (poolRef) {
      sql += ' AND pool_ref=?';
      args.push(poolRef);
    }
    sql += ' ORDER BY shift_date ASC, id ASC';

    const rows = db.prepare(sql).all(...args);
    const summary = summarizePool(rows);

    return Response.json({
      location_id,
      date,
      date_end: dateEnd || date,
      pool_ref: poolRef || null,
      rows,
      summary,
      // Hand the active comp-period config back so the UI can render
      // the tip-credit math without hard-coding numbers.
      comps: {
        std_min_wage_cents: CO_STD_MIN_WAGE_CENTS_2026,
        tipped_min_wage_cents: CO_TIPPED_MIN_WAGE_CENTS_2026,
        tip_credit_cents: CO_TIP_CREDIT_CENTS_2026,
      },
    });
  } catch (err) {
    console.error('GET /api/tip-pool failed:', err);
    return Response.json({ error: 'Failed to load tip-pool data' }, { status: 500 });
  }
}

// Re-export for tests / callers that want to do tip-credit math
// against the pulled rows without re-importing the rule module.
export { validateTipCreditPeriod };
