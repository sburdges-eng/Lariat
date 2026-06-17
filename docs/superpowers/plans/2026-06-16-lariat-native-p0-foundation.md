# Lariat Native P0 Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Tasks are a **dependency chain — run sequentially, not in parallel.**

**Goal:** A macOS SwiftUI app that opens the live `lariat.db` via GRDB and renders a read-only Management-rollup proof slice, proving the shared-DB foundation end-to-end.

**Architecture:** New `LariatNative/` SwiftPM package, `Lariat-KDS`-style Core/App split. `LariatDB` (GRDB pool + path resolution + repositories), `LariatModel` (record types + invariant-primitive contracts), `LariatApp` (SwiftUI macOS shell). Reads only; the web app owns the schema and migrations.

**Tech Stack:** Swift 6.3, GRDB.swift 6.29.x, SwiftUI (macOS 13+), XCTest (host-run via `swift test`).

**Design notes / spec corrections** (from planning):
- **Cross-process change detection:** GRDB `ValueObservation` only observes same-process writes, so it will NOT see the Node web app's writes. P0 refreshes via **polling** (Task 8). WAL-file watching is a later optimization. (This supersedes the spec's "ValueObservation for live updates.")
- **P0 proof scope tightening:** P0 renders **3 representative tiles** covering the three distinct read patterns — *latest-single-row* (accounting variance), *latest-snapshot* (dish coverage), *count* (unacknowledged pack-size changes). The other 3 rollup sources (depletion exceptions, price shocks, costing freshness) are mechanical repeats and complete the rollup in **P1**. P0 is a foundation proof, not the full rollup.

---

## File structure

```
LariatNative/
  Package.swift
  Sources/
    LariatModel/
      InvariantContracts.swift     # AuditedWrite, RuleGate, PinGate protocols
      LocationScope.swift          # location resolution (used by reads)
      Records.swift                # AccountingVariance, DishCoverageSnapshot, PackSizeChange
    LariatDB/
      DatabasePaths.swift          # resolveDatabasePath()
      LariatDatabase.swift         # read-only DatabasePool open + pragmas
      ManagementRollupRepository.swift  # queries + RollupSnapshot + polling stream
    LariatApp/
      LariatApp.swift              # @main App, NavigationSplitView shell, DI
      ManagementRollupView.swift   # tiles + @Observable ViewModel
      Money.swift                  # formatDollars()
  Tests/
    LariatModelTests/RecordsTests.swift
    LariatDBTests/
      DatabasePathsTests.swift
      LariatDatabaseTests.swift
      ManagementRollupRepositoryTests.swift
      Fixtures.swift               # seedFixtureDatabase(at:)
```

---

## Task 1: Scaffold the LariatNative package

**Files:**
- Create: `LariatNative/Package.swift`
- Create: stub sources for each target (so it builds)

- [ ] **Step 1: Write `Package.swift`**

```swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LariatNative",
    platforms: [.macOS(.v13), .iOS(.v16)],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.29.0")
    ],
    targets: [
        .target(name: "LariatModel"),
        .target(
            name: "LariatDB",
            dependencies: [
                "LariatModel",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
        .executableTarget(
            name: "LariatApp",
            dependencies: ["LariatDB", "LariatModel"]
        ),
        .testTarget(name: "LariatModelTests", dependencies: ["LariatModel"]),
        .testTarget(
            name: "LariatDBTests",
            dependencies: [
                "LariatDB",
                .product(name: "GRDB", package: "GRDB.swift")
            ]
        ),
    ]
)
```

- [ ] **Step 2: Add stub sources so each target compiles**

```bash
mkdir -p LariatNative/Sources/{LariatModel,LariatDB,LariatApp} LariatNative/Tests/{LariatModelTests,LariatDBTests}
printf 'public enum LariatModel {}\n' > LariatNative/Sources/LariatModel/Placeholder.swift
printf 'public enum LariatDB {}\n' > LariatNative/Sources/LariatDB/Placeholder.swift
printf 'import SwiftUI\n@main struct LariatApp: App { var body: some Scene { WindowGroup { Text("Lariat") } } }\n' > LariatNative/Sources/LariatApp/LariatApp.swift
printf 'import XCTest\nfinal class Smoke: XCTestCase { func testSmoke() { XCTAssertTrue(true) } }\n' > LariatNative/Tests/LariatModelTests/Smoke.swift
printf 'import XCTest\nfinal class Smoke: XCTestCase { func testSmoke() { XCTAssertTrue(true) } }\n' > LariatNative/Tests/LariatDBTests/Smoke.swift
```

- [ ] **Step 3: Build + test (fetches GRDB)**

Run: `cd LariatNative && swift build && swift test`
Expected: build succeeds; smoke tests pass.

- [ ] **Step 4: Commit**

```bash
git add LariatNative
git commit -m "feat(native): scaffold LariatNative SwiftPM package (GRDB, Core/App split)"
```

---

## Task 2: DB path resolution (mirror lib/dataDir.ts)

**Files:**
- Create: `LariatNative/Sources/LariatDB/DatabasePaths.swift`
- Test: `LariatNative/Tests/LariatDBTests/DatabasePathsTests.swift`

Web behavior (`lib/dataDir.ts`): data dir = `LARIAT_DATA_DIR` if set (absolute or relative-to-cwd), else `<cwd>/data`. DB file = `<dataDir>/lariat.db`.

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import LariatDB

final class DatabasePathsTests: XCTestCase {
    func testHonorsEnvAbsolute() {
        let p = resolveDatabasePath(env: ["LARIAT_DATA_DIR": "/srv/lariat"], cwd: "/work")
        XCTAssertEqual(p, "/srv/lariat/lariat.db")
    }
    func testEnvRelativeResolvesAgainstCwd() {
        let p = resolveDatabasePath(env: ["LARIAT_DATA_DIR": "var/db"], cwd: "/work")
        XCTAssertEqual(p, "/work/var/db/lariat.db")
    }
    func testDefaultsToCwdData() {
        let p = resolveDatabasePath(env: [:], cwd: "/work")
        XCTAssertEqual(p, "/work/data/lariat.db")
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter DatabasePathsTests`
Expected: FAIL (`resolveDatabasePath` undefined).

- [ ] **Step 3: Implement**

```swift
import Foundation

/// Mirrors lib/dataDir.ts: data dir = LARIAT_DATA_DIR (absolute, or relative to cwd),
/// else <cwd>/data. The DB file is <dataDir>/lariat.db.
public func resolveDatabasePath(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    let dataDir: String
    if let raw = env["LARIAT_DATA_DIR"], !raw.isEmpty {
        dataDir = (raw as NSString).isAbsolutePath ? raw : (cwd as NSString).appendingPathComponent(raw)
    } else {
        dataDir = (cwd as NSString).appendingPathComponent("data")
    }
    return (dataDir as NSString).appendingPathComponent("lariat.db")
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter DatabasePathsTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/DatabasePaths.swift LariatNative/Tests/LariatDBTests/DatabasePathsTests.swift
git commit -m "feat(native): DB path resolution mirroring lib/dataDir.ts"
```

---

## Task 3: Test fixtures + read-only DatabasePool

**Files:**
- Create: `LariatNative/Tests/LariatDBTests/Fixtures.swift`
- Create: `LariatNative/Sources/LariatDB/LariatDatabase.swift`
- Test: `LariatNative/Tests/LariatDBTests/LariatDatabaseTests.swift`

- [ ] **Step 1: Write the fixture helper** (the subset of schema P0 reads)

```swift
import Foundation
import GRDB

/// Creates a temp SQLite file seeded with the P0 rollup tables + rows.
/// Returns the file path; caller deletes it.
func seedFixtureDatabase() throws -> String {
    let dir = NSTemporaryDirectory() + "lariat-fixture-" + UUID().uuidString
    try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("lariat.db")
    let q = try DatabaseQueue(path: path)
    try q.write { db in
        try db.execute(sql: """
            CREATE TABLE accounting_variance (
              id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
              theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL,
              snapshot_at TEXT);
            CREATE TABLE dish_coverage_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT, location_id TEXT NOT NULL DEFAULT 'default',
              total_dishes INTEGER, covered_dishes INTEGER, coverage_pct REAL,
              uncovered_dishes TEXT, created_by TEXT, snapshot_at TEXT);
            CREATE TABLE pack_size_changes (
              id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT NOT NULL, sku TEXT NOT NULL,
              prev_pack TEXT, new_pack TEXT, prev_price REAL, new_price REAL,
              detected_at TEXT, acknowledged INTEGER DEFAULT 0);
            INSERT INTO accounting_variance (location_id, theoretical_cogs, actual_cogs, variance_amount, variance_pct, snapshot_at)
              VALUES ('default', 1000.0, 1120.0, 120.0, 12.0, '2026-06-15 10:00:00'),
                     ('default', 900.0, 950.0, 50.0, 5.5, '2026-06-16 10:00:00');
            INSERT INTO dish_coverage_snapshots (location_id, total_dishes, covered_dishes, coverage_pct, uncovered_dishes, created_by, snapshot_at)
              VALUES ('default', 73, 70, 95.9, '["soup","amuse"]', 'compute_engine', '2026-06-16 10:00:00');
            INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, prev_price, new_price, detected_at, acknowledged)
              VALUES ('Sysco','A1','6x#10','4x#10',40,38,'2026-06-16',0),
                     ('Sysco','A2','1cs','1cs',20,21,'2026-06-16',1);
            """)
    }
    return path
}
```

- [ ] **Step 2: Write the failing test for the pool**

```swift
import XCTest
import GRDB
@testable import LariatDB

final class LariatDatabaseTests: XCTestCase {
    func testOpensReadOnlyAndReads() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatDatabase(path: path)
        let count = try db.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM accounting_variance") }
        XCTAssertEqual(count, 2)
    }

    func testRejectsWrites() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let db = try LariatDatabase(path: path)
        XCTAssertThrowsError(try db.pool.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku) VALUES ('x','y')") })
    }
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd LariatNative && swift test --filter LariatDatabaseTests`
Expected: FAIL (`LariatDatabase` undefined).

- [ ] **Step 4: Implement the read-only pool**

```swift
import Foundation
import GRDB

/// Read-only GRDB pool over the shared lariat.db. The web app owns the schema and
/// migrations — this NEVER writes or migrates. WAL allows concurrent web-side writes.
public struct LariatDatabase {
    public let pool: DatabasePool

    public init(path: String = resolveDatabasePath()) throws {
        var config = Configuration()
        config.readonly = true
        config.busyMode = .timeout(5.0)            // wait out web-side write locks
        config.foreignKeysEnabled = true
        self.pool = try DatabasePool(path: path, configuration: config)
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd LariatNative && swift test --filter LariatDatabaseTests`
Expected: PASS (read works; write throws because readonly).

- [ ] **Step 6: Commit**

```bash
git add LariatNative/Sources/LariatDB/LariatDatabase.swift LariatNative/Tests/LariatDBTests/Fixtures.swift LariatNative/Tests/LariatDBTests/LariatDatabaseTests.swift
git commit -m "feat(native): read-only GRDB DatabasePool + test fixtures"
```

---

## Task 4: Record types (LariatModel)

**Files:**
- Create: `LariatNative/Sources/LariatModel/Records.swift`
- Test: `LariatNative/Tests/LariatModelTests/RecordsTests.swift`

Decode by column name; tolerate extra columns from web-side migrations.

- [ ] **Step 1: Write the failing test** (uses GRDB row decoding against an in-memory DB)

```swift
import XCTest
import GRDB
@testable import LariatModel

final class RecordsTests: XCTestCase {
    func testDecodeAccountingVariance() throws {
        let q = try DatabaseQueue()
        try q.write { db in
            try db.execute(sql: "CREATE TABLE accounting_variance (id INTEGER, location_id TEXT, theoretical_cogs REAL, actual_cogs REAL, variance_amount REAL, variance_pct REAL, snapshot_at TEXT, extra TEXT)")
            try db.execute(sql: "INSERT INTO accounting_variance VALUES (1,'default',1000,1120,120,12,'2026-06-16','ignored')")
        }
        let row = try q.read { try AccountingVariance.fetchOne($0, sql: "SELECT * FROM accounting_variance") }
        XCTAssertEqual(row?.theoreticalCogs, 1000)
        XCTAssertEqual(row?.actualCogs, 1120)
        XCTAssertEqual(row?.locationId, "default")
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter RecordsTests`
Expected: FAIL (`AccountingVariance` undefined).

- [ ] **Step 3: Implement the three record types**

```swift
import GRDB

public struct AccountingVariance: FetchableRecord, Decodable {
    public let locationId: String
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let varianceAmount: Double?
    public let variancePct: Double?
    public let snapshotAt: String?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case theoreticalCogs = "theoretical_cogs"
        case actualCogs = "actual_cogs"
        case varianceAmount = "variance_amount"
        case variancePct = "variance_pct"
        case snapshotAt = "snapshot_at"
    }
}

public struct DishCoverageSnapshot: FetchableRecord, Decodable {
    public let locationId: String
    public let totalDishes: Int?
    public let coveredDishes: Int?
    public let coveragePct: Double?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case totalDishes = "total_dishes"
        case coveredDishes = "covered_dishes"
        case coveragePct = "coverage_pct"
    }
}

public struct PackSizeChange: FetchableRecord, Decodable {
    public let id: Int64
    public let vendor: String
    public let sku: String
    public let acknowledged: Bool
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter RecordsTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/Records.swift LariatNative/Tests/LariatModelTests/RecordsTests.swift
git commit -m "feat(native): rollup record types (column-name decoding, tolerant of extra columns)"
```

---

## Task 5: LocationScope + invariant contracts (LariatModel)

**Files:**
- Create: `LariatNative/Sources/LariatModel/LocationScope.swift`
- Create: `LariatNative/Sources/LariatModel/InvariantContracts.swift`
- Test: `LariatNative/Tests/LariatModelTests/LocationScopeTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import LariatModel

final class LocationScopeTests: XCTestCase {
    func testDefault() { XCTAssertEqual(LocationScope.resolve(env: [:]), "default") }
    func testFromEnv() { XCTAssertEqual(LocationScope.resolve(env: ["LARIAT_LOCATION_ID": "venue-2"]), "venue-2") }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter LocationScopeTests`
Expected: FAIL.

- [ ] **Step 3: Implement LocationScope + the write-phase contracts**

```swift
// LocationScope.swift
import Foundation
public enum LocationScope {
    public static func resolve(env: [String: String] = ProcessInfo.processInfo.environment) -> String {
        let v = env["LARIAT_LOCATION_ID"]
        return (v?.isEmpty == false) ? v! : "default"
    }
}
```

```swift
// InvariantContracts.swift — contracts implemented in write phases (P2+). Declared now so
// every future writer is forced through them, matching the web app's invariants.
public protocol AuditedWrite {
    /// Perform a source-row write AND its audit-event in one transaction (both roll back together).
    associatedtype Result
    func performAudited() throws -> Result
}

public protocol RuleGate {
    /// The HACCP needs_corrective_action 422 contract: reject a write that violates a binding rule.
    func validate() throws
}

public protocol PinGate {
    /// Manager-PIN gate for protected writes.
    func requirePin() throws
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter LocationScopeTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatModel/LocationScope.swift LariatNative/Sources/LariatModel/InvariantContracts.swift LariatNative/Tests/LariatModelTests/LocationScopeTests.swift
git commit -m "feat(native): LocationScope + invariant-primitive contracts"
```

---

## Task 6: Management rollup repository (LariatDB)

**Files:**
- Create: `LariatNative/Sources/LariatDB/ManagementRollupRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/ManagementRollupRepositoryTests.swift`

- [ ] **Step 1: Write the failing test**

```swift
import XCTest
@testable import LariatDB
@testable import LariatModel

final class ManagementRollupRepositoryTests: XCTestCase {
    func testLoadsLatestVarianceCoverageAndUnackCount() throws {
        let path = try seedFixtureDatabase()
        defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
        let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
        let snap = try repo.load()
        XCTAssertEqual(snap.variance?.actualCogs, 950)        // latest by snapshot_at
        XCTAssertEqual(snap.coverage?.coveragePct, 95.9)
        XCTAssertEqual(snap.unacknowledgedPackSizeChanges, 1) // one row acknowledged=0
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter ManagementRollupRepositoryTests`
Expected: FAIL.

- [ ] **Step 3: Implement the repository + snapshot value type**

```swift
import Foundation
import GRDB
import LariatModel

public struct RollupSnapshot: Equatable {
    public let variance: AccountingVarianceView?
    public let coverage: DishCoverageView?
    public let unacknowledgedPackSizeChanges: Int
}
// Equatable projections (records aren't Equatable):
public struct AccountingVarianceView: Equatable { public let theoreticalCogs: Double; public let actualCogs: Double; public let variancePct: Double? }
public struct DishCoverageView: Equatable { public let coveragePct: Double?; public let totalDishes: Int?; public let coveredDishes: Int? }

public struct ManagementRollupRepository {
    let database: LariatDatabase
    let locationId: String
    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database; self.locationId = locationId
    }

    public func load() throws -> RollupSnapshot {
        try database.pool.read { db in
            let v = try AccountingVariance.fetchOne(db,
                sql: "SELECT * FROM accounting_variance WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let c = try DishCoverageSnapshot.fetchOne(db,
                sql: "SELECT * FROM dish_coverage_snapshots WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let unack = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged = 0") ?? 0
            return RollupSnapshot(
                variance: v.map { AccountingVarianceView(theoreticalCogs: $0.theoreticalCogs, actualCogs: $0.actualCogs, variancePct: $0.variancePct) },
                coverage: c.map { DishCoverageView(coveragePct: $0.coveragePct, totalDishes: $0.totalDishes, coveredDishes: $0.coveredDishes) },
                unacknowledgedPackSizeChanges: unack)
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter ManagementRollupRepositoryTests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/ManagementRollupRepository.swift LariatNative/Tests/LariatDBTests/ManagementRollupRepositoryTests.swift
git commit -m "feat(native): management rollup repository (latest variance/coverage + unack count)"
```

---

## Task 7: Polling refresh stream (cross-process live updates)

**Files:**
- Modify: `LariatNative/Sources/LariatDB/ManagementRollupRepository.swift`
- Test: `LariatNative/Tests/LariatDBTests/ManagementRollupRepositoryTests.swift`

GRDB observation can't see the web app's writes (different process), so refresh by re-querying on an interval.

- [ ] **Step 1: Write the failing test** (the stream yields, and re-load reflects a later external write)

```swift
func testReloadReflectsExternalWrite() throws {
    let path = try seedFixtureDatabase()
    defer { try? FileManager.default.removeItem(atPath: (path as NSString).deletingLastPathComponent) }
    let repo = ManagementRollupRepository(database: try LariatDatabase(path: path), locationId: "default")
    XCTAssertEqual(try repo.load().unacknowledgedPackSizeChanges, 1)
    // Simulate the web app writing (separate connection):
    let writer = try DatabaseQueue(path: path)
    try writer.write { try $0.execute(sql: "INSERT INTO pack_size_changes (vendor,sku,acknowledged) VALUES ('X','Z',0)") }
    XCTAssertEqual(try repo.load().unacknowledgedPackSizeChanges, 2)
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd LariatNative && swift test --filter ManagementRollupRepositoryTests/testReloadReflectsExternalWrite`
Expected: FAIL until the read-pool reliably sees external writes. (If it already passes, keep the test as a regression guard.)

- [ ] **Step 3: Add the polling stream**

```swift
extension ManagementRollupRepository {
    /// Re-queries every `interval` seconds. SwiftUI consumes this to refresh tiles,
    /// since the web app writes the shared DB from another process.
    public func stream(every interval: Duration = .seconds(3)) -> AsyncStream<RollupSnapshot> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    if let snap = try? load() { continuation.yield(snap) }
                    try? await Task.sleep(for: interval)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd LariatNative && swift test --filter ManagementRollupRepositoryTests`
Expected: PASS (all repository tests).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatDB/ManagementRollupRepository.swift LariatNative/Tests/LariatDBTests/ManagementRollupRepositoryTests.swift
git commit -m "feat(native): polling refresh stream for cross-process updates"
```

---

## Task 8: SwiftUI shell + Management rollup screen (LariatApp)

**Files:**
- Modify: `LariatNative/Sources/LariatApp/LariatApp.swift`
- Create: `LariatNative/Sources/LariatApp/ManagementRollupView.swift`
- Create: `LariatNative/Sources/LariatApp/Money.swift`

Not TDD (UI). Verification = compiles + manual launch.

- [ ] **Step 1: Money formatter** (mirror lib/formatMoney whole-dollar default)

```swift
import Foundation
public func formatDollars(_ value: Double, decimals: Int = 0) -> String {
    let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "USD"
    f.minimumFractionDigits = decimals; f.maximumFractionDigits = decimals
    return f.string(from: value as NSNumber) ?? "$\(value)"
}
```

- [ ] **Step 2: The rollup view + @Observable ViewModel**

```swift
import SwiftUI
import LariatDB
import LariatModel

@Observable @MainActor final class ManagementRollupViewModel {
    var snapshot: RollupSnapshot?
    var errorText: String?
    private var streamTask: Task<Void, Never>?

    func start() {
        streamTask?.cancel()
        do {
            let repo = ManagementRollupRepository(database: try LariatDatabase())
            streamTask = Task { for await s in repo.stream() { self.snapshot = s; self.errorText = nil } }
        } catch {
            errorText = "Can't open lariat.db at \(resolveDatabasePath()): \(error.localizedDescription)"
        }
    }
    func stop() { streamTask?.cancel() }
}

struct ManagementRollupView: View {
    @State private var vm = ManagementRollupViewModel()
    var body: some View {
        Group {
            if let err = vm.errorText { ContentUnavailableView("Database unavailable", systemImage: "externaldrive.badge.xmark", description: Text(err)) }
            else if let s = vm.snapshot {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220))], spacing: 16) {
                        Tile(title: "COGS variance", value: s.variance.map { formatDollars($0.actualCogs - $0.theoreticalCogs) } ?? "—",
                             sub: s.variance?.variancePct.map { String(format: "%.1f%%", $0) })
                        Tile(title: "Dish coverage", value: s.coverage?.coveragePct.map { String(format: "%.1f%%", $0) } ?? "—",
                             sub: s.coverage.map { "\($0.coveredDishes ?? 0)/\($0.totalDishes ?? 0)" })
                        Tile(title: "Pack-size changes", value: "\(s.unacknowledgedPackSizeChanges)", sub: "unacknowledged")
                    }.padding()
                }
            } else { ProgressView() }
        }
        .navigationTitle("Management")
        .task { vm.start() }
        .onDisappear { vm.stop() }
    }
}

private struct Tile: View {
    let title: String; let value: String; var sub: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.system(.title, design: .rounded)).bold()
            if let sub { Text(sub).font(.caption2).foregroundStyle(.tertiary) }
        }.frame(maxWidth: .infinity, alignment: .leading).padding().background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

- [ ] **Step 3: App shell with NavigationSplitView**

```swift
import SwiftUI

@main
struct LariatApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationSplitView {
                List { NavigationLink("Management", value: "management") }
                    .navigationTitle("Lariat")
            } detail: {
                ManagementRollupView()
            }
        }
    }
}
```

- [ ] **Step 4: Build the whole package**

Run: `cd LariatNative && swift build`
Expected: builds clean (App + Core).

- [ ] **Step 5: Commit**

```bash
git add LariatNative/Sources/LariatApp
git commit -m "feat(native): macOS shell + read-only Management rollup screen"
```

---

## Task 9: Full verification + real-DB smoke doc

**Files:**
- Create: `LariatNative/README.md`

- [ ] **Step 1: Full build + test**

Run: `cd LariatNative && swift build && swift test`
Expected: all targets build; all tests pass.

- [ ] **Step 2: Document the real-DB smoke** (in `LariatNative/README.md`)

```markdown
# LariatNative (P0 Foundation)

macOS app reading the live `lariat.db` (shared with the web app) via GRDB.

## Run against real data
LARIAT_DATA_DIR=/absolute/path/to/lariat/data swift run LariatApp
# Reads <LARIAT_DATA_DIR>/lariat.db read-only. The web app keeps writing; tiles poll every 3s.

## Test
swift test   # host-run Core tests; no simulator needed
```

- [ ] **Step 3: Commit**

```bash
git add LariatNative/README.md
git commit -m "docs(native): P0 README + real-DB smoke instructions"
```

---

## Self-review notes
- **Spec coverage:** modules (LariatDB/LariatModel/LariatApp) ✓; shared-DB read-only pool ✓; path resolution ✓; records ✓; invariant contracts ✓; rollup proof (3 tiles) ✓ (scope-tightened, noted); error handling (DB-unavailable, readonly) ✓; host tests ✓. Live-updates handled via polling (spec correction noted).
- **Deferred to P1:** the other 3 rollup tiles, manager writes, other manager surfaces.
- **Risks carried:** schema drift (mitigated by column-name decoding + extra-column tolerance); data-dir mismatch (Task 2 mirrors lib/dataDir.ts); cross-process freshness (Task 7 polling).
