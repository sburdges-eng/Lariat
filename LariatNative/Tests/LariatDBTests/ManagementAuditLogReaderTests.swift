import XCTest
@testable import LariatDB
@testable import LariatModel

/// File-level parity for the management-actions JSONL reader — the I/O half of
/// `lib/auditLog.mjs` (the pure filtering/ordering half is covered by
/// `AuditLogComputeTests`). Uses temp files only; never touches data/.
final class ManagementAuditLogReaderTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("lariat-audit-reader-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    private var filePath: String { dir.appendingPathComponent("management-actions.jsonl").path }

    private func seed(_ lines: [String], terminated: Bool = true) throws {
        let text = lines.joined(separator: "\n") + (terminated ? "\n" : "")
        try text.write(toFile: filePath, atomically: true, encoding: .utf8)
    }

    // ── missing file → [] no-throw (web fs.existsSync guard) ────────────

    func testMissingFileReturnsEmptyEverywhere() {
        let reader = ManagementAuditLogReader(auditPath: filePath)
        XCTAssertEqual(reader.recent().count, 0)
        XCTAssertEqual(reader.byAction("recipe_edit").count, 0)
        XCTAssertEqual(reader.forSlug("anything").count, 0)
        XCTAssertEqual(reader.export(start: .distantPast, end: .distantFuture).count, 0)
    }

    func testEmptyFileReturnsEmpty() throws {
        try "".write(toFile: filePath, atomically: true, encoding: .utf8)
        let reader = ManagementAuditLogReader(auditPath: filePath)
        XCTAssertEqual(reader.recent().count, 0)
        XCTAssertEqual(reader.byAction("recipe_edit").count, 0)
    }

    // ── end-to-end file reads ───────────────────────────────────────────

    func testRecentReadsNewestFirstFromDisk() throws {
        try seed([
            #"{"id":"1","action":"recipe_edit","timestamp":"2026-01-01T00:00:00.000Z"}"#,
            #"{"id":"2","action":"cost_update","timestamp":"2026-01-02T00:00:00.000Z"}"#,
            #"{"id":"3","action":"recipe_edit","timestamp":"2026-01-03T00:00:00.000Z"}"#,
        ])
        let reader = ManagementAuditLogReader(auditPath: filePath)
        XCTAssertEqual(reader.recent().map(\.id), ["3", "2", "1"])
        XCTAssertEqual(reader.recent(limit: 2).map(\.id), ["3", "2"])
        XCTAssertEqual(reader.byAction("recipe_edit").map(\.id), ["3", "1"])
    }

    func testPartialTailLineFromInterruptedAppendIsSkipped() throws {
        // Simulates a crash mid-appendFileSync: unterminated fragment at EOF.
        try seed([
            #"{"id":"ok","action":"recipe_edit","timestamp":"2026-01-01T00:00:00.000Z"}"#,
            #"{"id":"torn","action":"recipe_ed"#,
        ], terminated: false)
        let reader = ManagementAuditLogReader(auditPath: filePath)
        XCTAssertEqual(reader.recent().map(\.id), ["ok"])
        XCTAssertEqual(reader.byAction("recipe_edit").map(\.id), ["ok"])
    }

    func testInvalidUtf8LineOnlyCorruptsItself() throws {
        // Node readFileSync('utf-8') substitutes U+FFFD for invalid bytes, so a
        // torn multi-byte write breaks only its own line's JSON.parse. Strict
        // Swift decoding returned nil for the WHOLE file — blanking the board.
        var data = Data(#"{"id":"a","action":"recipe_edit","timestamp":"2026-01-01T00:00:00.000Z"}"#.utf8)
        data.append(0x0A)
        data.append(contentsOf: [0x7B, 0x22, 0xC3]) // `{"` + dangling UTF-8 lead byte
        data.append(0x0A)
        data.append(Data(#"{"id":"b","action":"recipe_edit","timestamp":"2026-01-02T00:00:00.000Z"}"#.utf8))
        data.append(0x0A)
        try data.write(to: URL(fileURLWithPath: filePath))
        let reader = ManagementAuditLogReader(auditPath: filePath)
        XCTAssertEqual(reader.recent().map(\.id), ["b", "a"])
        XCTAssertEqual(reader.byAction("recipe_edit").map(\.id), ["b", "a"])
    }

    // ── path resolution parity (LARIAT_AUDIT_PATH override) ─────────────

    func testDefaultPathHonorsAuditPathOverride() {
        let resolved = resolveManagementAuditPath(env: ["LARIAT_AUDIT_PATH": filePath])
        XCTAssertEqual(resolved, filePath)
    }

    func testDefaultPathFallsBackToDataDirAuditFile() {
        let resolved = resolveManagementAuditPath(env: ["LARIAT_DATA_DIR": dir.path])
        XCTAssertEqual(resolved, dir.appendingPathComponent("audit/management-actions.jsonl").path)
    }

    /// Interop: lines written by the NATIVE `ManagementAuditLogger` must be
    /// readable by this reader (round-trip through the same JSONL file).
    func testReadsLinesWrittenByManagementAuditLogger() throws {
        let logger = ManagementAuditLogger(auditPath: filePath)
        try logger.logPackSizeAcknowledged(
            packSizeChangesId: 7, vendor: "Sysco", sku: "A1",
            prevPack: "6x#10", newPack: "4x#10", note: "ack"
        )
        let reader = ManagementAuditLogReader(auditPath: filePath)
        let entries = reader.byAction("pack_size_change_acknowledged")
        XCTAssertEqual(entries.count, 1)
        XCTAssertNotNil(entries.first?.timestamp)
    }
}
