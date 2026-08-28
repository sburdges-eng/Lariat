// @ts-check
import { getDb } from '../../../../lib/db';
import { locationFromBodyOrRequest } from '../../../../lib/location';
import { postAuditEvent } from '../../../../lib/auditEvents';
import { withIdempotency } from '../../../../lib/idempotency';
import {
  regulatedBoardFor,
  statusClaimsClosure,
  validateOpsStepInput,
} from '../../../../lib/opsRun.ts';
import {
  hasRegulatedRecord,
  readOpsRunStep,
  updateOpsStepStatus,
} from '../../../../lib/opsRunRepo.ts';

export const dynamic = 'force-dynamic';

/** @typedef {{ params?: Promise<{ id?: unknown }> | { id?: unknown } }} RouteCtx */

/** @param {unknown} v @param {number} max @returns {string | null} */
const clip = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** @param {RouteCtx | null | undefined} ctx */
async function readId(ctx) {
  const params = await Promise.resolve(ctx?.params || {});
  const id = Number(params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** @param {Request} req @param {RouteCtx} ctx */
export async function PATCH(req, ctx) {
  return withIdempotency(req, () => opsRunPatchHandler(req, ctx));
}

/** @param {Request} req @param {RouteCtx} ctx */
async function opsRunPatchHandler(req, ctx) {
  try {
    const id = await readId(ctx);
    if (id == null) {
      return Response.json({ error: 'bad id' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const loc = locationFromBodyOrRequest(body, req);
    const status = clip(body.status, 32);
    const actorCookId = clip(body.cook_id, 64);

    const check = validateOpsStepInput({ status });
    if (!check.ok || !status) {
      return Response.json(
        { error: check.ok === false ? check.error : 'status required' },
        { status: 400 },
      );
    }

    const existing = readOpsRunStep(id);
    if (!existing || existing.location_id !== loc) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }

    const db = getDb();

    // A day-plan tick is not the regulated record. For the steps that stand in
    // for one, refuse to record closure unless that board carries a row for the
    // shift — otherwise the plan, Command and Morning all report food-safety
    // work done with nothing written anywhere. Refused before the transaction,
    // so a rejected close leaves no row change and no audit event behind it.
    const board = regulatedBoardFor(existing.step_key);
    if (board && statusClaimsClosure(status)) {
      if (!hasRegulatedRecord(board, loc, existing.shift_date, db)) {
        return Response.json(
          {
            error: board.message,
            board: board.label,
            href: board.href,
          },
          { status: 422 },
        );
      }
    }

    const step = db.transaction(() => {
      const row = updateOpsStepStatus(
        id,
        /** @type {import('../../../../lib/opsRun.ts').OpsStepStatus} */ (status),
        actorCookId,
        db,
      );
      if (!row) return null;
      postAuditEvent({
        entity: 'ops_run_steps',
        entity_id: id,
        action: 'update',
        actor_cook_id: actorCookId,
        actor_source: 'cook_ui',
        shift_date: row.shift_date,
        location_id: loc,
        payload: { before: existing, after: row },
      });
      return row;
    })();

    if (!step) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }
    return Response.json({ ok: true, step });
  } catch (err) {
    console.error('PATCH /api/ops-run/[id] failed:', err);
    return Response.json({ error: 'Could not update day-plan step' }, { status: 500 });
  }
}
