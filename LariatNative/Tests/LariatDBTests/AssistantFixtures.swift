import Foundation
import GRDB
@testable import LariatDB
@testable import LariatModel

/// Seeds a temp WAL SQLite file with the REAL web schema (lib/db.ts) for every
/// table the kitchen-assistant vertical touches. Never touches data/lariat.db.
func seedAssistantDatabase() throws -> String {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("lariat-assistant-test-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let path = dir.appendingPathComponent("lariat.db").path
    let pool = try DatabasePool(path: path)
    try pool.write { db in
        try db.execute(sql: """
            -- lib/db.ts ~L1014
            CREATE TABLE eighty_six (
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
            -- lib/db.ts ~L1030 (web KA columns, NOT the commandCenter variant)
            CREATE TABLE inventory_updates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT,
              item TEXT NOT NULL,
              master_id TEXT,
              delta TEXT,
              direction TEXT,
              note TEXT,
              cook_id TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default'
            );
            -- lib/db.ts ~L983
            CREATE TABLE line_check_entries (
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
              glove_change_attested INTEGER,
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default'
            );
            CREATE TABLE station_signoffs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              shift_date TEXT NOT NULL,
              station_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              signoff_type TEXT NOT NULL DEFAULT 'self',
              created_at TEXT DEFAULT (datetime('now')),
              location_id TEXT DEFAULT 'default'
            );
            -- lib/db.ts ~L1690
            CREATE TABLE equipment (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              category TEXT NOT NULL DEFAULT 'cooking',
              make_model TEXT,
              serial_number TEXT,
              purchase_date TEXT,
              warranty_expiration TEXT,
              purchase_cost REAL,
              status TEXT DEFAULT 'active',
              location_id TEXT DEFAULT 'default',
              -- migrateLegacyColumns additions (lib/db.ts ~L3500)
              model_number TEXT,
              vendor TEXT,
              vendor_order_ref TEXT,
              manual_path TEXT,
              notes TEXT
            );
            CREATE TABLE equipment_maintenance (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              equipment_id INTEGER NOT NULL,
              service_date TEXT NOT NULL,
              type TEXT NOT NULL,
              cost REAL,
              notes TEXT,
              receipt_reference TEXT,
              cook_id TEXT,
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            -- lib/db.ts ~L1548
            CREATE TABLE order_guide_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              ingredient TEXT NOT NULL,
              base_qty REAL,
              unit TEXT,
              vendor TEXT,
              unit_price REAL,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now')),
              is_placeholder INTEGER DEFAULT 0
            );
            -- lib/db.ts ~L1750
            CREATE TABLE gold_stars (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cook_name TEXT NOT NULL,
              reason TEXT NOT NULL,
              stars INTEGER DEFAULT 1,
              awarded_date TEXT DEFAULT (date('now')),
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now')),
              deleted_at TEXT,
              deleted_by TEXT
            );
            -- lib/db.ts ~L2195
            CREATE TABLE entities_employees (
              uuid TEXT PRIMARY KEY,
              display_name TEXT NOT NULL,
              primary_email TEXT,
              primary_phone TEXT,
              active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            -- lib/db.ts ~L1619
            CREATE TABLE beo_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              event_date TEXT,
              event_time TEXT,
              contact_name TEXT,
              guest_count INTEGER,
              notes TEXT,
              status TEXT DEFAULT 'planned',
              location_id TEXT DEFAULT 'default',
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE beo_line_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              sort_order INTEGER DEFAULT 0,
              item_name TEXT NOT NULL,
              category TEXT,
              unit_cost REAL NOT NULL DEFAULT 0,
              quantity REAL NOT NULL DEFAULT 1,
              prep_notes TEXT,
              secondary_prep_notes TEXT,
              order_items_notes TEXT,
              group_note TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE beo_prep_tasks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_id INTEGER NOT NULL,
              task TEXT NOT NULL,
              due_date TEXT,
              done INTEGER DEFAULT 0,
              sort_order INTEGER DEFAULT 0,
              location_id TEXT DEFAULT 'default'
            );
            CREATE TABLE beo_prep_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              client TEXT,
              event_date TEXT,
              event_file TEXT,
              type TEXT,
              item TEXT NOT NULL,
              amount_qty TEXT,
              prep_day TEXT,
              pre_prep_notes TEXT,
              plating_notes TEXT,
              source TEXT NOT NULL DEFAULT 'test',
              imported_at TEXT DEFAULT (datetime('now'))
            );
            -- lib/db.ts ~L3060
            CREATE TABLE lari_conversation_turns (
              schemaVersion TEXT NOT NULL DEFAULT 'lari_conversation_turn_v1'
                CHECK(schemaVersion = 'lari_conversation_turn_v1'),
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL,
              cook_id TEXT NOT NULL,
              conversation_session_id TEXT NOT NULL,
              user_content TEXT NOT NULL,
              assistant_content TEXT NOT NULL,
              manager_tier INTEGER NOT NULL DEFAULT 0 CHECK(manager_tier IN (0, 1)),
              created_at TEXT NOT NULL DEFAULT (datetime('now')),
              expires_at TEXT NOT NULL
            );
            -- lib/db.ts ~L2910 (audit trail)
            CREATE TABLE audit_events (
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
            -- manager-tier context sections
            CREATE TABLE sales_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              period_label TEXT,
              item_name TEXT NOT NULL,
              quantity_sold REAL,
              net_sales REAL,
              source TEXT,
              location_id TEXT DEFAULT 'default',
              imported_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE toast_sales_daily (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              location_id TEXT NOT NULL DEFAULT 'default',
              shift_date TEXT NOT NULL,
              net_sales REAL,
              orders INTEGER,
              guests INTEGER,
              comparison_group INTEGER NOT NULL DEFAULT 1,
              date_range TEXT
            );
            CREATE TABLE performance_reviews (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              cook_name TEXT NOT NULL,
              cook_uuid TEXT,
              review_date TEXT NOT NULL,
              punctuality_score INTEGER,
              technique_score INTEGER,
              speed_score INTEGER,
              notes TEXT,
              reviewer_name TEXT NOT NULL,
              location_id TEXT NOT NULL DEFAULT 'default',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            """)
    }
    return path
}

func cleanupAssistantDatabase(_ path: String) {
    try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent)
}

/// Stub calculator for the calculator-backed actions — the web suites never
/// spawn the python CLI either (undo test pins multiplier 0 explicitly).
final class StubRecipeCalculator: RecipeCalculating, @unchecked Sendable {
    var scaleResult: Result<RecipeExpandResult, RecipeCalculatorError>?
    var beoResult: Result<[RecipeExpandResult], RecipeCalculatorError>?
    private(set) var scaleCalls: [(slug: String, multiplier: Double)] = []
    private(set) var beoCalls: [(recipes: [(slug: String, portionsPerGuest: Double)], guestCount: Double)] = []

    func scaleRecipe(slug: String, multiplier: Double) async throws -> RecipeExpandResult {
        scaleCalls.append((slug, multiplier))
        switch scaleResult {
        case .success(let r): return r
        case .failure(let e): throw e
        case nil: throw RecipeCalculatorError("stub not configured", code: "stub")
        }
    }

    func expandForBEO(
        recipes: [(slug: String, portionsPerGuest: Double)], guestCount: Double
    ) async throws -> [RecipeExpandResult] {
        beoCalls.append((recipes, guestCount))
        switch beoResult {
        case .success(let r): return r
        case .failure(let e): throw e
        case nil: throw RecipeCalculatorError("stub not configured", code: "stub")
        }
    }
}
