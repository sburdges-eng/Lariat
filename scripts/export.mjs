#!/usr/bin/env node
// Export today's line check data + signoffs + 86s + inventory updates
// from SQLite to a real .xlsx workbook in exports/.
// Run: npm run export [YYYY-MM-DD]

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'data', 'lariat.db');
const OUT = path.join(ROOT, 'exports');

if (!fs.existsSync(DB)) {
  console.error('No database yet — run the app first.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const db = new Database(DB, { readonly: true });

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
// Audit F7 (2026-05-16): LARIAT_EXPORT_LOCATION still wins (purpose-specific
// override). After that, prefer canonical LARIAT_LOCATION_ID, then the legacy
// LARIAT_LOCATION (warned).
const loc = (
  process.env.LARIAT_EXPORT_LOCATION ||
  process.env.LARIAT_LOCATION_ID ||
  process.env.LARIAT_LOCATION ||
  'default'
).trim();
if (
  !process.env.LARIAT_EXPORT_LOCATION &&
  !process.env.LARIAT_LOCATION_ID &&
  process.env.LARIAT_LOCATION
) {
  console.warn('[export] LARIAT_LOCATION is deprecated — rename to LARIAT_LOCATION_ID.');
}

const checks = db.prepare(`
  SELECT shift_date, station_id, item, status, par, have, need, note, cook_id, created_at, location_id
  FROM line_check_entries WHERE shift_date = ? AND location_id = ? ORDER BY station_id, item, id
`).all(date, loc);

const signoffs = db.prepare(`
  SELECT shift_date, station_id, cook_id, signoff_type, created_at, location_id
  FROM station_signoffs WHERE shift_date = ? AND location_id = ? ORDER BY station_id, id
`).all(date, loc);

const eightySix = db.prepare(`
  SELECT shift_date, station_id, item, kind, reason, quantity, cook_id, created_at, resolved_at, resolved_by, location_id
  FROM eighty_six WHERE shift_date = ? AND location_id = ? ORDER BY id
`).all(date, loc);

const inventory = db.prepare(`
  SELECT shift_date, station_id, item, delta, direction, note, cook_id, created_at, location_id
  FROM inventory_updates WHERE shift_date = ? AND location_id = ? ORDER BY id
`).all(date, loc);

// ── HACCP + CO/federal compliance surfaces ─────────────────────────
//
// These are the tables an inspector would ask for on a surprise visit.
// If a table doesn't exist yet (older DB schema), we silently skip it
// so the export keeps working on partial deploys. `tryAll` returns
// [] on a missing table or column.
function tryAll(sql, ...args) {
  try {
    return db.prepare(sql).all(...args);
  } catch (err) {
    if (/no such (table|column)/.test(String(err?.message))) return [];
    throw err;
  }
}

const tempLog = tryAll(`
  SELECT shift_date, point_id, reading_f, required_min_f, required_max_f,
         corrective_action, cook_id, created_at, location_id
  FROM temp_log WHERE shift_date = ? AND location_id = ? ORDER BY point_id, id
`, date, loc);

// Cooling log: include today's started batches AND anything still open
// regardless of date — a 4-hour breach that started yesterday is the
// inspector's question today.
const coolingLog = tryAll(`
  SELECT shift_date, item, station_id, started_at, start_reading_f,
         stage1_at, stage1_reading_f, stage2_at, stage2_reading_f,
         status, breach_reason, corrective_action,
         cook_id, closed_by_cook_id, created_at, location_id
  FROM cooling_log
  WHERE location_id = ?
    AND (shift_date = ? OR status = 'in_progress')
  ORDER BY started_at, id
`, loc, date);

// Date marks: active (un-discarded) batches AND anything discarded on this
// date. The inspector wants to see both the "what's in the walk-in right
// now" evidence and the "what did you toss today" evidence.
const dateMarks = tryAll(`
  SELECT item, batch_ref, prepared_on, discard_on,
         discarded_at, discarded_by_cook_id, discard_reason,
         cook_id, created_at, location_id
  FROM date_marks
  WHERE location_id = ?
    AND (discarded_at IS NULL OR substr(discarded_at, 1, 10) = ?)
  ORDER BY (discarded_at IS NULL) DESC, discard_on, id
`, loc, date);

const sanitizerChecks = tryAll(`
  SELECT shift_date, station_id, point_label, chemistry, concentration_ppm,
         required_min_ppm, required_max_ppm, water_temp_f, status,
         corrective_action, cook_id, created_at, location_id
  FROM sanitizer_checks WHERE shift_date = ? AND location_id = ? ORDER BY point_label, id
`, date, loc);

// Sick worker: all currently-active exclusions/restrictions (return_at
// IS NULL) regardless of start date, PLUS any closed this date.
const sickWorker = tryAll(`
  SELECT shift_date, cook_id, reported_by_pic_id, symptoms,
         diagnosed_illness, action, started_at, return_at,
         clearance_source, note, created_at, location_id
  FROM sick_worker_reports
  WHERE location_id = ?
    AND (return_at IS NULL OR substr(return_at, 1, 10) = ? OR shift_date = ?)
  ORDER BY (return_at IS NULL) DESC, started_at DESC, id
`, loc, date, date);

const receivingLog = tryAll(`
  SELECT shift_date, vendor, invoice_ref, category, item, reading_f,
         required_max_f, package_ok, expiration_date, status,
         rejection_reason, shellstock_tag_ref,
         cook_id, created_at, location_id
  FROM receiving_log WHERE shift_date = ? AND location_id = ? ORDER BY id
`, date, loc);

const cleaningLog = tryAll(`
  SELECT shift_date, schedule_id, area, task, completed_at,
         cook_id, verified_by_cook_id, notes, created_at, location_id
  FROM cleaning_log WHERE shift_date = ? AND location_id = ? ORDER BY completed_at, id
`, date, loc);

const pestLog = tryAll(`
  SELECT shift_date, entry_type, vendor, technician, findings,
         pest, severity, corrective_action, report_path, cook_id,
         created_at, location_id
  FROM pest_control_log WHERE shift_date = ? AND location_id = ? ORDER BY id
`, date, loc);

// Thermometer calibrations: most-recent-per-probe up to today (rolling 90d).
const thermCal = tryAll(`
  SELECT thermometer_id, method, before_reading_f, after_reading_f,
         passed, action_taken, cook_id, calibrated_at, created_at, location_id
  FROM thermometer_calibrations
  WHERE location_id = ?
    AND calibrated_at >= date(?, '-90 day')
  ORDER BY thermometer_id, calibrated_at DESC, id DESC
`, loc, date);

const tphc = tryAll(`
  SELECT shift_date, station_id, item, batch_ref, started_at,
         cutoff_at, discarded_at, discard_reason, cook_id,
         created_at, location_id
  FROM tphc_entries
  WHERE location_id = ?
    AND (shift_date = ? OR discarded_at IS NULL)
  ORDER BY cutoff_at, id
`, loc, date);

const shiftPic = tryAll(`
  SELECT shift_date, shift_slot, cook_id, cfpm_cert_id,
         started_at, ended_at, note, created_at, location_id
  FROM shift_pic WHERE shift_date = ? AND location_id = ? ORDER BY started_at, id
`, date, loc);

// Labor: shift breaks for the day (compliance evidence for COMPS #39)
const shiftBreaks = tryAll(`
  SELECT shift_date, cook_id, kind, started_at, ended_at,
         duration_min, waived, waiver_ref, note, created_at, location_id
  FROM shift_breaks WHERE shift_date = ? AND location_id = ? ORDER BY cook_id, started_at, id
`, date, loc);

const performanceReviews = tryAll(`
  SELECT cook_name, review_date, punctuality_score, technique_score,
         speed_score, notes, reviewer_name, created_at, location_id
  FROM performance_reviews WHERE review_date = ? AND location_id = ? ORDER BY cook_name, id
`, date, loc);

// Registries (no date filter) — snapshot of active state.
const staffCerts = tryAll(`
  SELECT cook_id, cert_type, cert_label, issuer, cert_number,
         issued_on, expires_on, document_path, active,
         created_at, updated_at, location_id
  FROM staff_certifications WHERE location_id = ? AND active = 1
  ORDER BY expires_on IS NULL, expires_on ASC, id
`, loc);

const sds = tryAll(`
  SELECT product_name, manufacturer, hazard_class, storage_location,
         pdf_path, url, last_reviewed, active, notes, created_at, location_id
  FROM sds_registry WHERE location_id = ? AND active = 1
  ORDER BY product_name, id
`, loc);

// Audit events for this date — the append-only trail.
const auditEvents = tryAll(`
  SELECT shift_date, actor_cook_id, actor_source, entity, entity_id,
         action, replaces_id, note, created_at, location_id
  FROM audit_events WHERE shift_date = ? AND location_id = ? ORDER BY id
`, date, loc);

// Always also write CSV fallbacks (cheap, useful for grep/csvkit)
function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v);
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
fs.writeFileSync(path.join(OUT, `line_checks_${date}.csv`), csv(checks));
fs.writeFileSync(path.join(OUT, `signoffs_${date}.csv`), csv(signoffs));
fs.writeFileSync(path.join(OUT, `eighty_six_${date}.csv`), csv(eightySix));
fs.writeFileSync(path.join(OUT, `inventory_${date}.csv`), csv(inventory));
// Compliance CSVs — one per surface so grep/csvkit and diff-on-change
// both work. Empty sets write zero-byte files rather than missing ones
// so the filename list is stable.
fs.writeFileSync(path.join(OUT, `temp_log_${date}.csv`), csv(tempLog));
fs.writeFileSync(path.join(OUT, `cooling_${date}.csv`), csv(coolingLog));
fs.writeFileSync(path.join(OUT, `date_marks_${date}.csv`), csv(dateMarks));
fs.writeFileSync(path.join(OUT, `sanitizer_${date}.csv`), csv(sanitizerChecks));
fs.writeFileSync(path.join(OUT, `sick_worker_${date}.csv`), csv(sickWorker));
fs.writeFileSync(path.join(OUT, `receiving_${date}.csv`), csv(receivingLog));
fs.writeFileSync(path.join(OUT, `cleaning_${date}.csv`), csv(cleaningLog));
fs.writeFileSync(path.join(OUT, `pest_${date}.csv`), csv(pestLog));
fs.writeFileSync(path.join(OUT, `thermometer_cal_${date}.csv`), csv(thermCal));
fs.writeFileSync(path.join(OUT, `tphc_${date}.csv`), csv(tphc));
fs.writeFileSync(path.join(OUT, `shift_pic_${date}.csv`), csv(shiftPic));
fs.writeFileSync(path.join(OUT, `shift_breaks_${date}.csv`), csv(shiftBreaks));
fs.writeFileSync(path.join(OUT, `performance_reviews_${date}.csv`), csv(performanceReviews));
fs.writeFileSync(path.join(OUT, `staff_certs_${date}.csv`), csv(staffCerts));
fs.writeFileSync(path.join(OUT, `sds_${date}.csv`), csv(sds));
fs.writeFileSync(path.join(OUT, `audit_events_${date}.csv`), csv(auditEvents));

const xlsxOut = path.join(OUT, `lariat_${date}.xlsx`);
// NOTE: Excel caps sheet titles at 31 chars — keep names short.
// Order matters: ops-floor surfaces first, labor next, then registries,
// then the audit trail at the very end (it's the longest tab and the
// least-used day-to-day).
const payload = {
  out: xlsxOut,
  date,
  sheets: {
    'Line Checks': checks,
    'Sign-offs': signoffs,
    '86 Board': eightySix,
    'Inventory': inventory,
    'Temp Log': tempLog,
    'Cooling': coolingLog,
    'Date Marks': dateMarks,
    'Sanitizer': sanitizerChecks,
    'Sick Worker': sickWorker,
    'Receiving': receivingLog,
    'Cleaning': cleaningLog,
    'Pest Control': pestLog,
    'Thermometer Cal': thermCal,
    'TPHC': tphc,
    'Shift PIC': shiftPic,
    'Shift Breaks': shiftBreaks,
    'Performance Reviews': performanceReviews,
    'Staff Certs': staffCerts,
    'SDS Registry': sds,
    'Audit Events': auditEvents,
  },
};

const py = `
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

data = json.loads(sys.stdin.read())
wb = Workbook()
wb.remove(wb.active)

HEAD_FILL = PatternFill('solid', fgColor='1f2937')
HEAD_FONT = Font(bold=True, color='FFFFFF', size=11)
PASS_FILL = PatternFill('solid', fgColor='dcfce7')
FAIL_FILL = PatternFill('solid', fgColor='fee2e2')

for name, rows in data['sheets'].items():
    ws = wb.create_sheet(title=name[:31])
    if not rows:
        ws.cell(row=1, column=1, value=f'(no {name.lower()} for {data["date"]})')
        continue
    cols = list(rows[0].keys())
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=1, column=i, value=c)
        cell.font = HEAD_FONT
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(horizontal='left')
    for r, row in enumerate(rows, 2):
        for i, c in enumerate(cols, 1):
            v = row.get(c)
            cell = ws.cell(row=r, column=i, value=v if v is not None else '')
            if c == 'status':
                if v == 'pass': cell.fill = PASS_FILL
                elif v == 'fail': cell.fill = FAIL_FILL
    # autosize-ish
    for i, c in enumerate(cols, 1):
        max_len = max([len(str(c))] + [len(str((row.get(c) or ''))) for row in rows])
        ws.column_dimensions[get_column_letter(i)].width = min(max(12, max_len + 2), 48)
    ws.freeze_panes = 'A2'

wb.save(data['out'])
print('OK')
`;

const py3 = process.env.PYTHON || 'python3';
const res = spawnSync(py3, ['-c', py], { input: JSON.stringify(payload), encoding: 'utf-8' });
// Compact one-line compliance summary for the ops tabs — gives the
// operator a sense of "did today's evidence get captured" without
// having to open the workbook.
const complianceSummary = [
  `${tempLog.length} temp`,
  `${coolingLog.length} cool`,
  `${dateMarks.length} marks`,
  `${sanitizerChecks.length} sani`,
  `${sickWorker.length} sick`,
  `${receivingLog.length} recv`,
  `${cleaningLog.length} clean`,
  `${pestLog.length} pest`,
  `${thermCal.length} therm`,
  `${tphc.length} tphc`,
  `${shiftPic.length} pic`,
  `${shiftBreaks.length} breaks`,
  `${performanceReviews.length} reviews`,
  `${staffCerts.length} certs`,
  `${sds.length} sds`,
  `${auditEvents.length} audit`,
].join(' · ');

if (res.status !== 0) {
  console.error('xlsx export failed (CSVs still written):');
  console.error(res.stderr || res.stdout);
  console.log(`✓ CSV-only export: ${checks.length} checks, ${signoffs.length} signoffs, ${eightySix.length} 86s, ${inventory.length} inv updates → ${OUT}`);
  console.log(`  compliance: ${complianceSummary}`);
  process.exit(0);
}

console.log(`✓ Exported ${date}: ${checks.length} checks · ${signoffs.length} signoffs · ${eightySix.length} 86s · ${inventory.length} inv`);
console.log(`  compliance: ${complianceSummary}`);
console.log(`  → ${xlsxOut}`);
