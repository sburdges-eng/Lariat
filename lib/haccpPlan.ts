// HACCP plan generator — roadmap 3.7.
//
// Assembles a health-inspector-ready snapshot of the venue's food-safety
// program from data that already lives in the local DB:
//
//   - CCP inventory: the temp points the kitchen monitors (lib/tempLog.ts)
//     plus two-stage cooling (lib/cooling.ts), each with its FDA Food Code
//     citation and a last-30-days monitoring count as evidence.
//   - Rule-module inventory: the non-CCP food-safety programs (receiving,
//     date marking, TPHC, sanitizer, cleaning, employee health, pest
//     control, SDS) with citations and record counts.
//   - Corrective-action log: last 30 days, merged from temp_log and
//     line_check_entries via lib/correctiveActions.ts.
//   - Calibration log: last 30 days of thermometer calibrations plus the
//     current per-probe status board via lib/calibrations.ts.
//
// READ-ONLY over existing tables — no schema changes, no writes. The
// printable page at /food-safety/haccp-plan renders this object; the JSON
// API at /api/food-safety/haccp-plan serves it raw.

import { getDb } from './db.ts';
import { TempPoints } from './tempLog.ts';
import {
  STAGE1_CEILING_F,
  STAGE2_CEILING_F,
  STAGE1_MAX_MINUTES,
  STAGE2_MAX_MINUTES,
} from './cooling.ts';
import {
  mergeCorrectiveActions,
  CORRECTIVE_ACTION_CITATION,
  type CorrectiveActionEntry,
  type TempLogCorrectiveRow,
  type LineCheckCorrectiveRow,
} from './correctiveActions.ts';
import {
  classifyProbes,
  validateCalibrationReading,
  DEFAULT_FREQUENCY_DAYS,
  type CalibrationRow,
  type ProbeSummary,
} from './calibrations.ts';
import { CLEANING_CITATION } from './cleaning.ts';
import { PEST_CITATION } from './pestControl.ts';
import { SDS_CITATION } from './sds.ts';
import { TPHC_HOT_HOURS, TPHC_COLD_HOURS } from './tphc.ts';

// ── Row shapes ─────────────────────────────────────────────────────

/** One monitored CCP temp point with 30-day evidence counts. */
export interface HaccpPlanCcp {
  point_id: string;
  label: string;
  ccp_id: string;
  required_min_f: number | null;
  required_max_f: number | null;
  citation: string;
  /** temp_log rows for this point in the window. */
  logs_30d: number;
  /** Of those, rows that carried a corrective action. */
  corrective_30d: number;
}

/** Two-stage cooling (CCP-8) — time-based, summarized separately. */
export interface HaccpCoolingSummary {
  ccp_id: 'CCP-8';
  citation: string;
  batches_30d: number;
  breaches_30d: number;
  /** Batches still between started_at and stage2_at right now. */
  open_now: number;
}

/** A non-CCP food-safety program with its citation and evidence count. */
export interface HaccpRuleModule {
  id: string;
  name: string;
  citation: string;
  /** Rows counted per `evidence_label` (window logs or current registry). */
  records: number;
  /** What `records` counts, e.g. "entries in last 30 days". */
  evidence_label: string;
  /** True when at least one record exists. */
  active: boolean;
}

/** One thermometer-calibration row from the window. */
export interface HaccpCalibrationRecord {
  id: number;
  thermometer_id: string;
  method: string;
  before_reading_f: number | null;
  after_reading_f: number | null;
  passed: boolean;
  action_taken: string | null;
  cook_id: string | null;
  calibrated_at: string;
}

export interface HaccpCorrectiveSection {
  citation: string;
  count: number;
  entries: CorrectiveActionEntry[];
}

export interface HaccpCalibrationSection {
  citation: string;
  frequency_days_default: number;
  records: HaccpCalibrationRecord[];
  /** Current per-probe status board (all history, not just the window). */
  probes: ProbeSummary[];
}

export interface HaccpPlan {
  location_id: string;
  /** Date the plan covers through (YYYY-MM-DD). */
  plan_date: string;
  /** First date included in the 30-day evidence window. */
  window_start: string;
  window_days: number;
  generated_at: string;
  ccps: HaccpPlanCcp[];
  cooling: HaccpCoolingSummary;
  rule_modules: HaccpRuleModule[];
  corrective_actions: HaccpCorrectiveSection;
  calibrations: HaccpCalibrationSection;
}

// ── Date helpers ───────────────────────────────────────────────────

const WINDOW_DAYS = 30;

function isoMinusDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ── Citations assembled from the rule modules ──────────────────────

const COOLING_CITATION =
  `FDA §3-501.14 — two-stage cooling: 135→${STAGE1_CEILING_F}°F within ` +
  `${STAGE1_MAX_MINUTES / 60} h, then to ${STAGE2_CEILING_F}°F within ` +
  `${STAGE2_MAX_MINUTES / 60} h more`;

// lib/calibrations.ts keeps its citation on the validation result rather
// than as an exported constant — pull it from a known-pass reading so the
// plan never drifts from the rule module's wording.
const CALIBRATION_CITATION = validateCalibrationReading({
  method: 'ice_point',
  reading_f: 32,
}).citation;

const TPHC_CITATION =
  `FDA §3-501.19 — time as a public health control: hot ${TPHC_HOT_HOURS} h / ` +
  `cold ${TPHC_COLD_HOURS} h caps`;

// ── Plan assembly ──────────────────────────────────────────────────

export function buildHaccpPlan(locationId: string, today: string): HaccpPlan {
  const db = getDb();
  const windowStart = isoMinusDays(today, WINDOW_DAYS);

  // CCP inventory + per-point monitoring evidence.
  const tempCounts = db
    .prepare(
      `SELECT point_id,
              COUNT(*) AS logs,
              SUM(CASE WHEN corrective_action IS NOT NULL
                        AND TRIM(corrective_action) != '' THEN 1 ELSE 0 END) AS corrective
         FROM temp_log
        WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
        GROUP BY point_id`,
    )
    .all(locationId, windowStart, today) as Array<{
    point_id: string;
    logs: number;
    corrective: number;
  }>;
  const countByPoint = new Map(tempCounts.map((r) => [r.point_id, r]));

  const ccps: HaccpPlanCcp[] = TempPoints.map((p) => {
    const c = countByPoint.get(p.id);
    return {
      point_id: p.id,
      label: p.label,
      ccp_id: p.ccp_id,
      required_min_f: p.required_min_f,
      required_max_f: p.required_max_f,
      citation: p.citation,
      logs_30d: c ? Number(c.logs) : 0,
      corrective_30d: c ? Number(c.corrective) : 0,
    };
  });

  // Cooling (CCP-8) summary.
  const coolingRow = db
    .prepare(
      `SELECT COUNT(*) AS batches,
              SUM(CASE WHEN status = 'breach' THEN 1 ELSE 0 END) AS breaches,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS open_now
         FROM cooling_log
        WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?`,
    )
    .get(locationId, windowStart, today) as {
    batches: number;
    breaches: number | null;
    open_now: number | null;
  };
  const cooling: HaccpCoolingSummary = {
    ccp_id: 'CCP-8',
    citation: COOLING_CITATION,
    batches_30d: Number(coolingRow.batches) || 0,
    breaches_30d: Number(coolingRow.breaches) || 0,
    open_now: Number(coolingRow.open_now) || 0,
  };

  // Rule-module inventory. Each count is location-scoped; date-windowed
  // tables use their date column, the SDS registry counts active sheets.
  const countWindow = (table: string, dateCol: string): number => {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM ${table}
          WHERE location_id = ? AND ${dateCol} >= ? AND ${dateCol} <= ?`,
      )
      .get(locationId, windowStart, today) as { c: number };
    return Number(row.c) || 0;
  };
  const sdsActive = (db
    .prepare(`SELECT COUNT(*) AS c FROM sds_registry WHERE location_id = ? AND active = 1`)
    .get(locationId) as { c: number }).c;

  const windowLabel = `entries in last ${WINDOW_DAYS} days`;
  const moduleDefs: Array<Omit<HaccpRuleModule, 'active'>> = [
    {
      id: 'receiving',
      name: 'Receiving',
      citation: 'FDA §3-202.11 — receiving temperatures; §3-202.15 — package integrity',
      records: countWindow('receiving_log', 'shift_date'),
      evidence_label: windowLabel,
    },
    {
      id: 'date_marking',
      name: 'Date marking',
      citation: 'FDA §3-501.17 — RTE TCS food held >24 h discarded within 7 days (prep day = day 1)',
      records: countWindow('date_marks', 'prepared_on'),
      evidence_label: `batches marked in last ${WINDOW_DAYS} days`,
    },
    {
      id: 'tphc',
      name: 'Time as a public health control',
      citation: TPHC_CITATION,
      records: countWindow('tphc_entries', 'shift_date'),
      evidence_label: windowLabel,
    },
    {
      id: 'sanitizer',
      name: 'Sanitizer checks',
      citation: 'FDA §4-703.11 — sanitizing food-contact surfaces (chemistry-specific ppm bands)',
      records: countWindow('sanitizer_checks', 'shift_date'),
      evidence_label: `checks in last ${WINDOW_DAYS} days`,
    },
    {
      id: 'cleaning',
      name: 'Cleaning log',
      citation: CLEANING_CITATION,
      records: countWindow('cleaning_log', 'shift_date'),
      evidence_label: `completions in last ${WINDOW_DAYS} days`,
    },
    {
      id: 'sick_worker',
      name: 'Employee health',
      citation: 'FDA §2-201.11 — reportable symptoms and Big-6 diagnoses; exclude or restrict',
      records: countWindow('sick_worker_reports', 'shift_date'),
      evidence_label: `reports in last ${WINDOW_DAYS} days`,
    },
    {
      id: 'pest_control',
      name: 'Pest control',
      citation: PEST_CITATION,
      records: countWindow('pest_control_log', 'shift_date'),
      evidence_label: windowLabel,
    },
    {
      id: 'sds',
      name: 'Safety Data Sheets',
      citation: SDS_CITATION,
      records: Number(sdsActive) || 0,
      evidence_label: 'active sheets on file',
    },
  ];
  const rule_modules: HaccpRuleModule[] = moduleDefs.map((m) => ({
    ...m,
    active: m.records > 0,
  }));

  // Corrective-action log — same two sources as /api/corrective-actions,
  // widened from a single shift_date to the 30-day window.
  const tempLogRows = db
    .prepare(
      `SELECT id, shift_date, point_id, corrective_action, cook_id, created_at
         FROM temp_log
        WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
          AND corrective_action IS NOT NULL AND TRIM(corrective_action) != ''
        ORDER BY created_at DESC`,
    )
    .all(locationId, windowStart, today) as TempLogCorrectiveRow[];
  const lineCheckRows = db
    .prepare(
      `SELECT id, shift_date, station_id, item, note, cook_id, created_at
         FROM line_check_entries
        WHERE location_id = ? AND shift_date >= ? AND shift_date <= ?
          AND status = 'fail' AND note IS NOT NULL AND TRIM(note) != ''
        ORDER BY created_at DESC`,
    )
    .all(locationId, windowStart, today) as LineCheckCorrectiveRow[];
  const correctiveEntries = mergeCorrectiveActions(tempLogRows, lineCheckRows);

  // Calibration log (window) + current probe status board (all history).
  const calibrationRecords = db
    .prepare(
      `SELECT id, thermometer_id, method, before_reading_f, after_reading_f,
              passed, action_taken, cook_id, calibrated_at
         FROM thermometer_calibrations
        WHERE location_id = ?
          AND substr(calibrated_at, 1, 10) >= ? AND substr(calibrated_at, 1, 10) <= ?
        ORDER BY calibrated_at DESC, id DESC`,
    )
    .all(locationId, windowStart, today) as Array<{
    id: number;
    thermometer_id: string;
    method: string;
    before_reading_f: number | null;
    after_reading_f: number | null;
    passed: number;
    action_taken: string | null;
    cook_id: string | null;
    calibrated_at: string;
  }>;

  const allCalibrationRows = db
    .prepare(
      `SELECT thermometer_id, method, before_reading_f, passed, calibrated_at, frequency_days
         FROM thermometer_calibrations
        WHERE location_id = ?`,
    )
    .all(locationId) as CalibrationRow[];
  // Evaluate probe status at end of plan_date so the plan is reproducible
  // for a given (location, date) pair.
  const probes = classifyProbes(allCalibrationRows, {
    now: new Date(`${today}T23:59:59Z`),
  });

  return {
    location_id: locationId,
    plan_date: today,
    window_start: windowStart,
    window_days: WINDOW_DAYS,
    generated_at: new Date().toISOString(),
    ccps,
    cooling,
    rule_modules,
    corrective_actions: {
      citation: CORRECTIVE_ACTION_CITATION,
      count: correctiveEntries.length,
      entries: correctiveEntries,
    },
    calibrations: {
      citation: CALIBRATION_CITATION,
      frequency_days_default: DEFAULT_FREQUENCY_DAYS,
      records: calibrationRecords.map((r) => ({
        id: Number(r.id),
        thermometer_id: r.thermometer_id,
        method: r.method,
        before_reading_f: r.before_reading_f,
        after_reading_f: r.after_reading_f,
        passed: r.passed === 1,
        action_taken: r.action_taken,
        cook_id: r.cook_id,
        calibrated_at: r.calibrated_at,
      })),
      probes,
    },
  };
}
