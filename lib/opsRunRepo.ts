// Persistence for the day-plan run spine. Materializes house templates
// into ops_run_steps for a shift_date + location, then attaches live
// pulls from BEO prep, daily prep, line checks, cleaning, maintenance,
// and a busy-day heads-up from Toast DOW history + books.

import { getDb } from './db.ts';
import type { Database as DB } from 'better-sqlite3';
import { getStations } from './data.ts';
import { stationProgress } from './stationProgress.js';
import {
  addDaysISO,
  BEO_PREP_LOOKAHEAD_DAYS,
  classifyBusyDay,
  houseOpsTemplateSeeds,
  isOpsDaypart,
  isStepLate,
  OPS_DYNAMIC_STEP_CAP,
  rollupOpsSteps,
  weekdayShortFromISO,
  type OpsDaypart,
  type OpsRunRollup,
  type OpsStepStatus,
} from './opsRun.ts';
import { augustChecklistForDate } from './augustChecklists2026.ts';

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

type InsertFn = {
  run: (
    locationId: string,
    shiftDate: string,
    daypart: string,
    stepKey: string,
    title: string,
    detail: string | null,
    dueTime: string | null,
    linkHref: string | null,
    linkLabel: string | null,
    sortOrder: number,
    source: string,
    templateStepId: number | null,
  ) => unknown;
};

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
 * Insert a dynamic step; if it already exists and is still open, refresh
 * title/detail so live counts stay current without clobbering Done.
 */
function upsertDynamicStep(
  db: DB,
  insert: InsertFn,
  row: {
    locationId: string;
    shiftDate: string;
    daypart: OpsDaypart;
    stepKey: string;
    title: string;
    detail: string | null;
    dueTime: string | null;
    linkHref: string | null;
    linkLabel: string | null;
    sortOrder: number;
    source: string;
  },
): void {
  insert.run(
    row.locationId,
    row.shiftDate,
    row.daypart,
    row.stepKey,
    row.title,
    row.detail,
    row.dueTime,
    row.linkHref,
    row.linkLabel,
    row.sortOrder,
    row.source,
    null,
  );
  db.prepare(
    `UPDATE ops_run_steps
        SET title = ?, detail = ?, due_time = ?, link_href = ?, link_label = ?,
            sort_order = ?, updated_at = datetime('now')
      WHERE location_id = ? AND shift_date = ? AND daypart = ? AND step_key = ?
        AND status = 'todo'`,
  ).run(
    row.title,
    row.detail,
    row.dueTime,
    row.linkHref,
    row.linkLabel,
    row.sortOrder,
    row.locationId,
    row.shiftDate,
    row.daypart,
    row.stepKey,
  );
}

function materializeMaintenance(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): void {
  const maint = db
    .prepare(
      `SELECT s.id AS schedule_id, e.name AS equipment_name, s.task, s.next_due
         FROM equipment_maintenance_schedule s
         JOIN equipment e ON e.id = s.equipment_id
        WHERE s.location_id = ?
          AND s.next_due IS NOT NULL
          AND s.next_due <= ?
        ORDER BY s.next_due ASC, s.id ASC
        LIMIT ?`,
    )
    .all(locationId, shiftDate, OPS_DYNAMIC_STEP_CAP) as Array<{
    schedule_id: number;
    equipment_name: string;
    task: string;
    next_due: string;
  }>;

  for (const m of maint) {
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'maintenance',
      stepKey: `maint-sched-${m.schedule_id}`,
      title: `${m.equipment_name} — ${m.task}`,
      detail: `Due ${m.next_due}`,
      dueTime: '14:00',
      linkHref: '/equipment',
      linkLabel: 'Equipment',
      sortOrder: 100 + m.schedule_id,
      source: 'maintenance',
    });
  }
}

function materializeCleaning(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): void {
  const rows = db
    .prepare(
      `SELECT id, area, task, next_due, frequency
         FROM cleaning_schedule
        WHERE location_id = ?
          AND active = 1
          AND archived_at IS NULL
          AND next_due IS NOT NULL
          AND next_due <= ?
        ORDER BY next_due ASC, id ASC
        LIMIT ?`,
    )
    .all(locationId, shiftDate, OPS_DYNAMIC_STEP_CAP) as Array<{
    id: number;
    area: string;
    task: string;
    next_due: string;
    frequency: string;
  }>;

  for (const c of rows) {
    const late = c.next_due < shiftDate;
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'side_work',
      stepKey: `clean-sched-${c.id}`,
      title: `${c.area} — ${c.task}`,
      detail: late
        ? `Late since ${c.next_due} · ${c.frequency}`
        : `Due today · ${c.frequency}`,
      dueTime: late ? '12:00' : '23:45',
      linkHref: '/food-safety/cleaning',
      linkLabel: 'Cleaning',
      sortOrder: 200 + c.id,
      source: 'cleaning',
    });
  }
}

function materializeBeoPrep(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): { beoGuestsToday: number; beoGuestsWindow: number; eventCount: number } {
  const until = addDaysISO(shiftDate, BEO_PREP_LOOKAHEAD_DAYS);
  const events = db
    .prepare(
      `SELECT e.id AS event_id,
              e.title,
              e.event_date,
              e.event_time,
              COALESCE(e.guest_count, 0) AS guest_count,
              SUM(CASE WHEN COALESCE(t.done, 0) = 0 THEN 1 ELSE 0 END) AS open_tasks,
              COUNT(t.id) AS total_tasks
         FROM beo_events e
         LEFT JOIN beo_prep_tasks t
           ON t.event_id = e.id
          AND t.location_id = e.location_id
        WHERE e.location_id = ?
          AND e.event_date >= ?
          AND e.event_date <= ?
          AND COALESCE(e.status, '') NOT IN ('cancelled', 'canceled')
        GROUP BY e.id, e.title, e.event_date, e.event_time, e.guest_count
        ORDER BY e.event_date ASC, COALESCE(e.event_time, '00:00') ASC
        LIMIT ?`,
    )
    .all(locationId, shiftDate, until, OPS_DYNAMIC_STEP_CAP) as Array<{
    event_id: number;
    title: string;
    event_date: string;
    event_time: string | null;
    guest_count: number;
    open_tasks: number;
    total_tasks: number;
  }>;

  let beoGuestsToday = 0;
  let beoGuestsWindow = 0;
  let sortBase = 300;

  for (const ev of events) {
    beoGuestsWindow += Number(ev.guest_count) || 0;
    if (ev.event_date === shiftDate) beoGuestsToday += Number(ev.guest_count) || 0;

    const when =
      ev.event_date === shiftDate
        ? `Today${ev.event_time ? ` ${ev.event_time}` : ''}`
        : `${ev.event_date}${ev.event_time ? ` ${ev.event_time}` : ''}`;
    const open = Number(ev.open_tasks) || 0;
    const total = Number(ev.total_tasks) || 0;

    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'prep',
      stepKey: `beo-event-${ev.event_id}`,
      title: `Banquet — ${ev.title}`,
      detail:
        `${when} · ${ev.guest_count} guests` +
        (total > 0 ? ` · ${open} open prep / ${total}` : ' · no prep list yet'),
      dueTime: ev.event_date === shiftDate ? '09:00' : '11:00',
      linkHref: '/beo',
      linkLabel: 'BEO',
      sortOrder: sortBase++,
      source: 'beo',
    });

    if (open > 0) {
      const tasks = db
        .prepare(
          `SELECT id, task, due_date
             FROM beo_prep_tasks
            WHERE event_id = ? AND location_id = ? AND COALESCE(done, 0) = 0
            ORDER BY sort_order ASC, id ASC
            LIMIT ?`,
        )
        .all(ev.event_id, locationId, 12) as Array<{
        id: number;
        task: string;
        due_date: string | null;
      }>;

      for (const t of tasks) {
        upsertDynamicStep(db, insert, {
          locationId,
          shiftDate,
          daypart: 'prep',
          stepKey: `beo-prep-${t.id}`,
          title: t.task,
          detail: `For ${ev.title}${t.due_date ? ` · due ${t.due_date}` : ''}`,
          dueTime: '10:00',
          linkHref: '/beo',
          linkLabel: 'BEO',
          sortOrder: sortBase++,
          source: 'beo',
        });
      }
    }
  }

  // Order pull when banquets are on the books — purchasing/order guide.
  if (beoGuestsWindow > 0) {
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'prep',
      stepKey: `beo-order-pull-${shiftDate}`,
      title: 'Order pull for banquets',
      detail: `${beoGuestsWindow} guests on BEOs through ${until} — check the order guide.`,
      dueTime: '08:30',
      linkHref: '/purchasing',
      linkLabel: 'Order guide',
      sortOrder: 290,
      source: 'beo',
    });
  }

  return { beoGuestsToday, beoGuestsWindow, eventCount: events.length };
}

function materializePrepList(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): void {
  const open = db
    .prepare(
      `SELECT id, station_id, task, qty, priority, status
         FROM prep_tasks
        WHERE location_id = ?
          AND shift_date = ?
          AND status IN ('todo', 'in_progress')
        ORDER BY priority DESC, sort_order ASC, id ASC
        LIMIT ?`,
    )
    .all(locationId, shiftDate, OPS_DYNAMIC_STEP_CAP) as Array<{
    id: number;
    station_id: string | null;
    task: string;
    qty: string | null;
    priority: number;
    status: string;
  }>;

  if (open.length === 0) return;

  const rush = open.filter((t) => t.priority >= 1).length;
  upsertDynamicStep(db, insert, {
    locationId,
    shiftDate,
    daypart: 'prep',
    stepKey: `prep-list-${shiftDate}`,
    title: 'Prep list — still open',
    detail: `${open.length} open${rush > 0 ? ` · ${rush} high or rush` : ''} — work the board.`,
    dueTime: '10:00',
    linkHref: '/prep',
    linkLabel: 'Prep board',
    sortOrder: 250,
    source: 'prep',
  });

  for (const t of open.slice(0, 15)) {
    const rushLabel = t.priority >= 2 ? 'Rush · ' : t.priority === 1 ? 'High · ' : '';
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'prep',
      stepKey: `prep-task-${t.id}`,
      title: `${rushLabel}${t.task}`,
      detail: [t.qty, t.station_id, t.status === 'in_progress' ? 'in progress' : null]
        .filter(Boolean)
        .join(' · ') || null,
      dueTime: t.priority >= 1 ? '09:30' : '11:00',
      linkHref: '/prep',
      linkLabel: 'Prep board',
      sortOrder: 260 + t.id,
      source: 'prep',
    });
  }
}

function materializeLineChecks(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): void {
  const stations = getStations();
  let sort = 150;
  let incomplete = 0;
  let unsigned = 0;

  for (const station of stations) {
    if (!station.line_check_key) continue;
    const prog = stationProgress(station, shiftDate, locationId);
    if (!prog) continue;
    const openItems = prog.total - prog.done;
    const needsWork = openItems > 0 || !prog.signedOff;
    if (!needsWork) continue;
    incomplete += 1;
    if (!prog.signedOff) unsigned += 1;

    const bits = [
      openItems > 0 ? `${openItems} of ${prog.total} left` : `${prog.total} checked`,
      prog.signedOff ? null : 'needs sign-off',
      prog.flagged > 0 ? `${prog.flagged} fail` : null,
    ].filter(Boolean);

    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'open',
      stepKey: `line-check-${station.id}`,
      title: `Line check — ${station.name}`,
      detail: bits.join(' · '),
      dueTime: '08:00',
      linkHref: `/stations/${encodeURIComponent(station.id)}`,
      linkLabel: 'Station',
      sortOrder: sort++,
      source: 'line_check',
    });

    if (sort - 150 >= OPS_DYNAMIC_STEP_CAP) break;
  }

  if (incomplete > 0) {
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: 'open',
      stepKey: `line-check-rollup-${shiftDate}`,
      title: 'Line checks still open',
      detail: `${incomplete} station${incomplete === 1 ? '' : 's'} · ${unsigned} need sign-off`,
      dueTime: '08:00',
      linkHref: '/stations',
      linkLabel: 'Stations',
      sortOrder: 140,
      source: 'line_check',
    });
  }
}

function materializeBusyDay(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
  beoGuestsToday: number,
  beoGuestsWindow: number,
): void {
  const weekday = weekdayShortFromISO(shiftDate);
  const dowRows = db
    .prepare(
      `SELECT day_of_week, COALESCE(guests, 0) AS guests, COALESCE(net_sales, 0) AS net_sales
         FROM toast_sales_dow
        WHERE location_id = ? AND comparison_group = 1`,
    )
    .all(locationId) as Array<{ day_of_week: string; guests: number; net_sales: number }>;

  const sorted = [...dowRows].sort((a, b) => Number(b.guests) - Number(a.guests));
  const mine = dowRows.find((r) => r.day_of_week === weekday);
  const dowGuests = mine ? Number(mine.guests) || 0 : 0;
  const rank =
    mine && sorted.length
      ? sorted.findIndex((r) => r.day_of_week === weekday) + 1
      : 0;

  const booked = (
    db
      .prepare(
        `SELECT COALESCE(SUM(party_size), 0) AS covers
           FROM reservations
          WHERE location_id = ?
            AND substr(reservation_at, 1, 10) = ?
            AND status IN ('booked', 'seated')`,
      )
      .get(locationId, shiftDate) as { covers: number }
  ).covers;

  const verdict = classifyBusyDay({
    weekday,
    dowGuests,
    dowRankByGuests: rank,
    beoGuestsToday,
    beoGuestsWindow,
    bookedCovers: Number(booked) || 0,
  });

  if (!verdict.busy) return;

  upsertDynamicStep(db, insert, {
    locationId,
    shiftDate,
    daypart: 'prep',
    stepKey: `busy-day-${shiftDate}`,
    title: 'Busy day — watch the books',
    detail: verdict.reasons.join(' · '),
    dueTime: '07:00',
    linkHref: '/beo',
    linkLabel: 'BEO',
    sortOrder: 200,
    source: 'busy',
  });
}

function materializeAugustChecklists(
  db: DB,
  insert: InsertFn,
  locationId: string,
  shiftDate: string,
): void {
  const weekday = weekdayShortFromISO(shiftDate);
  const items = augustChecklistForDate(shiftDate, weekday);
  let sort = 400;
  for (const item of items) {
    upsertDynamicStep(db, insert, {
      locationId,
      shiftDate,
      daypart: item.daypart,
      stepKey: `${item.key}-${shiftDate}`,
      title: item.title,
      detail: item.detail ?? null,
      dueTime: item.due_time ?? null,
      linkHref: item.link_href ?? '/food-safety/cleaning',
      linkLabel: item.link_label ?? 'Cleaning',
      sortOrder: sort++,
      source: `checklist-${item.cadence}`,
    });
  }
}

/**
 * Materialize template steps + live board pulls into ops_run_steps for
 * the given shift. Existing Done/Skip rows are left alone; open dynamic
 * rows refresh title/detail. Returns the full step list after materialize.
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
  ) as InsertFn;

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

    materializeLineChecks(db, insert, locationId, shiftDate);
    materializePrepList(db, insert, locationId, shiftDate);
    const beo = materializeBeoPrep(db, insert, locationId, shiftDate);
    materializeBusyDay(
      db,
      insert,
      locationId,
      shiftDate,
      beo.beoGuestsToday,
      beo.beoGuestsWindow,
    );
    materializeCleaning(db, insert, locationId, shiftDate);
    materializeMaintenance(db, insert, locationId, shiftDate);
    materializeAugustChecklists(db, insert, locationId, shiftDate);
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
