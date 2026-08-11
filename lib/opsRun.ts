// Day-plan / side-work run spine.
//
// Thin orchestration over existing boards (stations, prep, cleaning,
// equipment). Templates define the house itinerary; ops_run_steps hold
// shared multi-device progress for a shift_date + location.
//
// Pure helpers live here (no DB). Persistence + materialize live in
// lib/opsRunRepo.ts so rules tests stay I/O-free.

export const OPS_DAYPARTS = ['open', 'prep', 'side_work', 'maintenance', 'sop'] as const;
export type OpsDaypart = (typeof OPS_DAYPARTS)[number];

export const OPS_STEP_STATUSES = ['todo', 'done', 'skipped'] as const;
export type OpsStepStatus = (typeof OPS_STEP_STATUSES)[number];

/** Kitchen-facing daypart labels (UI_COPY_RULES). */
export const OPS_DAYPART_LABEL: Record<OpsDaypart, string> = {
  open: 'Open',
  prep: 'Prep',
  side_work: 'Side work',
  maintenance: 'Gear',
  sop: 'House SOP',
};

export interface OpsTemplateStepSeed {
  step_key: string;
  title: string;
  detail?: string | null;
  due_time?: string | null; // HH:MM 24h wall-clock hint
  link_href?: string | null;
  link_label?: string | null;
  sort_order?: number;
}

export interface OpsTemplateSeed {
  daypart: OpsDaypart;
  title: string;
  sort_order: number;
  steps: OpsTemplateStepSeed[];
}

export interface OpsStepLike {
  daypart: string;
  step_key: string;
  title: string;
  status: string;
  due_time?: string | null;
  shift_date?: string;
}

export interface OpsRunRollup {
  todo: number;
  done: number;
  skipped: number;
  late: number;
  by_daypart: Record<OpsDaypart, { todo: number; done: number; late: number }>;
}

/** HH:MM or H:MM → minutes from midnight, or null if unparseable. */
export function parseDueMinutes(dueTime: string | null | undefined): number | null {
  if (!dueTime || typeof dueTime !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(dueTime.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }
  return h * 60 + min;
}

/**
 * A step is late when it is still open (todo), has a due_time, and
 * `nowMinutes` (minutes from local midnight) is past that due time.
 * Skipped / done are never late.
 */
export function isStepLate(
  step: Pick<OpsStepLike, 'status' | 'due_time'>,
  nowMinutes: number,
): boolean {
  if (step.status !== 'todo') return false;
  const due = parseDueMinutes(step.due_time);
  if (due == null) return false;
  return nowMinutes > due;
}

export function isOpsDaypart(v: unknown): v is OpsDaypart {
  return typeof v === 'string' && (OPS_DAYPARTS as readonly string[]).includes(v);
}

export function isOpsStepStatus(v: unknown): v is OpsStepStatus {
  return typeof v === 'string' && (OPS_STEP_STATUSES as readonly string[]).includes(v);
}

export function validateOpsStepInput(input: {
  daypart?: unknown;
  title?: unknown;
  step_key?: unknown;
  status?: unknown;
  due_time?: unknown;
}): { ok: true } | { ok: false; error: string } {
  if (input.daypart !== undefined && !isOpsDaypart(input.daypart)) {
    return { ok: false, error: 'daypart must be open, prep, side work, gear, or house SOP' };
  }
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) {
      return { ok: false, error: 'title required' };
    }
  }
  if (input.step_key !== undefined) {
    if (typeof input.step_key !== 'string' || !input.step_key.trim()) {
      return { ok: false, error: 'step key required' };
    }
  }
  if (input.status !== undefined && !isOpsStepStatus(input.status)) {
    return { ok: false, error: 'status must be todo, done, or skipped' };
  }
  if (input.due_time !== undefined && input.due_time !== null && input.due_time !== '') {
    if (parseDueMinutes(String(input.due_time)) == null) {
      return { ok: false, error: 'due time must look like 15:30' };
    }
  }
  return { ok: true };
}

export function rollupOpsSteps(
  steps: OpsStepLike[],
  nowMinutes: number,
): OpsRunRollup {
  const by_daypart = Object.fromEntries(
    OPS_DAYPARTS.map((d) => [d, { todo: 0, done: 0, late: 0 }]),
  ) as OpsRunRollup['by_daypart'];

  let todo = 0;
  let done = 0;
  let skipped = 0;
  let late = 0;

  for (const s of steps) {
    if (s.status === 'done') done += 1;
    else if (s.status === 'skipped') skipped += 1;
    else todo += 1;

    const lateNow = isStepLate(s, nowMinutes);
    if (lateNow) late += 1;

    if (isOpsDaypart(s.daypart)) {
      const bucket = by_daypart[s.daypart];
      if (s.status === 'done') bucket.done += 1;
      else if (s.status === 'todo') bucket.todo += 1;
      if (lateNow) bucket.late += 1;
    }
  }

  return { todo, done, skipped, late, by_daypart };
}

/** Alert copy — kitchen plain English. */
export function opsLateAlertMessage(lateCount: number): string {
  if (lateCount <= 0) return '';
  return lateCount === 1
    ? '1 day-plan step is late'
    : `${lateCount} day-plan steps are late`;
}

export function opsOpenAlertMessage(todoCount: number): string {
  if (todoCount <= 0) return '';
  return todoCount === 1
    ? '1 day-plan step still open'
    : `${todoCount} day-plan steps still open`;
}

/**
 * House default itinerary. Deep-links into existing boards — this is the
 * spine, not a second system of record for regulated checks.
 */
export function houseOpsTemplateSeeds(): OpsTemplateSeed[] {
  return [
    {
      daypart: 'open',
      title: 'Open the line',
      sort_order: 10,
      steps: [
        {
          step_key: 'open-temps',
          title: 'Temp the walk-in and holds',
          detail: 'Log every cold hold before doors.',
          due_time: '07:30',
          link_href: '/food-safety/temp-log',
          link_label: 'Temp log',
          sort_order: 10,
        },
        {
          step_key: 'open-sanitizer',
          title: 'Mix sanitizer wells',
          detail: '200 ppm — strip every well.',
          due_time: '07:45',
          link_href: '/food-safety/sanitizer',
          link_label: 'Sanitizer',
          sort_order: 20,
        },
        {
          step_key: 'open-line-checks',
          title: 'Run line checks — all stations',
          detail: 'Pass / fail / n/a, then sign off.',
          due_time: '08:00',
          link_href: '/stations',
          link_label: 'Stations',
          sort_order: 30,
        },
        {
          step_key: 'open-prep-pass',
          title: 'First pass on the prep board',
          detail: 'Claim rush items before mise pull.',
          due_time: '10:00',
          link_href: '/prep',
          link_label: 'Prep board',
          sort_order: 40,
        },
        {
          step_key: 'open-signoff',
          title: 'Pre-open sign-off',
          detail: 'Stations green before doors.',
          due_time: '10:45',
          link_href: '/',
          link_label: 'Today',
          sort_order: 50,
        },
      ],
    },
    {
      daypart: 'prep',
      title: 'Prep',
      sort_order: 20,
      steps: [
        {
          step_key: 'prep-mise',
          title: 'Pull mise from the walk-in',
          detail: 'Match the prep board — do not invent extras.',
          due_time: '09:00',
          link_href: '/prep',
          link_label: 'Prep board',
          sort_order: 10,
        },
        {
          step_key: 'prep-par',
          title: 'Check prep par',
          detail: 'Flag anything short for the next order.',
          due_time: '10:30',
          link_href: '/prep/par',
          link_label: 'Prep par',
          sort_order: 20,
        },
        {
          step_key: 'prep-beo',
          title: 'Check event prep',
          detail: 'Open BEO tasks for today and tomorrow.',
          due_time: '11:00',
          link_href: '/beo',
          link_label: 'BEO',
          sort_order: 30,
        },
      ],
    },
    {
      daypart: 'side_work',
      title: 'Side work — close',
      sort_order: 30,
      steps: [
        {
          step_key: 'close-tphc',
          title: 'TPHC discard check',
          detail: 'Toss anything past 4 hours — log it.',
          due_time: '22:30',
          link_href: '/food-safety/tphc',
          link_label: 'TPHC',
          sort_order: 10,
        },
        {
          step_key: 'close-cooling',
          title: 'Start cooling logs',
          detail: 'Two-stage into the log before you walk.',
          due_time: '23:00',
          link_href: '/food-safety/cooling',
          link_label: 'Cooling',
          sort_order: 20,
        },
        {
          step_key: 'close-datemarks',
          title: 'Date-mark holds for tomorrow',
          detail: 'Everything wrapped gets a day dot.',
          due_time: '23:15',
          link_href: '/food-safety/date-marks',
          link_label: 'Date marks',
          sort_order: 30,
        },
        {
          step_key: 'close-station-side',
          title: 'Station side work',
          detail: 'Teardown, wipe, drains, rag buckets, trash.',
          due_time: '23:30',
          link_href: '/food-safety/cleaning',
          link_label: 'Cleaning',
          sort_order: 40,
        },
        {
          step_key: 'close-cleaning-due',
          title: 'Finish cleaning due today',
          detail: 'Anything late goes red on the log.',
          due_time: '23:45',
          link_href: '/food-safety/cleaning',
          link_label: 'Cleaning',
          sort_order: 50,
        },
      ],
    },
    {
      daypart: 'maintenance',
      title: 'Gear',
      sort_order: 40,
      steps: [
        {
          step_key: 'maint-due-board',
          title: 'Walk gear due today',
          detail: 'Open the equipment board — log what you did.',
          due_time: '14:00',
          link_href: '/equipment',
          link_label: 'Equipment',
          sort_order: 10,
        },
      ],
    },
    {
      daypart: 'sop',
      title: 'House SOP',
      sort_order: 50,
      steps: [
        {
          step_key: 'sop-body-fluid-kit',
          title: 'Body-fluid kit in place',
          detail: 'Kit stocked and laminated SOP present.',
          due_time: '08:30',
          link_href: '/boh',
          link_label: 'Line book',
          sort_order: 10,
        },
        {
          step_key: 'sop-station-binder',
          title: 'Station open/close SOP clear',
          detail: 'If a step is wrong on paper, fix the binder.',
          due_time: '16:00',
          link_href: '/boh',
          link_label: 'Line book',
          sort_order: 20,
        },
      ],
    },
  ];
}
