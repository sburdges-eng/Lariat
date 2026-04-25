import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'lariat.db');

let _db: DB | null = null;
let _dbPathOverride: string | null = null;

/**
 * Test-only hook: point {@link getDb} at an arbitrary SQLite path (or
 * ':memory:') so a test can run against a scratch database without
 * poisoning `data/lariat.db`. Closes the current cached connection so
 * the next `getDb()` call reopens against the new path.
 *
 * Production code never calls this. Pass `null` to revert.
 */
export function setDbPathForTest(p: string | null): void {
  if (_db) {
    try { _db.close(); } catch { /* ignore */ }
    _db = null;
  }
  _dbPathOverride = p;
}

// ── Row types ──────────────────────────────────────────────────────

export interface LineCheckEntry {
  id: number;
  shift_date: string;
  station_id: string;
  item: string;
  status: 'pass' | 'fail' | 'na';
  par: string | null;
  have: string | null;
  need: string | null;
  note: string | null;
  cook_id: string | null;
  /**
   * F15 / FDA §3-301.11 bare-hand-contact-with-RTE attestation.
   *  null = item does not touch ready-to-eat food (not applicable)
   *  0    = item touches RTE; cook has NOT attested glove change
   *  1    = cook has attested fresh gloves for this row
   *
   * Populated on POST /api/checks when body carries a boolean
   * `glove_change_attested`. Pre-migration rows stay NULL.
   */
  glove_change_attested: 0 | 1 | null;
  created_at: string;
  location_id: string;
}

export interface StationSignoff {
  id: number;
  shift_date: string;
  station_id: string;
  cook_id: string;
  signoff_type: string;
  created_at: string;
  location_id: string;
}

export interface EightySix {
  id: number;
  shift_date: string;
  station_id: string | null;
  item: string;
  kind: string;
  reason: string | null;
  quantity: string | null;
  cook_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  location_id: string;
}

export interface InventoryUpdate {
  id: number;
  shift_date: string;
  station_id: string | null;
  item: string;
  delta: string | null;
  direction: string | null;
  note: string | null;
  cook_id: string | null;
  created_at: string;
  location_id: string;
}

export interface Location {
  id: string;
  name: string;
  created_at: string;
  tax_rate?: number | null;
  service_fee_pct?: number | null;
  phone?: string | null;
  address?: string | null;
}

export interface VendorPrice {
  id: number;
  ingredient: string;
  vendor: string | null;
  sku: string | null;
  pack_size: number | null;
  pack_unit: string | null;
  pack_price: number | null;
  unit_price: number | null;
  category: string | null;
  yield_pct: number | null;  // fraction 0..1 (e.g. 0.85 for 85% trim yield)
  /**
   * Run-scoped signal. Set to 'PACK_CHANGED' when T6 detects a pack
   * substitution for this (vendor, sku) against the latest prior row
   * during the CURRENT ingest. Does NOT persist across a quiet
   * re-ingest of the post-swap state: the DELETE+INSERT sweep wipes
   * vendor_prices and, with no new diff to emit, map_status lands as
   * NULL on the next run. For the durable "surface until acknowledged"
   * attention queue, read `pack_size_changes WHERE acknowledged=0`
   * instead — that table is never cleared by the ingest.
   */
  map_status: string | null;
  /**
   * T7: FK to ingredient_masters.master_id. Collapses Sysco + Shamrock
   * rows for the same underlying ingredient so the costing join sees a
   * single merged cost instead of fragmented per-vendor duplicates.
   * NULL when no confirmed ingredient_maps row has been seeded yet —
   * downstream joins fall back to the ingredient string in that case
   * (graceful degradation during partial backfill).
   */
  master_id: string | null;
  location_id: string;
  imported_at: string;
}

export interface PackSizeChange {
  id: number;
  vendor: string;
  sku: string;
  prev_pack: string | null;
  new_pack: string | null;
  prev_price: number | null;
  new_price: number | null;
  detected_at: string;
  acknowledged: number;
}

export interface RecipeCost {
  recipe_id: string;
  recipe_name: string | null;
  category: string | null;
  yield: number | null;
  yield_unit: string | null;
  batch_cost: number | null;
  cost_per_yield_unit: number | null;
  costed_lines: number | null;
  total_lines: number | null;
  interpretations: number | null;
  location_id: string;
  imported_at: string;
}

/**
 * Per-serving component quantity for a Toast dish. A component is EITHER
 * a sub-recipe (component_type='recipe', recipe_slug populated) OR a raw
 * distributor item (component_type='vendor_item', vendor_ingredient populated).
 *
 * `dish_name` is stored canonical (lowercased + alphanumeric-only via
 * normalizeDishName in lib/dishCostBridge). `recipe_slug` matches
 * recipes.json slug = bom_lines.recipe_id = recipe_costs.recipe_id.
 * `vendor_ingredient` matches order_guide_items.ingredient / vendor_prices.ingredient.
 */
export interface DishComponent {
  id: number;
  location_id: string;
  dish_name: string;
  component_type: 'recipe' | 'vendor_item';
  recipe_slug: string | null;
  vendor_ingredient: string | null;
  qty_per_serving: number;
  unit: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BomLine {
  id: number;
  recipe_id: string;
  ingredient: string | null;
  qty: number | null;
  unit: string | null;
  sub_recipe: string | null;
  vendor_ingredient: string | null;
  map_status: string | null;
  vendor: string | null;
  pack_price: number | null;
  pack_size: number | null;
  yield_pct: number | null;  // fraction 0..1 (e.g. 0.85 for 85% trim yield)
  loss_factor: number | null;  // cooking-shrinkage fraction 0..1 (e.g. 0.25 = 25% weight loss)
  /**
   * T7: FK to ingredient_masters.master_id. Lets cost math group
   * per-master rather than per-ingredient-string across a recipe's BOM.
   * NULL when no confirmed ingredient_maps row matches this ingredient
   * — joins degrade gracefully to the normalized ingredient key.
   */
  master_id: string | null;
  location_id: string;
  imported_at: string;
}

export interface IngredientMaster {
  /**
   * Stable slug derived from the confirmed recipe_ingredient. v1 uses
   * `normalizeIngredientKey(recipe_ingredient).replace(/ /g, '_')`
   * (e.g. "tomato paste" → "tomato_paste"). The spec's ideal encoding
   * is brand+pack (e.g. "ketchup_heinz_1gal"), but we don't yet have
   * structured brand/pack metadata on ingredient_maps — switching to
   * the richer slug is a pure migration once that metadata lands.
   */
  master_id: string;
  canonical_name: string;
  category: string | null;
  preferred_vendor: string | null;
  last_reviewed: string | null;
}

export interface IngredientDensity {
  ingredient_key: string;
  g_per_ml: number;
  source: 'seed' | 'measured' | 'vendor' | null;
  updated_at: string;
}

export interface IngredientYield {
  ingredient_key: string;
  yield_pct: number;              // fraction 0..1
  loss_factor: number | null;     // fraction 0..1 or null
  source: 'book_of_yields' | 'lariat_measured' | 'seed';
  notes: string | null;
  updated_at: string;
}

export interface IngestRun {
  id: number;
  kind: string;                   // 'costing' | 'analytics' | 'unified' | 'toast' | ...
  started_at: string;             // ISO 8601, produced by datetime('now','subsec')
  finished_at: string | null;     // NULL while running
  rows_in: number | null;
  rows_out: number | null;
  status: string | null;          // 'ok' | 'partial' | 'failed' | 'running'
}

export interface SalesLine {
  id: number;
  period_label: string | null;
  item_name: string;
  quantity_sold: number | null;
  net_sales: number | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface SpendMonthly {
  id: number;
  month: string;
  shamrock_total_spend: number | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface BeoEvent {
  id: number;
  title: string;
  event_date: string | null;
  event_time: string | null;          // "5-7pm", "4:30 PM", etc. — free-text
  contact_name: string | null;
  guest_count: number | null;
  notes: string | null;
  status: string;
  tax_rate: number;                   // 0.0675 = 6.75%
  service_fee_pct: number;            // 20 = 20%
  location_id: string;
  created_at: string;
}

export interface BeoTask {
  id: number;
  event_id: number;
  task: string;
  due_date: string | null;
  done: number;
  sort_order: number;
  location_id: string;
}

export interface BeoLineItem {
  id: number;
  event_id: number;
  sort_order: number;
  item_name: string;
  category: string | null;
  unit_cost: number;
  quantity: number;
  created_at: string;
}

export interface Equipment {
  id: number;
  name: string;
  category: string;
  make_model: string | null;
  model_number: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_expiration: string | null;
  purchase_cost: number | null;
  vendor: string | null;
  vendor_order_ref: string | null;
  manual_path: string | null;
  notes: string | null;
  status: string;
  location_id: string;
}

export interface EquipmentMaintenance {
  id: number;
  equipment_id: number;
  service_date: string;
  type: string;
  cost: number | null;
  notes: string | null;
  receipt_reference: string | null;
  cook_id: string | null;
  location_id: string;
  created_at: string;
}

export interface EquipmentPart {
  id: number;
  equipment_id: number;
  part_number: string;
  description: string | null;
  vendor: string | null;
  unit_price: number | null;
  qty_on_hand: number | null;
  last_ordered: string | null;
  last_order_ref: string | null;
  notes: string | null;
  location_id: string;
  created_at: string;
}

export interface EquipmentMaintenanceSchedule {
  id: number;
  equipment_id: number;
  task: string;
  frequency: string;
  last_done: string | null;
  next_due: string | null;
  notes: string | null;
  location_id: string;
  created_at: string;
}

export interface GoldStar {
  id: number;
  cook_name: string;
  reason: string;
  stars: number;
  awarded_date: string;
  location_id: string;
  created_at: string;
}

export interface TempLogEntry {
  id: number;
  shift_date: string;
  location_id: string;
  point_id: string;
  reading_f: number;
  required_min_f: number | null;
  required_max_f: number | null;
  corrective_action: string | null;
  cook_id: string | null;
  /** Bundle G: optional thermometer id tying this reading back to a
   *  probe in thermometer_calibrations. null on pre-G rows. */
  probe_id: string | null;
  created_at: string;
}

export interface ToastSalesDailyRow {
  id: number;
  shift_date: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface ToastSalesDowRow {
  id: number;
  day_of_week: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

export interface ToastSalesHourRow {
  id: number;
  hour_24: number;
  label: string;
  net_sales: number | null;
  orders: number | null;
  guests: number | null;
  comparison_group: number;
  date_range: string | null;
  source: string | null;
  location_id: string;
  imported_at: string;
}

// ── Food-safety + labor row types (HACCP / CO / FDA hardening) ─────
//
// These rows back the health/safety/labor hardening described in
// docs/HEALTH_SAFETY_LABOR_AUDIT.md. Per AGENTS.md rule #5 the tables
// below are ADDITIVE — no existing column or table is mutated in place.
// Every table carries location_id (multi-site future) and created_at so
// the audit_events trail can reconstruct who-did-what-when on any row
// without needing to diff snapshots.

/**
 * Multi-stage cooling log (FDA Food Code 2022 §3-501.14).
 * Stage 1: 135°F → 70°F within 2h.
 * Stage 2: 70°F → 41°F within 4h more (6h total).
 * A row is OPENED when the food is placed to cool; it's CLOSED by
 * a stage-2 reading (reading_f ≤ 41). The library layer computes
 * breach_reason from the timestamps + readings — we persist it on
 * close so later audits don't have to recompute.
 */
export interface CoolingLogEntry {
  id: number;
  shift_date: string;
  location_id: string;
  item: string;
  station_id: string | null;
  started_at: string;          // ISO 8601; time food was pulled off the line
  start_reading_f: number | null;
  stage1_at: string | null;    // ≤ 70°F timestamp
  stage1_reading_f: number | null;
  stage2_at: string | null;    // ≤ 41°F timestamp
  stage2_reading_f: number | null;
  status: 'in_progress' | 'ok' | 'breach';
  breach_reason: string | null;      // 'stage1_over_2h' | 'stage2_over_4h' | 'discarded' | ...
  corrective_action: string | null;  // required if status = 'breach'
  cook_id: string | null;
  closed_by_cook_id: string | null;
  created_at: string;
}

/**
 * 7-day date marking for PHF/TCS ready-to-eat food held >24h
 * (FDA Food Code 2022 §3-501.17). `prepared_on` is the anchor; the
 * library computes `discard_on = prepared_on + 6 days` (day-of-prep
 * is day 1 per FDA). `discarded_at` is NULL while still in service.
 */
export interface DateMark {
  id: number;
  location_id: string;
  item: string;
  batch_ref: string | null;        // free-text: pan #, lot, sticker
  prepared_on: string;             // date (YYYY-MM-DD)
  discard_on: string;              // computed 6 days forward
  discarded_at: string | null;     // ISO 8601 when pulled
  discarded_by_cook_id: string | null;
  discard_reason: string | null;   // 'expired' | 'early_use' | 'quality' | 'contamination' | ...
  cook_id: string | null;
  created_at: string;
}

/**
 * Receiving log (FDA Food Code §3-202.11 / §3-501.2). One row per
 * pallet/case received. Temp rejections and condition rejections are
 * recorded in-line (status + note) rather than a separate "rejection"
 * table — the audit question is always "did we accept this shipment,
 * at what temp, and why."
 */
export interface ReceivingEntry {
  id: number;
  shift_date: string;
  location_id: string;
  vendor: string;
  invoice_ref: string | null;
  category: string;                // 'refrigerated' | 'frozen' | 'dry' | 'produce' | 'shellfish' | ...
  item: string | null;             // optional line-level item
  reading_f: number | null;        // temp at receiving (NULL for dry)
  required_max_f: number | null;   // snapshot of the limit at receiving
  /**
   * Package-integrity check (§3-202.15). 1 = intact, 0 = compromised,
   * NULL on legacy rows pre-Bundle F. A 0 forces `status='rejected'`
   * regardless of reading_f; the rule module enforces that.
   */
  package_ok: number | null;
  /** Optional sell-by / use-by date as YYYY-MM-DD. Pre-Bundle F rows carry NULL. */
  expiration_date: string | null;
  status: 'accepted' | 'rejected' | 'accepted_with_note';
  /**
   * Note the PIC recorded for an `accepted_with_note` row (drift band
   * corrective action) OR the reason for a `rejected` row. Pre-Bundle F
   * the column was called rejection_reason and only held the reject
   * path; it doubles as the corrective-action note in Bundle F since
   * both are the same audit artifact ("why was this not a clean
   * accept?").
   */
  rejection_reason: string | null;
  shellstock_tag_ref: string | null;  // §3-203.12 shellstock 90-day retention ref
  cook_id: string | null;
  created_at: string;
}

/**
 * Sanitizer concentration checks (FDA §4-703.11). Three-compartment
 * sinks, wiping-cloth buckets, warewasher final-rinse. Chemistry
 * column distinguishes chlorine / quat / iodine since the acceptable
 * ppm band varies.
 */
export interface SanitizerCheck {
  id: number;
  shift_date: string;
  location_id: string;
  station_id: string | null;
  point_label: string;            // 'dish pit final rinse', 'wiping bucket — grill', ...
  chemistry: 'chlorine' | 'quat' | 'iodine' | 'other';
  concentration_ppm: number;
  required_min_ppm: number | null;
  required_max_ppm: number | null;
  water_temp_f: number | null;    // only meaningful for chlorine/warewasher
  status: 'ok' | 'low' | 'high';
  corrective_action: string | null;
  cook_id: string | null;
  created_at: string;
}

/**
 * Sick-worker reports (FDA §2-201.11, CO 6 CCR 1010-2). Captures
 * the five required symptoms (vomiting, diarrhea, jaundice, sore
 * throat with fever, open infected lesion) and the Big-6 diagnoses
 * (Norovirus, Salmonella Typhi, Nontyphoidal Salmonella, Shigella,
 * STEC/EHEC, Hep A). Exclusion/restriction/return-to-work timestamps
 * are on the same row so the PIC can answer "who is excluded right
 * now?" with a single query.
 */
export interface SickWorkerReport {
  id: number;
  shift_date: string;
  location_id: string;
  cook_id: string;
  reported_by_pic_id: string | null;
  symptoms: string;                // comma-joined canonical keys
  diagnosed_illness: string | null;  // one of Big-6 or NULL
  action: 'excluded' | 'restricted' | 'monitor' | 'none';
  started_at: string;              // ISO 8601
  return_at: string | null;        // ISO 8601 when cleared
  clearance_source: string | null; // 'asymptomatic_24h' | 'medical_clearance' | 'health_dept' | ...
  note: string | null;
  created_at: string;
}

/**
 * Person-In-Charge per shift (FDA §2-101.11). A CFPM or trained
 * supervisor must be on-site during hours of operation. One row per
 * (shift_date, location_id, shift_slot) — slot is 'open' | 'mid' |
 * 'close' to match Lariat's three-service-period day.
 */
export interface ShiftPic {
  id: number;
  shift_date: string;
  location_id: string;
  shift_slot: 'open' | 'mid' | 'close' | 'all_day';
  cook_id: string;                 // who is PIC
  cfpm_cert_id: number | null;     // FK to staff_certifications when present
  started_at: string;
  ended_at: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Pre-shift heads-up note written by the head chef. One row per
 * (location, shift_date, service_label). Empty service_label means
 * a prep-day note (the kitchen is closed that day).
 */
export interface PreshiftNote {
  id: number;
  location_id: string;
  shift_date: string;
  service_label: string | null;    // 'Dinner' | 'Brunch' | NULL
  body: string;
  author_cook_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Service hours by day-of-week. `day_of_week` follows JS
 * Date.getDay() (0=Sun..6=Sat). A day with no row is closed. Multiple
 * rows per day are allowed for split services (e.g. lunch + dinner),
 * disambiguated by service_label.
 */
export interface ServiceHoursRow {
  id: number;
  location_id: string;
  day_of_week: number;             // 0=Sun..6=Sat (JS Date.getDay)
  opens_at: string | null;         // 'HH:MM' 24h
  closes_at: string | null;
  service_label: string | null;    // 'Dinner', 'Brunch', 'Lunch', ...
  notes: string | null;
  active: number;
  created_at: string;
  archived_at: string | null;      // set by /api/service-hours DELETE + archive:stale sweep
}

/**
 * Cleaning schedule (FDA §4-602, §4-702). Master list of recurring
 * cleaning tasks (hood, floor drains, walk-in gaskets, ice machine,
 * fry vats). `frequency` is free-text but should parse as 'daily' |
 * 'weekly' | 'monthly' | 'quarterly' | 'every N days' for the UI
 * scheduler.
 */
export interface CleaningScheduleItem {
  id: number;
  location_id: string;
  area: string;                    // 'hood', 'walk-in #1', 'ice machine', ...
  task: string;                    // 'scrub filters', 'sanitize gaskets', ...
  frequency: string;
  last_done: string | null;
  next_due: string | null;
  notes: string | null;
  active: number;                  // 0/1 — retired rows stay for history
  created_at: string;
  archived_at: string | null;      // set by /api/cleaning-schedule DELETE + archive:stale sweep
}

export interface CleaningLogEntry {
  id: number;
  shift_date: string;
  location_id: string;
  schedule_id: number | null;      // NULL = ad-hoc task not on schedule
  area: string;
  task: string;
  completed_at: string;
  cook_id: string | null;
  verified_by_cook_id: string | null;
  notes: string | null;
  created_at: string;
}

/**
 * Pest control log (FDA §6-501.111). One row per vendor visit OR
 * internal sighting. Type disambiguates.
 */
export interface PestControlEntry {
  id: number;
  shift_date: string;
  location_id: string;
  entry_type: 'service_visit' | 'sighting' | 'trap_check';
  vendor: string | null;           // NULL for internal sightings
  technician: string | null;
  findings: string | null;
  pest: string | null;             // 'roach', 'mouse', 'fly', ...
  severity: 'low' | 'medium' | 'high' | null;
  corrective_action: string | null;
  report_path: string | null;      // path to scanned visit report
  cook_id: string | null;
  created_at: string;
}

/**
 * Thermometer calibration records (FDA §4-203.11). Ice-point or
 * boiling-point calibrations with before/after readings so a
 * drifting probe can be traced back through the temp_log rows
 * that were taken with it.
 */
export interface ThermometerCalibration {
  id: number;
  location_id: string;
  thermometer_id: string;          // inventory tag ('probe-3', 'IR-1', …)
  method: 'ice_point' | 'boiling_point' | 'reference_probe';
  before_reading_f: number | null;
  after_reading_f: number | null;
  passed: number;                  // 0/1
  action_taken: string | null;     // 'retired', 'recalibrated', 'returned_to_service'
  cook_id: string | null;
  calibrated_at: string;
  created_at: string;
}

/**
 * Time as a Public Health Control (FDA §3-501.19). A TCS food may
 * be held out of temperature for ≤4h (cold ≤ 4h, hot ≤ 4h) provided
 * it's marked and discarded at the cutoff. Row opens when food hits
 * the line; closes when either consumed (discarded_at set with reason
 * 'depleted') or tossed at cutoff.
 */
export interface TphcEntry {
  id: number;
  shift_date: string;
  location_id: string;
  station_id: string | null;
  item: string;
  batch_ref: string | null;
  started_at: string;
  cutoff_at: string;               // started_at + 4h
  discarded_at: string | null;
  discard_reason: string | null;   // 'cutoff' | 'depleted' | 'quality'
  cook_id: string | null;
  created_at: string;
}

/**
 * Safety Data Sheet registry (OSHA 29 CFR 1910.1200 HazCom, CO
 * Right-to-Know). Every chemical used in BOH/FOH must have an SDS
 * on-site. `pdf_path` is local to the laptop; `url` is the vendor
 * hosted copy. Either is sufficient, both is ideal.
 */
export interface SdsEntry {
  id: number;
  location_id: string;
  product_name: string;
  manufacturer: string | null;
  hazard_class: string | null;     // 'corrosive', 'flammable', ...
  storage_location: string | null; // 'chem closet — mop station'
  pdf_path: string | null;
  url: string | null;
  last_reviewed: string | null;
  active: number;                  // 0/1
  notes: string | null;
  created_at: string;
}

/**
 * Shift breaks (CO COMPS #39 §5): 30-min unpaid meal break for
 * shifts >5h, 10-min paid rest break per 4h. Row is one break, not
 * a shift. `kind` disambiguates meal vs rest. `waived` records the
 * employee-initiated meal-break waiver (on-duty meal), which must
 * be written and revocable under COMPS.
 */
export interface ShiftBreak {
  id: number;
  shift_date: string;
  location_id: string;
  cook_id: string;
  kind: 'meal' | 'rest';
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;     // computed on close; NULL while open
  waived: number;                  // 0/1 — only valid for meal
  waiver_ref: string | null;       // path to signed waiver
  note: string | null;
  created_at: string;
}

/**
 * CO HFWA paid-sick-leave balances (C.R.S. 8-13.3-401). Accrual is
 * 1h per 30h worked, capped at 48h/yr. One row per (cook_id,
 * accrual_year). `hours_accrued` is the running total, `hours_used`
 * is PSL actually taken. The library layer updates these on payroll
 * ingest; the UI reads `hours_available = accrued - used`.
 */
export interface PaidSickLeaveBalance {
  id: number;
  location_id: string;
  cook_id: string;
  accrual_year: number;            // e.g. 2026
  hours_accrued: number;
  hours_used: number;
  cap_hours: number;               // 48 for CO HFWA; column lets future states override
  carryover_hours: number;         // up to 48h may carry per HFWA
  last_accrued_on: string | null;  // YYYY-MM-DD of latest accrual event
  created_at: string;
  updated_at: string;
}

/**
 * Per-employee certifications. ServSafe Manager / CFPM (5yr),
 * ServSafe Food Handler (CO requires for anyone handling unpackaged
 * food within 30 days of hire in many jurisdictions), TIPS alcohol
 * (for anyone serving alcohol). `expires_on` enables the "expires in
 * 30d" banner on the shift-open page.
 */
export interface StaffCertification {
  id: number;
  location_id: string;
  cook_id: string;
  cert_type: 'cfpm' | 'food_handler' | 'tips' | 'allergen' | 'other';
  cert_label: string;              // human label: 'ServSafe Manager', 'TIPS On-Premise', ...
  issuer: string | null;
  cert_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  document_path: string | null;    // scanned cert
  active: number;
  created_at: string;
  updated_at: string;
}

/**
 * Tip pool distributions (FLSA §3(m)(2)(B), CO wage law). One row
 * per (shift_date, cook_id) per distribution. `pool_ref` groups rows
 * that share a common pool so the total distributed can be summed
 * and reconciled against the pool total. Service-charge distributions
 * are stored here with kind='service_charge' so the wage tests can
 * enforce the "managers may not retain tips" rule.
 */
export interface TipPoolDistribution {
  id: number;
  shift_date: string;
  location_id: string;
  pool_ref: string;
  cook_id: string;
  role: string | null;             // 'server','barback','busser',...
  kind: 'tip_pool' | 'service_charge' | 'direct_tip';
  amount_cents: number;            // USD cents, integer — NEVER floats for money
  note: string | null;
  created_at: string;
}

/**
 * Employee status flags (minor under CO YEOA, tipped credit
 * eligible, salaried exempt, excluded-from-tip-pool, etc). Separate
 * table rather than columns on staff so it's multi-valued and
 * auditable — each flag has a row with an effective range.
 */
export interface StaffFlag {
  id: number;
  location_id: string;
  cook_id: string;
  flag: string;                    // 'minor_under_16' | 'minor_16_17' | 'tipped' | 'exempt' | ...
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Wage notice acknowledgments (CO C.R.S. 8-4-120 wage theft
 * prevention). On hire, on rate change, on law change: employee
 * must sign a written notice of wage rate, pay basis, pay schedule,
 * etc. One row per signed notice.
 */
export interface WageNotice {
  id: number;
  location_id: string;
  cook_id: string;
  reason: 'hire' | 'rate_change' | 'annual' | 'law_change' | 'other';
  wage_rate_cents: number;         // USD cents
  pay_basis: 'hourly' | 'salary' | 'commission' | 'tipped';
  tip_credit_cents: number | null; // claimed tip credit per hour; NULL if none
  document_path: string | null;
  signed_on: string;               // date signed
  created_at: string;
}

/**
 * Employee health policy acknowledgments (FDA Form 1-A, §2-103.11).
 * Employees must be informed of their reporting obligations for the
 * five symptoms + Big-6 diagnoses. One row per signed acknowledgment
 * (on hire, and on any policy update).
 */
export interface EmployeeHealthAcknowledgment {
  id: number;
  location_id: string;
  cook_id: string;
  policy_version: string;          // '2026.04' — track when policy text changes
  document_path: string | null;
  signed_on: string;
  created_at: string;
}

/**
 * Append-only audit trail. Every write to a regulated surface
 * (temp_log, cooling_log, sick_worker_reports, signoff, 86, etc.)
 * posts one row here. Rows are NEVER updated or deleted — a
 * subsequent "correction" is its own audit_events row referencing
 * the prior one via `replaces_id`.
 */
export interface AuditEvent {
  id: number;
  shift_date: string;
  location_id: string;
  actor_cook_id: string | null;    // who acted
  actor_source: string;            // 'cook_ui' | 'pic_ui' | 'api' | 'export' | ...
  entity: string;                  // 'temp_log' | 'cooling_log' | 'signoff' | ...
  entity_id: number | null;
  action: 'insert' | 'update' | 'delete' | 'correction' | 'view';
  replaces_id: number | null;      // prior audit_events.id that this supersedes
  payload_json: string | null;     // JSON blob of the after-state (for correction context)
  note: string | null;
  created_at: string;
}

// ── Schema ─────────────────────────────────────────────────────────

export function initSchema(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS line_check_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pass','fail','na')),
      par TEXT,
      have TEXT,
      need TEXT,
      note TEXT,
      cook_id TEXT,
      -- F15 (FDA §3-301.11): NULL = item doesn't touch RTE food;
      -- 0 = glove-change required but not yet attested;
      -- 1 = cook has attested fresh gloves for this line-check row.
      glove_change_attested INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_lce_shift ON line_check_entries(shift_date, station_id);

    CREATE TABLE IF NOT EXISTS station_signoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      signoff_type TEXT NOT NULL DEFAULT 'self',
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_signoff_shift ON station_signoffs(shift_date, station_id);

    CREATE TABLE IF NOT EXISTS eighty_six (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      item TEXT NOT NULL,
      kind TEXT DEFAULT 'item',
      reason TEXT,
      quantity TEXT,
      cook_id TEXT,
      resolved_at TEXT,
      resolved_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_86_shift ON eighty_six(shift_date, resolved_at);

    CREATE TABLE IF NOT EXISTS inventory_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      item TEXT NOT NULL,
      delta TEXT,
      direction TEXT,
      note TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_inv_shift ON inventory_updates(shift_date, station_id);

    -- Periodic on-hand counts. One header row per "count session" the BOH
    -- opens (e.g. weekly / EOM); count_lines holds the actual on-hand qty
    -- per ingredient. Headers are kept open until closed_at is set so a
    -- count can span a shift; lines are upserted by (count_id, ingredient).
    CREATE TABLE IF NOT EXISTS inventory_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_date TEXT NOT NULL,
      label TEXT,
      opened_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      cook_id TEXT,
      location_id TEXT NOT NULL DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_inv_counts_loc_date
      ON inventory_counts(location_id, count_date DESC);

    CREATE TABLE IF NOT EXISTS inventory_count_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
      vendor TEXT,
      ingredient TEXT NOT NULL,
      sku TEXT,
      on_hand_qty REAL,
      unit TEXT,
      par_qty REAL,
      par_unit TEXT,
      note TEXT,
      counted_by TEXT,
      counted_at TEXT DEFAULT (datetime('now')),
      location_id TEXT NOT NULL DEFAULT 'default',
      UNIQUE(count_id, ingredient, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_count_lines_count
      ON inventory_count_lines(count_id);

    -- Standing par list: what we keep on hand by ingredient. The par page
    -- LEFT JOINs latest count_lines against this so cooks can see what's
    -- below par at a glance. sku is stored as '' (not NULL) so the UNIQUE
    -- constraint works cleanly for ingredients with no SKU.
    CREATE TABLE IF NOT EXISTS inventory_par (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor TEXT,
      ingredient TEXT NOT NULL,
      sku TEXT NOT NULL DEFAULT '',
      par_qty REAL,
      par_unit TEXT,
      pack_size TEXT,
      pack_unit TEXT,
      category TEXT,
      note TEXT,
      location_id TEXT NOT NULL DEFAULT 'default',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, ingredient, sku)
    );
    CREATE INDEX IF NOT EXISTS idx_inv_par_loc_cat
      ON inventory_par(location_id, category, ingredient);

    -- Daily prep board. Shift-bound tasks owned by the kitchen, distinct
    -- from beo_prep_tasks which are event-bound. Status flows
    -- todo → in_progress → done (or → skipped for "we're not doing this
    -- today"). assigned_cook_id is whoever claimed it; done_by is whoever
    -- finished it (may differ if a shift handoff happens). source/
    -- source_ref let us track auto-suggested tasks (low_par, beo, …)
    -- without coupling to those tables.
    CREATE TABLE IF NOT EXISTS prep_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      station_id TEXT,
      task TEXT NOT NULL,
      qty TEXT,
      recipe_slug TEXT,
      notes TEXT,
      priority INTEGER DEFAULT 0,
      assigned_cook_id TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','in_progress','done','skipped')),
      started_at TEXT,
      done_at TEXT,
      done_by TEXT,
      source TEXT DEFAULT 'manual',
      source_ref TEXT,
      sort_order INTEGER DEFAULT 0,
      location_id TEXT NOT NULL DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prep_tasks_loc_date
      ON prep_tasks(location_id, shift_date, status);
    CREATE INDEX IF NOT EXISTS idx_prep_tasks_station
      ON prep_tasks(location_id, shift_date, station_id);

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      day_of_week INTEGER NOT NULL,
      opens_at TEXT,
      closes_at TEXT,
      service_label TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, day_of_week, service_label)
    );
    CREATE INDEX IF NOT EXISTS idx_service_hours_loc
      ON service_hours(location_id, day_of_week);

    CREATE TABLE IF NOT EXISTS preshift_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      shift_date TEXT NOT NULL,
      service_label TEXT,
      body TEXT NOT NULL,
      author_cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, shift_date, service_label)
    );
    CREATE INDEX IF NOT EXISTS idx_preshift_date
      ON preshift_notes(location_id, shift_date);

    CREATE TABLE IF NOT EXISTS vendor_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT NOT NULL,
      vendor TEXT,
      sku TEXT,
      pack_size REAL,
      pack_unit TEXT,
      pack_price REAL,
      unit_price REAL,
      category TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vp_loc ON vendor_prices(location_id);

    -- Append-only snapshot of vendor_prices taken before each destructive
    -- ingest sweep. Lets operators look back at historical price trends even
    -- though the live vendor_prices table is DELETE+INSERT per run.
    -- Rows never deleted or updated; queries DISTINCT ON (vendor, sku)
    -- ORDER BY snapshot_at for per-SKU price series.
    CREATE TABLE IF NOT EXISTS vendor_prices_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      source_vendor_price_id INTEGER,
      ingredient TEXT NOT NULL,
      vendor TEXT,
      sku TEXT,
      pack_size REAL,
      pack_unit TEXT,
      pack_price REAL,
      unit_price REAL,
      category TEXT,
      yield_pct REAL,
      actual_received_lb REAL,
      reconciled_unit_price REAL,
      master_id TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT,
      snapshot_at TEXT DEFAULT (datetime('now','subsec')),
      snapshot_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_vph_loc_vendor_sku
      ON vendor_prices_history(location_id, vendor, sku);
    CREATE INDEX IF NOT EXISTS idx_vph_snapshot_at
      ON vendor_prices_history(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_vph_ingredient
      ON vendor_prices_history(ingredient);

    CREATE TABLE IF NOT EXISTS recipe_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      recipe_name TEXT,
      category TEXT,
      yield REAL,
      yield_unit TEXT,
      batch_cost REAL,
      cost_per_yield_unit REAL,
      costed_lines INTEGER,
      total_lines INTEGER,
      interpretations INTEGER,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, recipe_id)
    );

    CREATE TABLE IF NOT EXISTS margin_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      net_sales REAL,
      cost_per_unit REAL,
      margin_pct REAL,
      popularity REAL,
      quadrant TEXT,
      snapshot_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    -- Latest-per-location read path + retention DELETE both need this.
    CREATE INDEX IF NOT EXISTS idx_margin_snapshots_loc_id
      ON margin_snapshots(location_id, id DESC);

    CREATE TABLE IF NOT EXISTS accounting_variance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT,
      period_end TEXT,
      theoretical_cogs REAL,
      actual_cogs REAL,
      variance_amount REAL,
      variance_pct REAL,
      snapshot_at TEXT DEFAULT (datetime('now')),
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_accounting_variance_loc_id
      ON accounting_variance(location_id, id DESC);

    CREATE TABLE IF NOT EXISTS bom_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL,
      ingredient TEXT,
      qty REAL,
      unit TEXT,
      sub_recipe TEXT,
      vendor_ingredient TEXT,
      map_status TEXT,
      vendor TEXT,
      pack_price REAL,
      pack_size REAL,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bom_recipe ON bom_lines(recipe_id, location_id);

    CREATE TABLE IF NOT EXISTS ingredient_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_ingredient TEXT NOT NULL,
      vendor_ingredient TEXT,
      status TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );

    -- T7: canonical ingredient master table. One row per logical ingredient
    -- (e.g. "heinz_ketchup_1gal") regardless of which vendor carries it. A
    -- Sysco row and a Shamrock row for the same thing both point at the same
    -- master via vendor_prices.master_id / bom_lines.master_id, collapsing
    -- per-vendor fragmentation before the costing / menu-engineering joins.
    -- Populated from confirmed ingredient_maps rows — we never fuzz-match
    -- automatically (same posture as scripts/lib/ingredient_key.py
    -- _make_join_key). master_id is a slug derived from the recipe
    -- ingredient string (see IngredientMaster JSDoc for the v1 formula).
    CREATE TABLE IF NOT EXISTS ingredient_masters (
      master_id        TEXT PRIMARY KEY,  -- slug: "ketchup_heinz_1gal"
      canonical_name   TEXT NOT NULL,
      category         TEXT,
      preferred_vendor TEXT,
      last_reviewed    TEXT
    );

    CREATE TABLE IF NOT EXISTS ingredient_densities (
      ingredient_key TEXT PRIMARY KEY,
      g_per_ml REAL NOT NULL,
      source TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- T4.1: per-(ingredient, count-unit) weight bridge. Answers "how many
    -- grams is one ea / bunch / slice / sprig / clove / case of this
    -- ingredient." Used by the T4 conversion post-pass in ingest-costing.mjs
    -- to bridge count ↔ weight (and count → volume when paired with a
    -- density). Source column tracks provenance the same way as
    -- ingredient_densities; a row may be 'seed' (CSV), 'measured' (kitchen
    -- scale), or 'vendor' (declared on a spec sheet).
    CREATE TABLE IF NOT EXISTS ingredient_unit_weights (
      ingredient_key TEXT NOT NULL,
      unit           TEXT NOT NULL,        -- canonical count unit (post-normalize_unit)
      g_per_unit     REAL NOT NULL,        -- grams per 1 of the count unit above
      source         TEXT CHECK (source IS NULL OR source IN ('seed', 'measured', 'vendor')),
      updated_at     TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (ingredient_key, unit)
    );

    -- T5a: per-(vendor, sku) catalog pack weight so invoice-vs-received
    -- reconciliation can catch catch-weight items that ship heavier/lighter
    -- than the catalog declares. catalog_wt_lb is REQUIRED (the reference
    -- value); tare_lb is optional (nonzero for items where the pack
    -- container is weighed with the product — chicken wings in a 2 lb
    -- bag, etc.). Source enum matches ingredient_densities posture. PK
    -- on (vendor, sku) since one SKU is unique per vendor.
    CREATE TABLE IF NOT EXISTS vendor_catch_weights (
      vendor        TEXT NOT NULL,
      sku           TEXT NOT NULL,
      catalog_wt_lb REAL NOT NULL,
      tare_lb       REAL,
      source        TEXT,
      updated_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (vendor, sku)
    );

    -- T6: pack-size substitution audit log. Each row records a detected
    -- silent vendor swap (e.g. 6×#10 → 4×#10) caught at ingest time by
    -- diffing the incoming pack_size/pack_unit against the latest prior
    -- row per (vendor, sku). prev_pack / new_pack encode the tuple
    -- "{pack_size}x{pack_unit}" for human-readable diff output; the
    -- numeric components live on vendor_prices itself. acknowledged=0
    -- means the row still surfaces in the attention queue; operator
    -- flips to 1 once the swap has been reviewed.
    --
    -- DURABILITY: this table is the authoritative, persistent source
    -- for the "pack-changed" attention queue. It is NEVER DELETEd by
    -- the ingest (unlike vendor_prices, which gets a DELETE+INSERT
    -- sweep every run). As a result, a quiet re-ingest of the post-
    -- swap state leaves this row intact and its acknowledged flag
    -- untouched. Consumers of the attention queue MUST key on
    -- acknowledged=0 here, not on vendor_prices.map_status (which
    -- is a run-scoped signal — see VendorPrice.map_status JSDoc).
    CREATE TABLE IF NOT EXISTS pack_size_changes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor       TEXT NOT NULL,
      sku          TEXT NOT NULL,
      prev_pack    TEXT,  -- e.g. "6x#10"
      new_pack     TEXT,
      prev_price   REAL,
      new_price    REAL,
      detected_at  TEXT DEFAULT (datetime('now')),
      acknowledged INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ingredient_yields (
      ingredient_key TEXT PRIMARY KEY,     -- same normalized form as ingredient_densities
      yield_pct      REAL NOT NULL,        -- fraction 0..1 (e.g. 0.85 for 85% trim yield)
      loss_factor    REAL,                 -- cooking-shrinkage fraction 0..1; NULL if not applicable
      source         TEXT NOT NULL CHECK (source IN ('book_of_yields', 'lariat_measured', 'seed')),
      notes          TEXT,                 -- provenance / edge-case detail
      updated_at     TEXT DEFAULT (datetime('now'))
    );

    -- T9 / B3: per-invocation ingest instrumentation. One row per ingest run,
    -- inserted at the start of the script with status='running' and finalized
    -- at the end with 'ok' | 'partial' | 'failed'. Drives the ingest-age tile
    -- on /costing and the "price update latency" benchmark in the gap doc.
    CREATE TABLE IF NOT EXISTS ingest_runs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kind         TEXT NOT NULL,          -- 'costing' | 'analytics' | 'unified' | 'toast' | ...
      started_at   TEXT NOT NULL,          -- ISO 8601 via datetime('now','subsec')
      finished_at  TEXT,                   -- NULL while running
      rows_in      INTEGER,
      rows_out     INTEGER,
      status       TEXT                    -- 'ok' | 'partial' | 'failed' | 'running'
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_runs_kind_started ON ingest_runs(kind, started_at DESC);

    CREATE TABLE IF NOT EXISTS order_guide_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient TEXT NOT NULL,
      base_qty REAL,
      unit TEXT,
      vendor TEXT,
      unit_price REAL,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      -- 1 = row holds a recipe-derived placeholder cost (no real vendor
      -- invoice yet) and MUST be ignored by the costing bridge. Backfill
      -- script scripts/flag-placeholder-order-guide.mjs stamps it for
      -- known bad rows; ingest pipelines never set it to 1.
      is_placeholder INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_label TEXT,
      item_name TEXT NOT NULL,
      quantity_sold REAL,
      net_sales REAL,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_loc ON sales_lines(location_id);

    -- dish_components: per-serving component quantities for a Toast dish.
    -- A "component" is either a sub-recipe (recipe_slug populated) or a raw
    -- distributor item (vendor_ingredient populated). Examples:
    --   - bacon_jam (recipe) — house-made sauce
    --   - 8oz Burger Patty (vendor_item) — bought direct from Sysco
    --   - Brioche Bun (vendor_item) — bought direct from Shamrock
    -- Bridges menu pricing → recipe_costs OR vendor_prices.
    -- Each row is "X qty of component Y per single serving of dish Z."
    -- Populated via /menu-engineering/components.
    CREATE TABLE IF NOT EXISTS dish_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      dish_name TEXT NOT NULL,
      component_type TEXT NOT NULL DEFAULT 'recipe'
        CHECK(component_type IN ('recipe', 'vendor_item')),
      recipe_slug TEXT,
      vendor_ingredient TEXT,
      qty_per_serving REAL NOT NULL,
      unit TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      CHECK (
        (component_type = 'recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL) OR
        (component_type = 'vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)
      )
    );
    -- Partial UNIQUE indexes are created after migrateLegacyColumns ensures
    -- the column shape is current (old dish_components tables without
    -- component_type must be rebuilt before an index can reference it).
    CREATE INDEX IF NOT EXISTS idx_dish_components_dish
      ON dish_components(location_id, dish_name);

    CREATE TABLE IF NOT EXISTS spend_monthly (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL,
      shamrock_total_spend REAL,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_spend_month ON spend_monthly(month, location_id);

    CREATE TABLE IF NOT EXISTS beo_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT,
      event_time TEXT,
      contact_name TEXT,
      guest_count INTEGER,
      notes TEXT,
      status TEXT DEFAULT 'planned',
      tax_rate REAL DEFAULT 0.0675,
      service_fee_pct REAL DEFAULT 20,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS beo_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      item_name TEXT NOT NULL,
      category TEXT,
      unit_cost REAL NOT NULL DEFAULT 0,
      quantity REAL NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_line_ev ON beo_line_items(event_id);

    CREATE TABLE IF NOT EXISTS beo_prep_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      due_date TEXT,
      done INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      location_id TEXT DEFAULT 'default',
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_prep_ev ON beo_prep_tasks(event_id);

    -- Historical BEO prep records ingested from past events (catering invoice
    -- 'Kitchen Sheet' tabs and the master workbook's hand-curated 'BEO Prep'
    -- aggregate). NOT joined to beo_events -- past events predate the runtime
    -- cockpit. Read-only reference for kitchen-assistant context
    -- (e.g. "what was prepped for the last birria event").
    CREATE TABLE IF NOT EXISTS beo_prep_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      client TEXT,
      event_date TEXT,            -- ISO YYYY-MM-DD
      event_file TEXT,            -- source xlsx filename if known
      type TEXT,                  -- 'Main Item' | 'Secondary Prep' | 'Special Sauce' | …
      item TEXT NOT NULL,
      amount_qty TEXT,            -- numeric or descriptive (kept as text)
      prep_day TEXT,
      pre_prep_notes TEXT,
      plating_notes TEXT,
      source TEXT NOT NULL,       -- e.g. 'master_workbook_2026-04-18'
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_date
      ON beo_prep_history(location_id, event_date);
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_item
      ON beo_prep_history(location_id, item);
    CREATE INDEX IF NOT EXISTS idx_beo_prep_hist_loc_source
      ON beo_prep_history(location_id, source);

    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      make_model TEXT,
      serial_number TEXT,
      purchase_date TEXT,
      warranty_expiration TEXT,
      purchase_cost REAL,
      status TEXT DEFAULT 'active',
      location_id TEXT DEFAULT 'default'
    );
    CREATE INDEX IF NOT EXISTS idx_equip_loc ON equipment(location_id);

    CREATE TABLE IF NOT EXISTS equipment_maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      service_date TEXT NOT NULL,
      type TEXT NOT NULL,
      cost REAL,
      notes TEXT,
      receipt_reference TEXT,
      cook_id TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_maint_eq ON equipment_maintenance(equipment_id);

    CREATE TABLE IF NOT EXISTS equipment_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      part_number TEXT NOT NULL,
      description TEXT,
      vendor TEXT,
      unit_price REAL,
      qty_on_hand REAL,
      last_ordered TEXT,
      last_order_ref TEXT,
      notes TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_parts_eq ON equipment_parts(equipment_id);

    CREATE TABLE IF NOT EXISTS equipment_maintenance_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_id INTEGER NOT NULL,
      task TEXT NOT NULL,
      frequency TEXT NOT NULL,
      last_done TEXT,
      next_due TEXT,
      notes TEXT,
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_equip_sched_eq ON equipment_maintenance_schedule(equipment_id);

    CREATE TABLE IF NOT EXISTS gold_stars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cook_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      stars INTEGER DEFAULT 1,
      awarded_date TEXT DEFAULT (date('now')),
      location_id TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS temp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      point_id TEXT NOT NULL,
      reading_f REAL NOT NULL,
      required_min_f REAL,
      required_max_f REAL,
      corrective_action TEXT,
      cook_id TEXT,
      -- Bundle G: optional thermometer id linking the reading to a
      -- probe calibration record (see thermometer_calibrations). Null
      -- means "no probe recorded" — reading is still persisted.
      probe_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_temp_log_shift ON temp_log(shift_date, location_id, point_id);

    CREATE TABLE IF NOT EXISTS toast_sales_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(shift_date, comparison_group, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_toast_daily_loc_date ON toast_sales_daily(location_id, shift_date);

    CREATE TABLE IF NOT EXISTS toast_sales_dow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_of_week TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(day_of_week, comparison_group, location_id)
    );

    CREATE TABLE IF NOT EXISTS toast_sales_hour (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hour_24 INTEGER NOT NULL,
      label TEXT NOT NULL,
      net_sales REAL,
      orders INTEGER,
      guests INTEGER,
      comparison_group INTEGER NOT NULL,
      date_range TEXT,
      source TEXT,
      location_id TEXT DEFAULT 'default',
      imported_at TEXT DEFAULT (datetime('now')),
      UNIQUE(hour_24, comparison_group, location_id)
    );
  `);

  initFoodSafetyLaborSchema(db);

  migrateLegacyColumns(db);
  assertCriticalSchemas(db);
  seedDefaultLocation(db);
  ensureIndexes(db);
}

/**
 * HACCP + CO/federal labor hardening tables.
 * See docs/HEALTH_SAFETY_LABOR_AUDIT.md gap register (F1–F17, L1–L10, A1).
 * Additive only: no existing table touched.
 */
function initFoodSafetyLaborSchema(db: DB): void {
  db.exec(`
    -- F1: two-stage cooling (FDA §3-501.14). A row is OPEN from
    -- started_at until stage2_at is set. status is a coarse state;
    -- breach_reason is the detail the compliance officer reads.
    CREATE TABLE IF NOT EXISTS cooling_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      item TEXT NOT NULL,
      station_id TEXT,
      started_at TEXT NOT NULL,
      start_reading_f REAL,
      stage1_at TEXT,
      stage1_reading_f REAL,
      stage2_at TEXT,
      stage2_reading_f REAL,
      status TEXT NOT NULL DEFAULT 'in_progress'
        CHECK(status IN ('in_progress','ok','breach')),
      breach_reason TEXT,
      corrective_action TEXT,
      cook_id TEXT,
      closed_by_cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cooling_status
      ON cooling_log(location_id, status, shift_date);
    CREATE INDEX IF NOT EXISTS idx_cooling_open
      ON cooling_log(location_id, started_at)
      WHERE status = 'in_progress';

    -- F2: 7-day date marking (FDA §3-501.17). discard_on is the
    -- computed "must be used or tossed by" date.
    CREATE TABLE IF NOT EXISTS date_marks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      item TEXT NOT NULL,
      batch_ref TEXT,
      prepared_on TEXT NOT NULL,
      discard_on TEXT NOT NULL,
      discarded_at TEXT,
      discarded_by_cook_id TEXT,
      discard_reason TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_datemarks_active
      ON date_marks(location_id, discard_on)
      WHERE discarded_at IS NULL;

    -- F3: receiving log. One row per pallet/case/SKU accepted or rejected.
    -- Bundle F extends this with package_ok (§3-202.15) and
    -- expiration_date (§3-101.11) columns. They're added as NULLable so
    -- pre-Bundle-F rows remain valid; the route writes both for every
    -- new delivery.
    CREATE TABLE IF NOT EXISTS receiving_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      vendor TEXT NOT NULL,
      invoice_ref TEXT,
      category TEXT NOT NULL,
      item TEXT,
      reading_f REAL,
      required_max_f REAL,
      package_ok INTEGER,               -- 1 = intact, 0 = compromised, NULL = unrecorded (legacy)
      expiration_date TEXT,             -- YYYY-MM-DD; NULL when not printed on the case
      status TEXT NOT NULL
        CHECK(status IN ('accepted','rejected','accepted_with_note')),
      rejection_reason TEXT,
      shellstock_tag_ref TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_receiving_shift
      ON receiving_log(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_receiving_shellstock
      ON receiving_log(shellstock_tag_ref)
      WHERE shellstock_tag_ref IS NOT NULL;

    -- F4: sanitizer checks. Water temp is only meaningful for some
    -- chemistries — storing NULL when not applicable is intentional.
    CREATE TABLE IF NOT EXISTS sanitizer_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      station_id TEXT,
      point_label TEXT NOT NULL,
      chemistry TEXT NOT NULL
        CHECK(chemistry IN ('chlorine','quat','iodine','other')),
      concentration_ppm REAL NOT NULL,
      required_min_ppm REAL,
      required_max_ppm REAL,
      water_temp_f REAL,
      status TEXT NOT NULL CHECK(status IN ('ok','low','high')),
      corrective_action TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sanitizer_shift
      ON sanitizer_checks(location_id, shift_date);

    -- F5, L6: sick-worker reports. Symptoms stored as comma-joined
    -- canonical keys so the library layer can validate the set.
    -- return_at IS NULL means the worker is currently excluded/restricted.
    CREATE TABLE IF NOT EXISTS sick_worker_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      reported_by_pic_id TEXT,
      symptoms TEXT NOT NULL,
      diagnosed_illness TEXT,
      action TEXT NOT NULL
        CHECK(action IN ('excluded','restricted','monitor','none')),
      started_at TEXT NOT NULL,
      return_at TEXT,
      clearance_source TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sickworker_active
      ON sick_worker_reports(location_id, cook_id)
      WHERE return_at IS NULL;

    -- L3: per-employee certifications (defined BEFORE shift_pic because
    -- shift_pic.cfpm_cert_id references it).
    CREATE TABLE IF NOT EXISTS staff_certifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      cert_type TEXT NOT NULL
        CHECK(cert_type IN ('cfpm','food_handler','tips','allergen','other')),
      cert_label TEXT NOT NULL,
      issuer TEXT,
      cert_number TEXT,
      issued_on TEXT,
      expires_on TEXT,
      document_path TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staffcerts_expiry
      ON staff_certifications(location_id, expires_on)
      WHERE active = 1;
    CREATE INDEX IF NOT EXISTS idx_staffcerts_cook
      ON staff_certifications(location_id, cook_id, cert_type);

    -- F6: person in charge per shift.
    CREATE TABLE IF NOT EXISTS shift_pic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      shift_slot TEXT NOT NULL
        CHECK(shift_slot IN ('open','mid','close','all_day')),
      cook_id TEXT NOT NULL,
      cfpm_cert_id INTEGER,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (cfpm_cert_id) REFERENCES staff_certifications(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shiftpic_date
      ON shift_pic(location_id, shift_date);

    -- F7: cleaning schedule + log (two tables, ala equipment/maintenance).
    CREATE TABLE IF NOT EXISTS cleaning_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      area TEXT NOT NULL,
      task TEXT NOT NULL,
      frequency TEXT NOT NULL,
      last_done TEXT,
      next_due TEXT,
      notes TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cleansched_due
      ON cleaning_schedule(location_id, next_due)
      WHERE active = 1;

    CREATE TABLE IF NOT EXISTS cleaning_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      schedule_id INTEGER,
      area TEXT NOT NULL,
      task TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      cook_id TEXT,
      verified_by_cook_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_id) REFERENCES cleaning_schedule(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cleanlog_shift
      ON cleaning_log(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_cleanlog_sched
      ON cleaning_log(schedule_id);

    -- F8: pest control log.
    CREATE TABLE IF NOT EXISTS pest_control_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      entry_type TEXT NOT NULL
        CHECK(entry_type IN ('service_visit','sighting','trap_check')),
      vendor TEXT,
      technician TEXT,
      findings TEXT,
      pest TEXT,
      severity TEXT CHECK(severity IS NULL OR severity IN ('low','medium','high')),
      corrective_action TEXT,
      report_path TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pest_shift
      ON pest_control_log(location_id, shift_date);

    -- F9: thermometer calibrations.
    CREATE TABLE IF NOT EXISTS thermometer_calibrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      thermometer_id TEXT NOT NULL,
      method TEXT NOT NULL
        CHECK(method IN ('ice_point','boiling_point','reference_probe')),
      before_reading_f REAL,
      after_reading_f REAL,
      passed INTEGER NOT NULL DEFAULT 0,
      action_taken TEXT,
      cook_id TEXT,
      calibrated_at TEXT NOT NULL,
      -- Per-probe calibration frequency override in days. NULL means
      -- "use the default 30-day schedule". A positive integer overrides
      -- the default for this probe (e.g. high-use probes every 14 days).
      frequency_days INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_thermcal_recent
      ON thermometer_calibrations(location_id, thermometer_id, calibrated_at DESC);

    -- F11: Time as Public Health Control (§3-501.19). cutoff_at is the
    -- computed discard deadline — set by the library layer on insert.
    CREATE TABLE IF NOT EXISTS tphc_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      station_id TEXT,
      item TEXT NOT NULL,
      batch_ref TEXT,
      started_at TEXT NOT NULL,
      cutoff_at TEXT NOT NULL,
      discarded_at TEXT,
      discard_reason TEXT,
      cook_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tphc_open
      ON tphc_entries(location_id, cutoff_at)
      WHERE discarded_at IS NULL;

    -- F17: SDS registry (OSHA HazCom).
    CREATE TABLE IF NOT EXISTS sds_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      product_name TEXT NOT NULL,
      manufacturer TEXT,
      hazard_class TEXT,
      storage_location TEXT,
      pdf_path TEXT,
      url TEXT,
      last_reviewed TEXT,
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sds_active
      ON sds_registry(location_id, active);

    -- L1: shift breaks (COMPS #39).
    CREATE TABLE IF NOT EXISTS shift_breaks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('meal','rest')),
      started_at TEXT NOT NULL,
      ended_at TEXT,
      duration_min REAL,
      waived INTEGER DEFAULT 0,
      waiver_ref TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_breaks_shift
      ON shift_breaks(location_id, shift_date, cook_id);

    -- L2: HFWA paid sick-leave balances.
    CREATE TABLE IF NOT EXISTS paid_sick_leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      accrual_year INTEGER NOT NULL,
      hours_accrued REAL NOT NULL DEFAULT 0,
      hours_used REAL NOT NULL DEFAULT 0,
      cap_hours REAL NOT NULL DEFAULT 48,
      carryover_hours REAL NOT NULL DEFAULT 0,
      last_accrued_on TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(location_id, cook_id, accrual_year)
    );

    -- L4: tip pool distributions. amount_cents is integer USD cents —
    -- NEVER floats for money (floating-point rounding errors on tips
    -- are exactly how FLSA collective actions start).
    CREATE TABLE IF NOT EXISTS tip_pool_distributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      pool_ref TEXT NOT NULL,
      cook_id TEXT NOT NULL,
      role TEXT,
      kind TEXT NOT NULL
        CHECK(kind IN ('tip_pool','service_charge','direct_tip')),
      amount_cents INTEGER NOT NULL,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tip_shift
      ON tip_pool_distributions(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_tip_pool
      ON tip_pool_distributions(pool_ref);

    -- L4, L5: staff flags — minor status, tipped, salaried exempt, etc.
    CREATE TABLE IF NOT EXISTS staff_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      flag TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_staffflags_active
      ON staff_flags(location_id, cook_id, flag)
      WHERE effective_to IS NULL;

    -- L7: wage notices (CO C.R.S. 8-4-120).
    CREATE TABLE IF NOT EXISTS wage_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      reason TEXT NOT NULL
        CHECK(reason IN ('hire','rate_change','annual','law_change','other')),
      wage_rate_cents INTEGER NOT NULL,
      pay_basis TEXT NOT NULL
        CHECK(pay_basis IN ('hourly','salary','commission','tipped')),
      tip_credit_cents INTEGER,
      document_path TEXT,
      signed_on TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wagenotice_cook
      ON wage_notices(location_id, cook_id, signed_on DESC);

    -- F5, F15: FDA Form 1-A health policy acknowledgments.
    CREATE TABLE IF NOT EXISTS employee_health_acknowledgments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT DEFAULT 'default',
      cook_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      document_path TEXT,
      signed_on TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_healthack_cook
      ON employee_health_acknowledgments(location_id, cook_id, signed_on DESC);

    -- A1: audit events. APPEND-ONLY.  NEVER UPDATE OR DELETE.
    -- A correction is a fresh row with replaces_id pointing at the
    -- prior one. payload_json is the after-state so a future reader
    -- can reconstruct the full history without joining back to the
    -- source tables (which may have moved on).
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_date TEXT NOT NULL,
      location_id TEXT DEFAULT 'default',
      actor_cook_id TEXT,
      actor_source TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      action TEXT NOT NULL
        CHECK(action IN ('insert','update','delete','correction','view')),
      replaces_id INTEGER,
      payload_json TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity
      ON audit_events(entity, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_shift
      ON audit_events(location_id, shift_date);
  `);
}

/**
 * Guard against `CREATE TABLE IF NOT EXISTS` silently skipping a legacy
 * table that exists but carries a mismatched schema (e.g. from a failed
 * partial deploy of an earlier T-task). If that happens, INSERTs later fail
 * at runtime with cryptic "no such column" errors — this raises a clear
 * schema-drift error at init time instead.
 */
function assertCriticalSchemas(db: DB): void {
  const requirements: Record<string, string[]> = {
    ingredient_yields: [
      'ingredient_key', 'yield_pct', 'loss_factor', 'source', 'notes', 'updated_at',
    ],
    ingredient_densities: ['ingredient_key', 'g_per_ml', 'source', 'updated_at'],
    ingredient_unit_weights: ['ingredient_key', 'unit', 'g_per_unit', 'source', 'updated_at'],
    vendor_catch_weights: ['vendor', 'sku', 'catalog_wt_lb', 'tare_lb', 'source', 'updated_at'],
    pack_size_changes: [
      'id', 'vendor', 'sku', 'prev_pack', 'new_pack',
      'prev_price', 'new_price', 'detected_at', 'acknowledged',
    ],
    ingredient_masters: [
      'master_id', 'canonical_name', 'category',
      'preferred_vendor', 'last_reviewed',
    ],
  };
  for (const [table, required] of Object.entries(requirements)) {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
      .map((c) => c.name);
    if (cols.length === 0) continue; // table not created — fine, CREATE IF NOT EXISTS handled it
    const missing = required.filter((c) => !cols.includes(c));
    if (missing.length > 0) {
      throw new Error(
        `schema drift on '${table}': missing columns ${JSON.stringify(missing)}. ` +
          `Found: ${JSON.stringify(cols)}. ` +
          `A legacy/partial-deploy table is shadowing the current schema; ` +
          `inspect the DB and either drop+recreate the table or add a migration.`,
      );
    }
  }
}

function ensureIndexes(db: DB): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lce_loc_date ON line_check_entries(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_signoff_loc ON station_signoffs(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_86_loc_date ON eighty_six(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_inv_loc_date ON inventory_updates(location_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_psc_vendor_sku ON pack_size_changes(vendor, sku);
    CREATE INDEX IF NOT EXISTS idx_psc_ack ON pack_size_changes(acknowledged, detected_at);
    -- T7: per-master lookup indexes. Placed in ensureIndexes (not inline in
    -- the CREATE TABLE block) so assertCriticalSchemas fires first — a
    -- partial-deploy drift on vendor_prices / bom_lines / ingredient_masters
    -- surfaces as a clean schema error instead of a silent "CREATE INDEX
    -- on a non-existent column" failure.
    CREATE INDEX IF NOT EXISTS idx_vp_master ON vendor_prices(master_id);
    CREATE INDEX IF NOT EXISTS idx_bom_master ON bom_lines(master_id);
  `);
}

function migrateLegacyColumns(db: DB): void {
  const cols86 = db.prepare('PRAGMA table_info(eighty_six)').all() as { name: string }[];
  const names86 = cols86.map((c) => c.name);
  const migrations: [string, string][] = [
    ['station_id', 'ALTER TABLE eighty_six ADD COLUMN station_id TEXT'],
    ['kind', "ALTER TABLE eighty_six ADD COLUMN kind TEXT DEFAULT 'item'"],
    ['quantity', 'ALTER TABLE eighty_six ADD COLUMN quantity TEXT'],
    ['resolved_by', 'ALTER TABLE eighty_six ADD COLUMN resolved_by TEXT'],
    ['location_id', "ALTER TABLE eighty_six ADD COLUMN location_id TEXT DEFAULT 'default'"],
  ];
  for (const [col, ddl] of migrations) {
    if (!names86.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  const addLoc = (table: string, existingCols: string[]) => {
    if (!existingCols.includes('location_id')) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN location_id TEXT DEFAULT 'default'`);
      } catch { /* ignore */ }
    }
  };
  const t = (name: string) =>
    (db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((c) => c.name);
  addLoc('line_check_entries', t('line_check_entries'));
  addLoc('station_signoffs', t('station_signoffs'));
  addLoc('inventory_updates', t('inventory_updates'));

  // F15 (FDA §3-301.11): glove-change attestation on each line-check row
  // that touches ready-to-eat food. NULL on pre-migration rows so the
  // backfill is additive and the legacy data stays queryable.
  const lceCols = t('line_check_entries');
  if (!lceCols.includes('glove_change_attested')) {
    try {
      db.exec('ALTER TABLE line_check_entries ADD COLUMN glove_change_attested INTEGER');
    } catch { /* ignore */ }
  }

  // Extend equipment table with vendor / manual / model-number / notes columns
  const equipCols = t('equipment');
  const equipMigrations: [string, string][] = [
    ['model_number', 'ALTER TABLE equipment ADD COLUMN model_number TEXT'],
    ['vendor', 'ALTER TABLE equipment ADD COLUMN vendor TEXT'],
    ['vendor_order_ref', 'ALTER TABLE equipment ADD COLUMN vendor_order_ref TEXT'],
    ['manual_path', 'ALTER TABLE equipment ADD COLUMN manual_path TEXT'],
    ['notes', 'ALTER TABLE equipment ADD COLUMN notes TEXT'],
  ];
  for (const [col, ddl] of equipMigrations) {
    if (!equipCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // dish_components gained component_type + vendor_ingredient so a dish can
  // hold both sub-recipes and raw distributor items (buns, patties, cheese).
  // The old shape had recipe_slug NOT NULL and a single composite UNIQUE,
  // neither of which are compatible with the vendor_item branch. SQLite can't
  // drop a column-level NOT NULL or UNIQUE, so the "unpatchable" path is to
  // rebuild the table. For dev DBs that already created the old shape but
  // haven't had any rows inserted yet, we detect via missing column and
  // rebuild in place, preserving any pre-existing rows as recipe-type.
  const dcCols = t('dish_components');
  if (dcCols.length > 0 && !dcCols.includes('component_type')) {
    // Rebuild the old-shape table: SQLite can't drop a NOT NULL from
    // recipe_slug or change a composite UNIQUE in place, so we rename +
    // recreate + copy. Preserves any existing rows as component_type='recipe'.
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE dish_components RENAME TO dish_components_old;
        CREATE TABLE dish_components (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          location_id TEXT NOT NULL DEFAULT 'default',
          dish_name TEXT NOT NULL,
          component_type TEXT NOT NULL DEFAULT 'recipe'
            CHECK(component_type IN ('recipe', 'vendor_item')),
          recipe_slug TEXT,
          vendor_ingredient TEXT,
          qty_per_serving REAL NOT NULL,
          unit TEXT NOT NULL,
          notes TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          CHECK (
            (component_type = 'recipe' AND recipe_slug IS NOT NULL AND vendor_ingredient IS NULL) OR
            (component_type = 'vendor_item' AND vendor_ingredient IS NOT NULL AND recipe_slug IS NULL)
          )
        );
        INSERT INTO dish_components
          (id, location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
           qty_per_serving, unit, notes, created_at, updated_at)
        SELECT id, location_id, dish_name, 'recipe', recipe_slug, NULL,
               qty_per_serving, unit, notes, created_at, updated_at
          FROM dish_components_old;
        DROP TABLE dish_components_old;
        COMMIT;
      `);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('dish_components rebuild migration failed:', err);
    }
  }

  // Partial UNIQUE indexes live here (not in the main schemaSQL block) so
  // they're only created AFTER the column shape is guaranteed current.
  // Idempotent: IF NOT EXISTS skips them on subsequent runs.
  const dcColsAfter = t('dish_components');
  if (dcColsAfter.includes('component_type')) {
    try {
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dish_components_recipe_unique
          ON dish_components(location_id, dish_name, recipe_slug)
          WHERE component_type = 'recipe';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_dish_components_vendor_unique
          ON dish_components(location_id, dish_name, vendor_ingredient)
          WHERE component_type = 'vendor_item';
      `);
    } catch (err) {
      console.error('dish_components partial-index creation failed:', err);
    }
  }

  // BEO events gained event_time / contact_name / tax_rate / service_fee_pct
  // so the worksheet-style board can store the invoice-header fields.
  const beoCols = t('beo_events');
  const beoMigrations: [string, string][] = [
    ['event_time',      'ALTER TABLE beo_events ADD COLUMN event_time TEXT'],
    ['contact_name',    'ALTER TABLE beo_events ADD COLUMN contact_name TEXT'],
    ['tax_rate',        'ALTER TABLE beo_events ADD COLUMN tax_rate REAL DEFAULT 0.0675'],
    ['service_fee_pct', 'ALTER TABLE beo_events ADD COLUMN service_fee_pct REAL DEFAULT 20'],
  ];
  for (const [col, ddl] of beoMigrations) {
    if (!beoCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // BEO line items gained prep-sheet columns (mirrors the archive xlsx
  // layout: ITEM | PREP | SECONDARY PREP | ORDER ITEMS + fire time).
  const beoLineCols = t('beo_line_items');
  const beoLineMigrations: [string, string][] = [
    ['prep_notes',           'ALTER TABLE beo_line_items ADD COLUMN prep_notes TEXT'],
    ['secondary_prep_notes', 'ALTER TABLE beo_line_items ADD COLUMN secondary_prep_notes TEXT'],
    ['order_items_notes',    'ALTER TABLE beo_line_items ADD COLUMN order_items_notes TEXT'],
    ['order_time',           'ALTER TABLE beo_line_items ADD COLUMN order_time TEXT'],
    ['group_note',           'ALTER TABLE beo_line_items ADD COLUMN group_note TEXT'],
  ];
  for (const [col, ddl] of beoLineMigrations) {
    if (!beoLineCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Extend bom_lines with yield / cooking-loss factors used by COGS mapping.
  // T7 adds master_id as a non-indexed FK-style pointer to
  // ingredient_masters.master_id. Pre-T7 rows remain NULL until the T7
  // backfill pass in scripts/ingest-costing.mjs writes them, at which point
  // the costing-benchmark / variance joins prefer master_id when non-NULL
  // on both sides and fall back to the normalized ingredient string.
  const bomCols = t('bom_lines');
  const bomMigrations: [string, string][] = [
    ['yield_pct', 'ALTER TABLE bom_lines ADD COLUMN yield_pct REAL'],
    ['loss_factor', 'ALTER TABLE bom_lines ADD COLUMN loss_factor REAL'],
    ['master_id', 'ALTER TABLE bom_lines ADD COLUMN master_id TEXT'],
  ];
  for (const [col, ddl] of bomMigrations) {
    if (!bomCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Vendor-default trim yield attached to each priced pack.
  // T5a adds catch-weight reconciliation columns on the same table:
  //   actual_received_lb     — per-pack delivered weight from invoice
  //   reconciled_unit_price  — per-actual-lb unit price recomputed when
  //                            actual_received_lb deviates from catalog
  // Both NULLable; old rows pre-T5a stay NULL (conventional "no catch-weight
  // adjustment" sentinel).
  // T6 adds map_status on vendor_prices so the pack-size-substitution
  // detector can flag the freshly-INSERTed row as 'PACK_CHANGED' whenever
  // the incoming pack_size/pack_unit differs from the latest prior row per
  // (vendor, sku). NULL on old / non-changed rows. This column is a
  // RUN-SCOPED signal only — it does not persist across a quiet re-ingest
  // of the post-swap state (the DELETE+INSERT sweep wipes it and the next
  // run finds no diff). Attention-queue consumers should key on
  // `pack_size_changes.acknowledged=0` for durability. See the
  // pack_size_changes DDL comment and VendorPrice.map_status JSDoc above.
  // T7 adds master_id on vendor_prices so multi-vendor rows for the same
  // underlying ingredient collapse onto a single master during costing /
  // menu-engineering joins. Pre-T7 rows land NULL; the T7 backfill in
  // scripts/ingest-costing.mjs writes them from confirmed ingredient_maps.
  const vpCols = t('vendor_prices');
  const vpMigrations: [string, string][] = [
    ['yield_pct', 'ALTER TABLE vendor_prices ADD COLUMN yield_pct REAL'],
    ['actual_received_lb', 'ALTER TABLE vendor_prices ADD COLUMN actual_received_lb REAL'],
    ['reconciled_unit_price', 'ALTER TABLE vendor_prices ADD COLUMN reconciled_unit_price REAL'],
    ['map_status', 'ALTER TABLE vendor_prices ADD COLUMN map_status TEXT'],
    ['master_id', 'ALTER TABLE vendor_prices ADD COLUMN master_id TEXT'],
  ];
  for (const [col, ddl] of vpMigrations) {
    if (!vpCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // order_guide_items.is_placeholder — rows whose unit_price is a
  // recipe-derived placeholder (no real vendor invoice yet) set this to
  // 1 so the dishCostBridge fallback can skip them. Pre-migration rows
  // default to 0; a separate backfill script stamps the known-bad rows.
  const ogCols = t('order_guide_items');
  if (ogCols.length > 0 && !ogCols.includes('is_placeholder')) {
    try {
      db.exec(`ALTER TABLE order_guide_items ADD COLUMN is_placeholder INTEGER DEFAULT 0`);
    } catch { /* ignore */ }
  }

  // Bundle F — receiving_log gains package_ok (§3-202.15) and
  // expiration_date (§3-101.11). Pre-F rows stay NULL on both; that's
  // the conventional "unrecorded" sentinel the route + rule module
  // reason about.
  const recvCols = t('receiving_log');
  const recvMigrations: [string, string][] = [
    ['package_ok', 'ALTER TABLE receiving_log ADD COLUMN package_ok INTEGER'],
    ['expiration_date', 'ALTER TABLE receiving_log ADD COLUMN expiration_date TEXT'],
  ];
  for (const [col, ddl] of recvMigrations) {
    if (!recvCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Bundle G — temp_log gains `probe_id` so a reading can be tied
  // back to the thermometer that produced it. The column is optional:
  // pre-G rows stay NULL (their probe is not on record) and post-G
  // rows can still omit it if the operator is using an uncalibrated
  // wall thermometer. The calibrations rule module uses this column
  // to surface an advisory warning when a cook references a probe
  // that has a failed / overdue / missing calibration — the write is
  // NOT rejected (that's a worse posture than letting the reading
  // land and flagging the probe), it's just audited.
  const tempCols = t('temp_log');
  const tempMigrations: [string, string][] = [
    ['probe_id', 'ALTER TABLE temp_log ADD COLUMN probe_id TEXT'],
  ];
  for (const [col, ddl] of tempMigrations) {
    if (!tempCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Bundle G-fix — thermometer_calibrations gains `frequency_days` so
  // per-probe calibration interval overrides are reachable from the API
  // (not just from test fixtures). NULL means "use the default 30-day
  // schedule"; a positive integer overrides the default for that probe.
  const thermcalCols = t('thermometer_calibrations');
  const thermcalMigrations: [string, string][] = [
    ['frequency_days', 'ALTER TABLE thermometer_calibrations ADD COLUMN frequency_days INTEGER'],
  ];
  for (const [col, ddl] of thermcalMigrations) {
    if (!thermcalCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Location-level configuration — the BEO worksheet previously hardcoded
  // tax_rate (0.0675) and service_fee_pct (20) as per-event fallbacks, which
  // meant a manager editing default tax/service had no reachable surface.
  // These columns let /admin/settings drive a per-location default that
  // /api/beo reads when the request body doesn't provide the field.
  const locCols = t('locations');
  const locMigrations: [string, string][] = [
    ['tax_rate',        'ALTER TABLE locations ADD COLUMN tax_rate REAL DEFAULT 0.0675'],
    ['service_fee_pct', 'ALTER TABLE locations ADD COLUMN service_fee_pct REAL DEFAULT 20'],
    ['phone',           'ALTER TABLE locations ADD COLUMN phone TEXT'],
    ['address',         'ALTER TABLE locations ADD COLUMN address TEXT'],
  ];
  for (const [col, ddl] of locMigrations) {
    if (!locCols.includes(col)) try { db.exec(ddl); } catch { /* ignore */ }
  }

  // Soft-archive timestamps. Tables that already use an `active` 0/1 flag get
  // a paired `archived_at` TEXT column. `scripts/archive-stale.mjs` (npm run
  // archive:stale) stamps it when a row is marked inactive, and list UIs can
  // filter `archived_at IS NULL` to hide retired rows. NULL = live; a
  // datetime('now') value = archived. Existing `active = 0` rows are fixed
  // up by the sweep script on first run.
  const archiveTables: string[] = [
    'service_hours',
    'cleaning_schedule',
    'sds_registry',
    'staff_certifications',
  ];
  for (const tbl of archiveTables) {
    const cols = t(tbl);
    if (cols.length === 0) continue; // table doesn't exist in this build
    if (!cols.includes('archived_at')) {
      try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN archived_at TEXT`); } catch { /* ignore */ }
    }
  }

  // recipe_costs was originally created with `recipe_id TEXT PRIMARY KEY`
  // which blocks multi-location (same recipe_id can't exist in two
  // locations). Rebuild to `id INTEGER PRIMARY KEY AUTOINCREMENT` +
  // `UNIQUE(location_id, recipe_id)` matching all other location-scoped
  // tables.
  const rcCols = t('recipe_costs');
  if (rcCols.length > 0 && !rcCols.includes('id')) {
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE recipe_costs RENAME TO recipe_costs_old;
        CREATE TABLE recipe_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipe_id TEXT NOT NULL,
          recipe_name TEXT,
          category TEXT,
          yield REAL,
          yield_unit TEXT,
          batch_cost REAL,
          cost_per_yield_unit REAL,
          costed_lines INTEGER,
          total_lines INTEGER,
          interpretations INTEGER,
          location_id TEXT DEFAULT 'default',
          imported_at TEXT DEFAULT (datetime('now')),
          UNIQUE(location_id, recipe_id)
        );
        INSERT INTO recipe_costs
          (recipe_id, recipe_name, category, yield, yield_unit, batch_cost,
           cost_per_yield_unit, costed_lines, total_lines, interpretations,
           location_id, imported_at)
        SELECT recipe_id, recipe_name, category, yield, yield_unit, batch_cost,
               cost_per_yield_unit, costed_lines, total_lines, interpretations,
               location_id, imported_at
          FROM recipe_costs_old;
        DROP TABLE recipe_costs_old;
        COMMIT;
      `);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error('recipe_costs PK migration failed:', err);
    }
  }
}

function seedDefaultLocation(db: DB): void {
  const n = db.prepare(`SELECT COUNT(*) as c FROM locations WHERE id = 'default'`).get() as { c: number };
  if (n.c === 0) {
    db.prepare(`INSERT INTO locations (id, name) VALUES ('default', 'The Lariat')`).run();
  }
}

export function getDb(): DB {
  if (_db) return _db;
  const target = _dbPathOverride ?? DB_PATH;
  // Only create the default data/ dir when using the production path;
  // tests using :memory: or a tmp file manage their own directory.
  if (target === DB_PATH && !fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  _db = new Database(target);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // ACID-D: fsync WAL on every commit so financial/personal data survives
  // power loss. ~1-5ms write penalty on SSD; imperceptible at BOH write rates.
  _db.pragma('synchronous = FULL');
  initSchema(_db);
  return _db;
}

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
 */
export function todayServiceLabel(locationId = 'default'): string | null {
  const dow = new Date().getDay();
  const row = getDb()
    .prepare(
      `SELECT service_label FROM service_hours
        WHERE location_id = ? AND active = 1 AND day_of_week = ?
        ORDER BY opens_at ASC LIMIT 1`,
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

export const DB_FILE = DB_PATH;
