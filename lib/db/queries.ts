/**
 * Small shared read helpers that don't belong to a feature-specific
 * lib module. Anything larger lives in its own lib/ module.
 */
import { getDb } from './connection.ts';
import type { PreshiftNote, ServiceHoursRow } from './types.ts';

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Return all active service-hour rows for a location, ordered Sun→Sat.
 * A day with no row is closed.
 */
export function getServiceHours(locationId = 'default'): ServiceHoursRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM service_hours
        WHERE location_id = ? AND active = 1
        ORDER BY day_of_week, service_label`,
    )
    .all(locationId) as ServiceHoursRow[];
}

/**
 * Today's primary service label for a location, derived from
 * service_hours. Returns null when nothing is scheduled (prep day).
 * If multiple services exist on the same day, the one opening first
 * wins.
 *
 * `at` exists so tests can pin the day; the day-of-week is taken from
 * the process-local clock either way, which matches production where
 * the server runs at the venue.
 */
export function todayServiceLabel(locationId = 'default', at: Date = new Date()): string | null {
  const dow = at.getDay();
  const row = getDb()
    .prepare(
      `SELECT service_label FROM service_hours
        WHERE location_id = ? AND active = 1 AND day_of_week = ?
        ORDER BY opens_at ASC NULLS LAST LIMIT 1`,
    )
    .get(locationId, dow) as { service_label: string | null } | undefined;
  return row?.service_label ?? null;
}

/**
 * Get the current pre-shift note for the given date + service slot,
 * or null if none exists. A NULL service_label means a prep-day note.
 */
export function getPreshiftNote(
  locationId: string,
  shiftDate: string,
  serviceLabel: string | null,
): PreshiftNote | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM preshift_notes
        WHERE location_id = ? AND shift_date = ?
          AND (service_label IS ? OR service_label = ?)
        LIMIT 1`,
    )
    .get(locationId, shiftDate, serviceLabel, serviceLabel) as PreshiftNote | undefined;
  return row ?? null;
}
