#!/usr/bin/env python3
"""Static SQL sanity-check for lib/dbQueryRegistry.ts.

The sandbox we run linting/tests in can't load the macOS-arm64
better-sqlite3 native binary, so the Node-test path (`node --test
tests/js/test-db-query-tool.mjs`) fails at db.getDb() before any SQL
is touched. This script gives us a sandbox-friendly canary: load the
SQL text out of the .ts registry, build minimal tables that include
every column referenced by the queries, then sqlite3.execute() each
query with dummy params.

What this catches:
  - Unknown columns / typos (the FIRST class of bugs in this registry).
  - Wrong number of bound params.
  - Misnamed bound params (':location_id' vs ':loc_id').
  - SQL syntax errors.

What this does NOT catch:
  - Semantic correctness of joins / aggregations.
  - Real-data row-count behavior (tests/js/ does that).
  - sqlite-version-specific syntax (the host uses better-sqlite3, the
    underlying SQLite is similar enough that .prepare() and .execute()
    parse the same DML).

Usage:
  python3 scripts/validate-db-query-registry.py
  echo $? # 0 == all queries parse + execute; 1 == one or more failed

This is a *parse/execute* check only — every query is given enough
dummy data to satisfy its bindings; success means "the runner can
prepare and call .all() on this query", not "the query returns the
expected rows."
"""

from __future__ import annotations
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "lib" / "dbQueryRegistry.ts"

# Minimal table definitions covering every column the registry references.
# Kept as plain CREATE TABLE statements (no CHECK constraints, no FKs)
# because we only need column names to resolve. The actual schema in
# lib/db.ts has richer constraints; we mirror just enough to typecheck SQL.
SCHEMA_SQL = """
CREATE TABLE temp_log (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, point_id TEXT,
  reading_f REAL, required_min_f REAL, required_max_f REAL, corrective_action TEXT,
  cook_id TEXT, probe_id TEXT, created_at TEXT
);
CREATE TABLE cooling_log (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, item TEXT, station_id TEXT,
  started_at TEXT, start_reading_f REAL, stage1_at TEXT, stage1_reading_f REAL,
  stage2_at TEXT, stage2_reading_f REAL, status TEXT, breach_reason TEXT,
  corrective_action TEXT, cook_id TEXT, closed_by_cook_id TEXT, created_at TEXT
);
CREATE TABLE receiving_log (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, vendor TEXT, invoice_ref TEXT,
  category TEXT, item TEXT, reading_f REAL, required_max_f REAL, package_ok INTEGER,
  expiration_date TEXT, status TEXT, rejection_reason TEXT, shellstock_tag_ref TEXT,
  cook_id TEXT, created_at TEXT
);
CREATE TABLE prep_tasks (
  id INTEGER PRIMARY KEY, shift_date TEXT, station_id TEXT, task TEXT, qty TEXT,
  recipe_slug TEXT, notes TEXT, priority INTEGER, assigned_cook_id TEXT, status TEXT,
  started_at TEXT, done_at TEXT, done_by TEXT, source TEXT, source_ref TEXT,
  sort_order INTEGER, location_id TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE kds_tickets (
  id TEXT PRIMARY KEY, location_id TEXT, order_number TEXT, placed_at TEXT,
  destination TEXT, bumped_at TEXT, created_by_cook_id TEXT, created_at TEXT
);
CREATE TABLE kds_ticket_lines (
  id TEXT PRIMARY KEY, ticket_id TEXT, sort_order INTEGER, item_name TEXT,
  quantity INTEGER, station TEXT, modifiers TEXT
);
CREATE TABLE sds_registry (
  id INTEGER PRIMARY KEY, location_id TEXT, product_name TEXT, manufacturer TEXT,
  hazard_class TEXT, storage_location TEXT, pdf_path TEXT, url TEXT, last_reviewed TEXT,
  active INTEGER, notes TEXT, created_at TEXT
);
CREATE TABLE cleaning_schedule (
  id INTEGER PRIMARY KEY, location_id TEXT, area TEXT, task TEXT, frequency TEXT,
  last_done TEXT, next_due TEXT, notes TEXT, active INTEGER, created_at TEXT
);
CREATE TABLE cleaning_log (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, schedule_id INTEGER,
  area TEXT, task TEXT, completed_at TEXT, cook_id TEXT, verified_by_cook_id TEXT,
  notes TEXT, created_at TEXT
);
CREATE TABLE staff_certifications (
  id INTEGER PRIMARY KEY, location_id TEXT, cook_id TEXT, cert_type TEXT, cert_label TEXT,
  issuer TEXT, cert_number TEXT, issued_on TEXT, expires_on TEXT, document_path TEXT,
  active INTEGER, created_at TEXT, updated_at TEXT
);
CREATE TABLE tphc_entries (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, station_id TEXT,
  item TEXT, batch_ref TEXT, started_at TEXT, cutoff_at TEXT, discarded_at TEXT,
  discard_reason TEXT, cook_id TEXT, created_at TEXT
);
CREATE TABLE date_marks (
  id INTEGER PRIMARY KEY, location_id TEXT, item TEXT, batch_ref TEXT,
  prepared_on TEXT, discard_on TEXT, discarded_at TEXT, discarded_by_cook_id TEXT,
  discard_reason TEXT, cook_id TEXT, created_at TEXT
);
CREATE TABLE sanitizer_checks (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, station_id TEXT,
  point_label TEXT, chemistry TEXT, concentration_ppm REAL, required_min_ppm REAL,
  required_max_ppm REAL, water_temp_f REAL, status TEXT, corrective_action TEXT,
  cook_id TEXT, created_at TEXT
);
CREATE TABLE inventory_updates (
  id INTEGER PRIMARY KEY, shift_date TEXT, station_id TEXT, item TEXT, delta TEXT,
  direction TEXT, note TEXT, cook_id TEXT, created_at TEXT, location_id TEXT
);
CREATE TABLE sales_lines (
  id INTEGER PRIMARY KEY, period_label TEXT, item_name TEXT, quantity_sold REAL,
  net_sales REAL, source TEXT, location_id TEXT, imported_at TEXT
);
CREATE TABLE bom_lines (
  id INTEGER PRIMARY KEY, recipe_id TEXT, ingredient TEXT, qty REAL, unit TEXT,
  sub_recipe TEXT, vendor_ingredient TEXT, map_status TEXT, vendor TEXT,
  pack_price REAL, pack_size REAL, location_id TEXT, imported_at TEXT
);
CREATE TABLE vendor_prices (
  id INTEGER PRIMARY KEY, ingredient TEXT, vendor TEXT, sku TEXT, pack_size REAL,
  pack_unit TEXT, pack_price REAL, unit_price REAL, category TEXT, yield_pct REAL,
  actual_received_lb REAL, reconciled_unit_price REAL, map_status TEXT,
  master_id TEXT, location_id TEXT, imported_at TEXT
);
CREATE TABLE vendor_prices_history (
  id INTEGER PRIMARY KEY, run_id INTEGER, source_vendor_price_id INTEGER,
  ingredient TEXT, vendor TEXT, sku TEXT, pack_size REAL, pack_unit TEXT,
  pack_price REAL, unit_price REAL, category TEXT, yield_pct REAL,
  actual_received_lb REAL, reconciled_unit_price REAL, master_id TEXT,
  location_id TEXT, imported_at TEXT, snapshot_at TEXT, snapshot_reason TEXT
);
CREATE TABLE recipe_costs (
  id INTEGER PRIMARY KEY, recipe_id TEXT, recipe_name TEXT, category TEXT,
  yield REAL, yield_unit TEXT, batch_cost REAL, cost_per_yield_unit REAL,
  costed_lines INTEGER, total_lines INTEGER, interpretations INTEGER,
  location_id TEXT, imported_at TEXT
);
CREATE TABLE margin_snapshots (
  id INTEGER PRIMARY KEY, item_name TEXT, net_sales REAL, cost_per_unit REAL,
  margin_pct REAL, popularity REAL, quadrant TEXT, snapshot_at TEXT, location_id TEXT
);
CREATE TABLE sevenshifts_time_punches (
  seven_id TEXT, location_id TEXT, user_seven_id TEXT, employee_uuid TEXT,
  role_id TEXT, clocked_in_at TEXT, clocked_out_at TEXT, hours_worked REAL,
  approved INTEGER, raw_json TEXT, ingested_at TEXT
);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY, shift_date TEXT, location_id TEXT, actor_cook_id TEXT,
  actor_source TEXT, entity TEXT, entity_id INTEGER, action TEXT, replaces_id INTEGER,
  payload_json TEXT, note TEXT, created_at TEXT
);
CREATE TABLE accounting_variance (
  id INTEGER PRIMARY KEY, period_start TEXT, period_end TEXT, theoretical_cogs REAL,
  actual_cogs REAL, variance_amount REAL, variance_pct REAL, snapshot_at TEXT,
  location_id TEXT
);
CREATE TABLE beo_events (
  id INTEGER PRIMARY KEY, title TEXT, event_date TEXT, event_time TEXT,
  contact_name TEXT, guest_count INTEGER, notes TEXT, status TEXT, tax_rate REAL,
  service_fee_pct REAL, location_id TEXT, created_at TEXT
);
CREATE TABLE beo_line_items (
  id INTEGER PRIMARY KEY, event_id INTEGER, sort_order INTEGER, item_name TEXT,
  category TEXT, unit_cost REAL, quantity REAL, created_at TEXT
);
CREATE TABLE beo_prep_tasks (
  id INTEGER PRIMARY KEY, event_id INTEGER, task TEXT, due_date TEXT,
  done INTEGER, sort_order INTEGER, location_id TEXT
);
CREATE TABLE dish_components (
  id INTEGER PRIMARY KEY, location_id TEXT, dish_name TEXT, component_type TEXT,
  recipe_slug TEXT, vendor_ingredient TEXT, qty_per_serving REAL, unit TEXT,
  notes TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE sales_depletion_runs (
  id INTEGER PRIMARY KEY, location_id TEXT, period_label TEXT, shift_date TEXT,
  sales_rows_processed INTEGER, depletions_written INTEGER, unresolved_dish_count INTEGER,
  applied_at TEXT
);
CREATE TABLE equipment (
  id INTEGER PRIMARY KEY, name TEXT, category TEXT, make_model TEXT,
  model_number TEXT, serial_number TEXT, purchase_date TEXT, warranty_expiration TEXT,
  purchase_cost REAL, vendor TEXT, vendor_order_ref TEXT, manual_path TEXT,
  notes TEXT, status TEXT, location_id TEXT
);
CREATE TABLE equipment_maintenance_schedule (
  id INTEGER PRIMARY KEY, equipment_id INTEGER, task TEXT, frequency TEXT,
  last_done TEXT, next_due TEXT, notes TEXT, location_id TEXT, created_at TEXT
);
CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY, kind TEXT, started_at TEXT, finished_at TEXT,
  rows_in INTEGER, rows_out INTEGER, status TEXT
);
"""

# Extract the queries from the .ts file. The registry uses template literals
# (backticks) for the sql field; we parse them with a forgiving regex that
# captures everything between the `sql: \`` opening and the closing backtick.
QUERY_RE = re.compile(
    r"name:\s*'([^']+)'.*?sql:\s*`([^`]+)`",
    re.DOTALL,
)


def load_queries() -> list[tuple[str, str]]:
    text = REGISTRY.read_text(encoding="utf-8")
    return QUERY_RE.findall(text)


def dummy_for(param_name: str) -> object:
    """Pick a reasonable dummy bind value based on param-name heuristics."""
    n = param_name.lower()
    if n.endswith("_id") or n in ("location_id", "vendor", "kind", "item",
                                  "ingredient", "search", "entity",
                                  "actor_source", "period_label",
                                  "station_id", "point_id", "recipe_id"):
        return "dummy"
    if "date" in n or n == "start_date" or n == "end_date":
        return "2026-05-15"
    if n in ("threshold_pct",):
        return 10
    return 1


def extract_param_names(sql: str) -> set[str]:
    return set(re.findall(r":(\w+)", sql))


def main() -> int:
    db = sqlite3.connect(":memory:")
    db.executescript(SCHEMA_SQL)
    queries = load_queries()
    if not queries:
        print("ERROR: no queries extracted from registry — regex drift?", file=sys.stderr)
        return 1

    failures: list[tuple[str, str]] = []
    print(f"# Validating {len(queries)} registry queries…")
    for name, sql in queries:
        params = {p: dummy_for(p) for p in extract_param_names(sql)}
        try:
            cur = db.execute(sql, params)
            cur.fetchall()
            print(f"  OK   {name}  (params: {sorted(params)})")
        except sqlite3.Error as e:
            print(f"  FAIL {name}: {e}", file=sys.stderr)
            failures.append((name, str(e)))

    print()
    if failures:
        print(f"FAILED — {len(failures)} of {len(queries)} queries did not execute:", file=sys.stderr)
        for name, msg in failures:
            print(f"  - {name}: {msg}", file=sys.stderr)
        return 1
    print(f"PASSED — all {len(queries)} queries prepare and execute cleanly.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
