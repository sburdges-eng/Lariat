import type { Database as DB } from 'better-sqlite3';

/**
 * HACCP + CO/federal labor hardening tables.
 * See docs/HEALTH_SAFETY_LABOR_AUDIT.md gap register (F1–F17, L1–L10, A1).
 * Additive only: no existing table touched.
 */
export function initFoodSafetyLaborSchema(db: DB): void {
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
      vendor_sku TEXT,
      master_id TEXT,
      match_status TEXT DEFAULT 'not_attempted',
      match_reason TEXT,
      reading_f REAL,
      required_max_f REAL,
      package_ok INTEGER,               -- 1 = intact, 0 = compromised, NULL = unrecorded (legacy)
      expiration_date TEXT,             -- YYYY-MM-DD; NULL when not printed on the case
      status TEXT NOT NULL
        CHECK(status IN ('accepted','rejected','accepted_with_note')),
      rejection_reason TEXT,
      shellstock_tag_ref TEXT,
      cook_id TEXT,
      sync_source_host TEXT,
      sync_source_started_at TEXT,
      sync_source_pk TEXT,
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

    -- Doctor's-note documents attached to a sick-worker report (medical PHI).
    -- file_path is relative to data/uploads/ (sick-notes/<report_id>/<uuid>.<ext>);
    -- original_filename is display-only. Capture/view is native-driven; the web
    -- app only declares the schema (design 2026-07-08-lariat-sick-note-docs).
    CREATE TABLE IF NOT EXISTS sick_note_documents (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id         INTEGER NOT NULL,
      location_id       TEXT    NOT NULL,
      file_path         TEXT    NOT NULL,
      kind              TEXT    NOT NULL,
      original_filename TEXT,
      uploaded_by       TEXT,
      uploaded_at       TEXT    NOT NULL
    );

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
    CREATE INDEX IF NOT EXISTS idx_audit_recent_loc_created
      ON audit_events(location_id, created_at DESC);

    -- KDS bump-back state (protocol v2 — Lariat-KDS/docs/lariat-kds-protocol.md §3).
    -- A row exists iff the ticket has been bumped. Re-bump UPDATEs bumped_at
    -- and writes a 'correction' audit row; the prior bumped_at is captured
    -- in the audit payload so the trail is reconstructable. ticket_id alone
    -- is the natural key — Toast ticket guids are globally unique — but we
    -- carry location_id for multi-site isolation per docs/PATTERNS.md §4.
    -- bumped_pin_hash is the SHA-256 of the cook PIN; the raw PIN is never
    -- stored. Anonymous bumps (no pin) leave bumped_pin_hash NULL.
    CREATE TABLE IF NOT EXISTS kds_ticket_states (
      ticket_id TEXT NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      bumped_at TEXT NOT NULL,
      bumped_station TEXT,
      bumped_pin_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (ticket_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_kds_states_recent
      ON kds_ticket_states(location_id, bumped_at DESC);

    -- Temp PINs: scoped, time-boxed authority handed out by a manager
    -- (per docs/superpowers/specs/2026-05-04-beo-fire-times.md). pin_hash
    -- is SHA-256(pin); the raw PIN is shown ONCE on issuance and never
    -- persisted. Validation in lib/tempPin.ts is fail-closed: a malformed
    -- expires_at or scopes_json column reads as expired / no scopes.
    CREATE TABLE IF NOT EXISTS temp_pins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id TEXT NOT NULL DEFAULT 'default',
      pin_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      issued_by TEXT,
      issued_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    -- Partial index on the hot path: "is this PIN active right now?"
    CREATE INDEX IF NOT EXISTS idx_temp_pins_active
      ON temp_pins(location_id, expires_at)
      WHERE revoked_at IS NULL;

    -- BEO courses (per docs/superpowers/specs/2026-05-04-beo-fire-times.md).
    -- A course groups one or more beo_line_items under a single fire time.
    -- fire_at is canonical ISO-8601 UTC; the line_items inherit it via FK
    -- so drift is structurally impossible. ON DELETE CASCADE: deleting an
    -- event drops its courses; child line_items.course_id is set NULL by
    -- the FK on beo_line_items (added in migrateLegacyColumns below).
    CREATE TABLE IF NOT EXISTS beo_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      course_label TEXT NOT NULL,
      fire_at TEXT NOT NULL,
      notes TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_courses_loc_fire
      ON beo_courses(location_id, fire_at);
    CREATE INDEX IF NOT EXISTS idx_beo_courses_event
      ON beo_courses(event_id, sort_order);

    -- Client-facing BEO signatures. One row per client confirmation on the
    -- public share link. Append-only by API convention — corrections are a
    -- fresh row (mirrors audit_events). signed_name is the typed-out
    -- representative; ip_addr + user_agent are caller-asserted but stored
    -- as the only attribution signal we have on the unauthenticated path.
    CREATE TABLE IF NOT EXISTS beo_signatures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      location_id TEXT NOT NULL DEFAULT 'default',
      signed_name TEXT NOT NULL,
      signed_at TEXT NOT NULL DEFAULT (datetime('now')),
      ip_addr TEXT,
      user_agent TEXT,
      FOREIGN KEY (event_id) REFERENCES beo_events(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_beo_signatures_event
      ON beo_signatures(event_id, signed_at);
  `);
}
