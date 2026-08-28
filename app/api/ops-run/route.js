// @ts-check
import { getDb } from '../../../lib/db';
// Venue date, not the UTC slice — a UTC day rolls at 6pm Mountain, which
// would default an evening request to tomorrow's shift.
import { serviceDateISO } from '../../../lib/boh/index.ts';
import { locationFromBody, locationFromRequest } from '../../../lib/location';
import { postAuditEvent } from '../../../lib/auditEvents';
import { withIdempotency } from '../../../lib/idempotency';
import {
  isOpsDaypart,
  parseDueMinutes,
  rollupOpsSteps,
  validateOpsStepInput,
} from '../../../lib/opsRun.ts';
import {
  ensureOpsRunForShift,
  insertManualOpsStep,
  listOpsRunSteps,
  localNowMinutes,
} from '../../../lib/opsRunRepo.ts';

export const dynamic = 'force-dynamic';

/** @param {unknown} v @param {number} max @returns {string | null} */
const clip = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** @param {Request} req */
export async function GET(req) {
  try {
    const url = new URL(req.url);
    const loc = locationFromRequest(req);
    const shiftDate = clip(url.searchParams.get('date'), 32) || serviceDateISO();
    const materialize = url.searchParams.get('materialize') !== '0';

    const rows = materialize
      ? ensureOpsRunForShift(loc, shiftDate)
      : listOpsRunSteps(loc, shiftDate);

    const nowMin = localNowMinutes();
    const rollup = rollupOpsSteps(rows, nowMin);
    return Response.json({
      shift_date: shiftDate,
      location_id: loc,
      rows,
      rollup,
      now_minutes: nowMin,
    });
  } catch (err) {
    console.error('GET /api/ops-run failed:', err);
    return Response.json({ error: 'Could not load day plan' }, { status: 500 });
  }
}

/** @param {Request} req */
export async function POST(req) {
  return withIdempotency(req, () => opsRunPostHandler(req));
}

/** @param {Request} req */
async function opsRunPostHandler(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const loc = locationFromBody(body);
    const shiftDate = clip(body.shift_date, 32) || serviceDateISO();
    const daypart = clip(body.daypart, 32) || 'side_work';
    const title = clip(body.title, 300);
    const detail = clip(body.detail, 1000);
    const dueTime = clip(body.due_time, 8);
    const linkHref = clip(body.link_href, 200);
    const linkLabel = clip(body.link_label, 80);
    const stepKey = clip(body.step_key, 120);
    const actorCookId = clip(body.cook_id, 64);

    const check = validateOpsStepInput({
      daypart,
      title: title || '',
      due_time: dueTime,
    });
    if (!check.ok) {
      return Response.json({ error: check.error }, { status: 400 });
    }
    if (!title) {
      return Response.json({ error: 'title required' }, { status: 400 });
    }
    if (!isOpsDaypart(daypart)) {
      return Response.json({ error: 'bad daypart' }, { status: 400 });
    }
    if (dueTime && parseDueMinutes(dueTime) == null) {
      return Response.json({ error: 'due time must look like 15:30' }, { status: 400 });
    }

    // Ensure house spine exists so a manual add sits beside the day plan.
    ensureOpsRunForShift(loc, shiftDate);

    const db = getDb();
    const step = db.transaction(() => {
      const row = insertManualOpsStep(
        {
          location_id: loc,
          shift_date: shiftDate,
          daypart,
          title,
          detail,
          due_time: dueTime,
          link_href: linkHref,
          link_label: linkLabel,
          step_key: stepKey,
        },
        db,
      );
      postAuditEvent({
        entity: 'ops_run_steps',
        entity_id: row.id,
        action: 'insert',
        actor_cook_id: actorCookId,
        actor_source: 'cook_ui',
        shift_date: shiftDate,
        location_id: loc,
        payload: row,
      });
      return row;
    })();

    return Response.json({ ok: true, step });
  } catch (err) {
    console.error('POST /api/ops-run failed:', err);
    return Response.json({ error: 'Could not save day-plan step' }, { status: 500 });
  }
}
