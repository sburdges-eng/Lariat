// Per-station "tonight rollup" pure resolver (T7).
//
// Spec: docs/superpowers/specs/2026-05-04-beo-fire-times.md.
// No I/O — the route handler queries SQLite and hands the results in.
// This module owns the grouping/sorting + age-bucket helper so both the
// HTTP route and any future server-rendered version stay consistent.

export interface CourseRow {
  id: number;
  event_id: number;
  event_title: string;
  course_label: string;
  fire_at: string;          // canonical ISO-8601 UTC
  station_id: string | null; // null → "unassigned" bucket
}

export interface LineRow {
  id: number;
  event_id: number;
  course_id: number | null;
  item_name: string;
  quantity: number;
  prep_notes?: string | null;
  order_items_notes?: string | null;
}

export interface CourseWithLines {
  id: number;
  event_id: number;
  event_title: string;
  course_label: string;
  fire_at: string;
  lines: Array<Pick<LineRow, 'id' | 'item_name' | 'quantity' | 'prep_notes'>>;
}

export interface StationBucket {
  station_id: string;
  courses: CourseWithLines[];
}

export interface FireSchedulePayload {
  date: string;
  location_id: string;
  stations: StationBucket[];
}

const UNASSIGNED = 'unassigned';

/** Group courses by station and attach the bound line items.
 *  Stations are returned in alphabetical order (matches existing
 *  station-slug conventions: bar < grill < sides ...). */
export function resolveSchedule(
  date: string,
  locationId: string,
  courses: readonly CourseRow[],
  lines: readonly LineRow[],
): FireSchedulePayload {
  const linesByCourse = new Map<number, LineRow[]>();
  for (const l of lines) {
    if (l.course_id == null) continue;
    if (!linesByCourse.has(l.course_id)) linesByCourse.set(l.course_id, []);
    linesByCourse.get(l.course_id)!.push(l);
  }

  const buckets = new Map<string, CourseWithLines[]>();
  for (const c of courses) {
    const station = c.station_id ?? UNASSIGNED;
    if (!buckets.has(station)) buckets.set(station, []);
    buckets.get(station)!.push({
      id: c.id,
      event_id: c.event_id,
      event_title: c.event_title,
      course_label: c.course_label,
      fire_at: c.fire_at,
      lines: (linesByCourse.get(c.id) ?? []).map((l) => ({
        id: l.id,
        item_name: l.item_name,
        quantity: l.quantity,
        prep_notes: l.prep_notes ?? null,
      })),
    });
  }

  // Within each station, sort courses chronologically by fire_at; ties
  // broken by event_id (deterministic) then course id.
  for (const arr of buckets.values()) {
    arr.sort(
      (a, b) =>
        Date.parse(a.fire_at) - Date.parse(b.fire_at) ||
        a.event_id - b.event_id ||
        a.id - b.id,
    );
  }

  // Stations: alphabetical, with 'unassigned' last.
  const stationKeys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === UNASSIGNED) return 1;
    if (b === UNASSIGNED) return -1;
    return a.localeCompare(b);
  });

  return {
    date,
    location_id: locationId,
    stations: stationKeys.map((k) => ({ station_id: k, courses: buckets.get(k)! })),
  };
}

/** Age bucket for the UI's color-coding helper (T8).
 *  - 'green'  : > 30 minutes until fire_at
 *  - 'yellow' : ≤ 30 minutes and not yet past
 *  - 'red'    : on or past fire_at (overdue)
 *
 *  Threshold mirrors the v1 KDS protocol §2 age-coloring convention so a
 *  cook who looks at both surfaces sees consistent color semantics.
 */
export type AgeBucket = 'green' | 'yellow' | 'red';

export const YELLOW_THRESHOLD_MS = 30 * 60_000;

export function ageBucketFor(fire_at: string, now: Date = new Date()): AgeBucket {
  const fireMs = Date.parse(fire_at);
  if (!Number.isFinite(fireMs)) return 'red'; // fail-closed
  const delta = fireMs - now.getTime();
  if (delta <= 0) return 'red';
  if (delta <= YELLOW_THRESHOLD_MS) return 'yellow';
  return 'green';
}
