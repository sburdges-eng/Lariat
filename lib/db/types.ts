/**
 * Row types for every table in `data/lariat.db`.
 *
 * Shapes are unchanged from when they lived in lib/db.ts — `@/lib/db`
 * re-exports all of them, so existing imports keep working. Prefer
 * importing from `@/lib/db` unless you specifically want types only.
 *
 * `SELECT *` rows are often wider than these: intersect when you read
 * extra columns, e.g. `BomLine & { vendor_name: string }`.
 */

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
  /** When 1, preferred_vendor is pinned for quality — compare UI blocks vendor switches. */
  quality_locked: number;
  quality_lock_reason: string | null;
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
  min_spend?: number | null;          // operator-set F&B minimum spend ($); null = none
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

export interface PerformanceReview {
  id: number;
  cook_name: string;
  cook_uuid: string | null;
  review_date: string;
  punctuality_score: number;
  technique_score: number;
  speed_score: number;
  notes: string | null;
  reviewer_name: string;
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
 *
 * This interface mirrors the FULL receiving_log schema column-for-column
 * (CREATE TABLE + all ALTER TABLE migrations). Keep it in sync when the
 * DDL changes — a SELECT * consumer casting to ReceivingEntry must not
 * silently lose columns.
 */
export interface ReceivingEntry {
  id: number;
  shift_date: string;
  location_id: string;
  vendor: string;
  invoice_ref: string | null;
  category: string;                // 'refrigerated' | 'frozen' | 'dry' | 'produce' | 'shellfish' | ...
  item: string | null;             // optional line-level item
  /** Vendor's SKU / item code for master matching. NULL when not captured. */
  vendor_sku: string | null;
  /** Resolved ingredient master id when match_status = 'matched'; NULL otherwise. */
  master_id: string | null;
  /**
   * Master-match outcome. Known values: 'not_attempted' (column default)
   * | 'matched' | 'unmatched' | 'ambiguous'. No CHECK constraint, so typed
   * as string; NULL possible on rows written outside the matcher (readers
   * COALESCE to 'not_attempted').
   */
  match_status: string | null;
  /** Why the match landed where it did (e.g. 'missing_vendor'). NULL when not attempted. */
  match_reason: string | null;
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
  /**
   * Cross-host sync replay provenance (see addSyncSourceCols). Populated
   * only by lib/syncApply.ts when replaying a row from another host;
   * local route writes leave all three NULL.
   */
  sync_source_host: string | null;
  sync_source_started_at: string | null;
  sync_source_pk: string | null;
  created_at: string;
  /**
   * Phase 3 closed-loop receiving — quantity actually received in the
   * units the case label reports (lb, case, ea, gal, ...). NULL on pre-
   * Phase-3 rows and on lines where the cook didn't capture a qty
   * (closed-loop credit is opt-in per row). Pairs with `received_unit`.
   */
  received_qty: number | null;
  /**
   * Phase 3 closed-loop receiving — free-form unit string paired with
   * `received_qty`. NULL when the closed-loop write was skipped.
   */
  received_unit: string | null;
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
export interface DishCoverageSnapshot {
  id: number;
  location_id: string;
  total_dishes: number;
  covered_dishes: number;
  coverage_pct: number;
  uncovered_dishes: string;
  created_by: string;
  snapshot_at: string;
}

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
