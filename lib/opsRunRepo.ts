// Persistence for the day-plan run spine. Materializes house templates
// into ops_run_steps for a shift_date + location, and can attach
// dynamic maintenance-due rows as extra steps.

import { getDb } from './db.ts';
import type { Database as DB } from 'better-sqlite3';
import {
  houseOpsTemplateSeeds,
  isOpsDaypart,
  isStepLate,
  rollupOpsSteps,
  type OpsDaypart,
  type OpsRunRollup,
  type OpsStepStatus,
} from './opsRun.ts';

export interface OpsRunStepRow {
  id: number;
  location_id: string;
  shift_date: string;
  daypart: OpsDaypart;
  step_key: string;
  title: string;
  detail: string | null;
  due_time: string | null;
  link_href: string | null;
  link_label: string | null;
  status: OpsStepStatus;
  done_at: string | null;
  done_by: string | null;
  sort_order: number;
  source: string;
  template_step_id: number | null;
  created_at: string | null;
  updated_at: string | null;
}

const STEP_SELECT = `id, location_id, shift_date, daypart, step_key, title, detail,
  due_time, link_href, link_label, status, done_at, done_by, sort_order,
  source, template_step_id, created_at, updated_at`;

export function localNowMinutes(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function listOpsRunSteps(
  locationId: string,
  shiftDate: string,
  db: DB = getDb(),
): OpsRunStepRow[] {
  return db
    .prepare(
      `SELECT ${STEP_SELECT}
         FROM ops_run_steps
        WHERE location_id = ? AND shift_date = ?
        ORDER BY
          CASE daypart
            WHEN 'open' THEN 1
            WHEN 'prep' THEN 2
            WHEN 'side_work' THEN 3
            WHEN 'maintenance' THEN 4
            WHEN 'sop' THEN 5
            ELSE 9
          END,
          sort_order ASC, id ASC`,
    )
    .all(locationId, shiftDate) as OpsRunStepRow[];
}

export function readOpsRunStep(id: number, db: DB = getDb()): OpsRunStepRow | undefined {
  return db
    .prepare(`SELECT ${STEP_SELECT} FROM ops_run_steps WHERE id = ?`)
    .get(id) as OpsRunStepRow | undefined;
}

/** Ensure house templates exist for a location (idempotent). */
export function ensureOpsTemplates(locationId: string, db: DB = getDb()): void {
  const existing = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM ops_run_templates
          WHERE location_id = ? AND active = 1`,
      )
      .get(locationId) as { c: number }
  ).c;
  if (existing > 0) return;

  const seeds = houseOpsTemplateSeeds();
  const insertTpl = db.prepare(
    `INSERT INTO ops_run_templates (location_id, daypart, title, sort_order, active)
     VALUES (?, ?, ?, ?, 1)`,
  );
  const insertStep = db.prepare(
    `INSERT INTO ops_run_template_steps
       (template_id, step_key, title, detail, due_time, link_href, link_label, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const tpl of seeds) {
      const info = insertTpl.run(locationId, tpl.daypart, tpl.title, tpl.sort_order);
      const templateId = Number(info.lastInsertRowid);
      for (const step of tpl.steps) {
        insertStep.run(
          templateId,
          step.step_key,
          step.title,
          step.detail ?? null,
          step.due_time ?? null,
          step.link_href ?? null,
          step.link_label ?? null,
          step.sort_order ?? 0,
        );
      }
    }
  })();
}

/**
 * Materialize template steps + due maintenance into ops_run_steps for
 * the given shift. Existing rows are left alone (progress preserved).
 * Returns the full step list after materialize.
 */
export function ensureOpsRunForShift(
  locationId: string,
  shiftDate: string,
  db: DB = getDb(),
): OpsRunStepRow[] {
  ensureOpsTemplates(locationId, db);

  const insert = db.prepare(
    `INSERT OR IGNORE INTO ops_run_steps
       (location_id, shift_date, daypart, step_key, title, detail, due_time,
        link_href, link_label, status, sort_order, source, template_step_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?)`,
  );

  db.transaction(() => {
    const templateSteps = db
      .prepare(
        `SELECT s.id AS template_step_id, t.daypart, s.step_key, s.title, s.detail,
                s.due_time, s.link_href, s.link_label, s.sort_order
           FROM ops_run_template_steps s
           JOIN ops_run_templates t ON t.id = s.template_id
          WHERE t.location_id = ? AND t.active = 1
          ORDER BY t.sort_order ASC, s.sort_order ASC, s.id ASC`,
      )
      .all(locationId) as Array<{
      template_step_id: number;
      daypart: string;
      step_key: string;
      title: string;
      detail: string | null;
      due_time: string | null;
      link_href: string | null;
      link_label: string | null;
      sort_order: number;
    }>;

    for (const s of templateSteps) {
      if (!isOpsDaypart(s.daypart)) continue;
      insert.run(
        locationId,
        shiftDate,
        s.daypart,
        s.step_key,
        s.title,
        s.detail,
        s.due_time,
        s.link_href,
        s.link_label,
        s.sort_order,
        'template',
        s.template_step_id,
      );
    }

    // Dynamic gear rows due today or overdue — one step per schedule row.
    const maint = db
      .prepare(
        `SELECT s.id AS schedule_id, e.name AS equipment_name, s.task, s.next_due
           FROM equipment_maintenance_schedule s
           JOIN equipment e ON e.id = s.equipment_id
          WHERE s.location_id = ?
            AND s.next_due IS NOT NULL
            AND s.next_due <= ?
          ORDER BY s.next_due ASC, s.id ASC
          LIMIT 40`,
      )
      .all(locationId, shiftDate) as Array<{
      schedule_id: number;
      equipment_name: string;
      task: string;
      next_due: string;
    }>;

    for (const m of maint) {
      insert.run(
        locationId,
        shiftDate,
        'maintenance',
        `maint-sched-${m.schedule_id}`,
        `${m.equipment_name} — ${m.task}`,
        `Due ${m.next_due}`,
        '14:00',
        '/equipment',
        'Equipment',
        100 + m.schedule_id,
        'maintenance',
        null,
      );
    }
  })();

  return listOpsRunSteps(locationId, shiftDate, db);
}

export function insertManualOpsStep(
  input: {
    location_id: string;
    shift_date: string;
    daypart: OpsDaypart;
    title: string;
    detail?: string | null;
    due_time?: string | null;
    link_href?: string | null;
    link_label?: string | null;
    step_key?: string | null;
    sort_order?: number;
  },
  db: DB = getDb(),
): OpsRunStepRow {
  const stepKey =
    (input.step_key && input.step_key.trim()) ||
    `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const info = db
    .prepare(
      `INSERT INTO ops_run_steps
         (location_id, shift_date, daypart, step_key, title, detail, due_time,
          link_href, link_label, status, sort_order, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, 'manual')`,
    )
    .run(
      input.location_id,
      input.shift_date,
      input.daypart,
      stepKey,
      input.title.trim(),
      input.detail ?? null,
      input.due_time ?? null,
      input.link_href ?? null,
      input.link_label ?? null,
      input.sort_order ?? 500,
    );
  const row = readOpsRunStep(Number(info.lastInsertRowid), db);
  if (!row) throw new Error('ops_run_steps insert vanished');
  return row;
}

export function updateOpsStepStatus(
  id: number,
  status: OpsStepStatus,
  doneBy: string | null,
  db: DB = getDb(),
): OpsRunStepRow | undefined {
  const existing = readOpsRunStep(id, db);
  if (!existing) return undefined;

  let doneAt: string | null = existing.done_at;
  let doneByOut: string | null = existing.done_by;
  if (status === 'done') {
    doneAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    doneByOut = doneBy;
  } else if (status === 'todo') {
    doneAt = null;
    doneByOut = null;
  } else if (status === 'skipped') {
    doneAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    doneByOut = doneBy;
  }

  db.prepare(
    `UPDATE ops_run_steps
        SET status = ?, done_at = ?, done_by = ?,
            updated_at = datetime('now')
      WHERE id = ?`,
  ).run(status, doneAt, doneByOut, id);

  return readOpsRunStep(id, db);
}

export function opsRunRollupFor(
  locationId: string,
  shiftDate: string,
  nowMinutes: number = localNowMinutes(),
  db: DB = getDb(),
): OpsRunRollup {
  const steps = listOpsRunSteps(locationId, shiftDate, db);
  return rollupOpsSteps(steps, nowMinutes);
}

export function countLateOpsSteps(
  locationId: string,
  shiftDate: string,
  nowMinutes: number = localNowMinutes(),
  db: DB = getDb(),
): number {
  const steps = listOpsRunSteps(locationId, shiftDate, db);
  return steps.filter((s) => isStepLate(s, nowMinutes)).length;
}
