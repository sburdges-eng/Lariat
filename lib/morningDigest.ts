import { getDb } from './db.ts';
import { summarize, alertsFor, type CommandAlert, type CommandSummary } from './commandCenter.ts';
import { listPriceShocks, type PriceShockRow } from './vendorPricesRepo.ts';

export interface MorningDigestEightySixItem {
  item: string;
  reason: string | null;
  quantity: string | null;
  station_id: string | null;
  created_at: string | null;
}

export interface MorningDigestCertItem {
  cook_id: string;
  cert_label: string;
  cert_type: string;
  expires_on: string;
  days_until: number;
}

export interface MorningDigestMaintenanceItem {
  equipment_name: string;
  task: string;
  frequency: string;
  next_due: string;
  days_until: number;
}

export interface MorningDigestBeoPrepItem {
  event_id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;
  guest_count: number;
  open_tasks: number;
  done_tasks: number;
  total_tasks: number;
}

export interface MorningDigestSection<T> {
  count: number;
  items: T[];
}

export interface MorningDigest {
  shift_date: string;
  location_id: string;
  generated_at: string;
  summary: CommandSummary;
  alerts: CommandAlert[];
  eighty_six: MorningDigestSection<MorningDigestEightySixItem>;
  price_shocks: MorningDigestSection<PriceShockRow>;
  certs_expiring_week: MorningDigestSection<MorningDigestCertItem>;
  maintenance_due: MorningDigestSection<MorningDigestMaintenanceItem>;
  beo_prep: MorningDigestSection<MorningDigestBeoPrepItem>;
  webhook: {
    text: string;
  };
}

function toStartOfDayMs(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getTime();
}

function daysBetween(baseIsoDate: string, targetIsoDate: string): number {
  return Math.floor((toStartOfDayMs(targetIsoDate) - toStartOfDayMs(baseIsoDate)) / 86400000);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const value = Number(n);
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatSlackText(digest: Omit<MorningDigest, 'webhook'>): string {
  const lines = [
    `Morning digest · ${digest.shift_date}`,
    `86 board: ${plural(digest.eighty_six.count, 'item', 'items')}`,
    `Price shocks: ${plural(digest.price_shocks.count, 'item', 'items')}`,
    `Certs this week: ${plural(digest.certs_expiring_week.count, 'cert', 'certs')}`,
    `Maintenance due: ${plural(digest.maintenance_due.count, 'task', 'tasks')}`,
    `BEO prep: ${plural(digest.beo_prep.count, 'event', 'events')}`,
  ];

  if (digest.eighty_six.items[0]) {
    const top = digest.eighty_six.items.slice(0, 3).map((row) => row.item).join(', ');
    lines.push(`86 details: ${top}`);
  }
  if (digest.price_shocks.items[0]) {
    const top = digest.price_shocks.items
      .slice(0, 3)
      .map((row) => `${row.ingredient} ${fmtPct(row.delta_pct)}`)
      .join(', ');
    lines.push(`Price details: ${top}`);
  }
  if (digest.certs_expiring_week.items[0]) {
    const top = digest.certs_expiring_week.items
      .slice(0, 3)
      .map((row) => `${row.cook_id} ${row.expires_on}`)
      .join(', ');
    lines.push(`Cert details: ${top}`);
  }
  if (digest.maintenance_due.items[0]) {
    const top = digest.maintenance_due.items
      .slice(0, 3)
      .map((row) => `${row.equipment_name} · ${row.task}`)
      .join(', ');
    lines.push(`Maintenance details: ${top}`);
  }
  if (digest.beo_prep.items[0]) {
    const top = digest.beo_prep.items
      .slice(0, 3)
      .map((row) => `${row.title} (${row.open_tasks} open)`)
      .join(', ');
    lines.push(`BEO details: ${top}`);
  }

  if (digest.alerts[0]) {
    lines.push(`Heads-up: ${digest.alerts.slice(0, 3).map((a) => a.message).join(' | ')}`);
  }

  return lines.join('\n');
}

export function buildMorningDigest(locationId: string, today: string): MorningDigest {
  const db = getDb();
  const summary = summarize(locationId, today);
  const alerts = alertsFor(summary);

  const eightySixItems = db
    .prepare(
      `SELECT item, reason, quantity, station_id, created_at
         FROM eighty_six
        WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL
        ORDER BY id DESC
        LIMIT 10`,
    )
    .all(locationId, today) as MorningDigestEightySixItem[];
  const eightySixCount = (db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM eighty_six
        WHERE location_id = ? AND shift_date = ? AND resolved_at IS NULL`,
    )
    .get(locationId, today) as { c: number }).c;

  const priceShockItems = listPriceShocks(db, {
    location_id: locationId,
    windowDays: 7,
    minPctMove: 5,
    limit: 10,
  });

  const certRows = db
    .prepare(
      `SELECT cook_id, cert_label, cert_type, expires_on
         FROM staff_certifications
        WHERE location_id = ?
          AND active = 1
          AND expires_on IS NOT NULL
        ORDER BY expires_on ASC, cook_id ASC`,
    )
    .all(locationId) as Array<{
    cook_id: string;
    cert_label: string;
    cert_type: string;
    expires_on: string;
  }>;
  const certItems = certRows
    .map((row) => ({
      ...row,
      days_until: daysBetween(today, row.expires_on),
    }))
    .filter((row) => row.days_until >= 0 && row.days_until <= 7)
    .slice(0, 10);

  const maintenanceRows = db
    .prepare(
      `SELECT e.name AS equipment_name, s.task, s.frequency, s.next_due
         FROM equipment_maintenance_schedule s
         JOIN equipment e ON e.id = s.equipment_id
        WHERE s.location_id = ?
          AND e.location_id = ?
          AND s.next_due IS NOT NULL
        ORDER BY s.next_due ASC, e.name ASC`,
    )
    .all(locationId, locationId) as Array<{
    equipment_name: string;
    task: string;
    frequency: string;
    next_due: string;
  }>;
  const maintenanceItems = maintenanceRows
    .map((row) => ({
      ...row,
      days_until: daysBetween(today, row.next_due),
    }))
    .filter((row) => row.days_until <= 0)
    .slice(0, 10);

  const beoItems = db
    .prepare(
      `SELECT e.id AS event_id,
              e.title,
              e.event_date,
              e.event_time,
              COALESCE(e.guest_count, 0) AS guest_count,
              SUM(CASE WHEN COALESCE(t.done, 0) = 0 THEN 1 ELSE 0 END) AS open_tasks,
              SUM(CASE WHEN COALESCE(t.done, 0) = 1 THEN 1 ELSE 0 END) AS done_tasks,
              COUNT(t.id) AS total_tasks
         FROM beo_events e
         LEFT JOIN beo_prep_tasks t
           ON t.event_id = e.id
          AND t.location_id = e.location_id
        WHERE e.location_id = ?
          AND e.event_date >= ?
          AND COALESCE(e.status, '') NOT IN ('cancelled', 'canceled')
        GROUP BY e.id, e.title, e.event_date, e.event_time, e.guest_count
       HAVING SUM(CASE WHEN COALESCE(t.done, 0) = 0 THEN 1 ELSE 0 END) > 0
        ORDER BY e.event_date ASC, COALESCE(e.event_time, '00:00') ASC
        LIMIT 10`,
    )
    .all(locationId, today) as MorningDigestBeoPrepItem[];
  const beoCount = beoItems.length;

  const generated_at = new Date().toISOString();
  const digestCore = {
    shift_date: today,
    location_id: locationId,
    generated_at,
    summary,
    alerts,
    eighty_six: { count: eightySixCount, items: eightySixItems },
    price_shocks: { count: priceShockItems.length, items: priceShockItems },
    certs_expiring_week: { count: certItems.length, items: certItems },
    maintenance_due: { count: maintenanceItems.length, items: maintenanceItems },
    beo_prep: { count: beoCount, items: beoItems },
  };

  return {
    ...digestCore,
    webhook: {
      text: formatSlackText(digestCore),
    },
  };
}
