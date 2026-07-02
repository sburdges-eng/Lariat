import XCTest
@testable import LariatModel

/// Value-parity port of `tests/js/test-audit-log-pagination.mjs` against
/// `AuditLogCompute` — the pure read side of `lib/auditLog.mjs`. Every case
/// from the JS oracle is ported; two extra cases (missing/empty content,
/// partial tail line) harden the reader contract.
final class AuditLogComputeTests: XCTestCase {
    // ── fixture helpers ─────────────────────────────────────────────────

    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// `new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()` equivalent.
    private func iso(year: Int = 2026, month: Int = 1, day: Int = 1, hour: Int = 0, minute: Int = 0, second: Int = 0, ms: Int = 0) -> String {
        var comps = DateComponents()
        comps.year = year; comps.month = month; comps.day = day
        comps.hour = hour; comps.minute = minute; comps.second = second
        comps.nanosecond = ms * 1_000_000
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return Self.isoFormatter.string(from: cal.date(from: comps)!)
    }

    private func date(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0, second: Int = 0) -> Date {
        var comps = DateComponents()
        comps.year = year; comps.month = month; comps.day = day
        comps.hour = hour; comps.minute = minute; comps.second = second
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal.date(from: comps)!
    }

    private func jsonl(_ entries: [[String: Any]]) -> String {
        entries.map { entry in
            let data = try! JSONSerialization.data(withJSONObject: entry)
            return String(data: data, encoding: .utf8)!
        }.joined(separator: "\n") + "\n"
    }

    // ── getAuditLogByAction — stream-read past 1000-entry cap ───────────

    func testByActionReturnsAllMatchesPastLegacyCap() {
        // 1500 entries; matches for action="recipe_edit" planted at positions
        // 10/50/100/250/700 — all before the legacy 1000-entry tail window.
        let matchPositions: Set<Int> = [10, 50, 100, 250, 700]
        var entries: [[String: Any]] = []
        for i in 0..<1500 {
            entries.append([
                "id": "audit_seed_\(i)",
                "timestamp": iso(second: i),
                "action": matchPositions.contains(i) ? "recipe_edit" : "noise_action",
            ])
        }
        let matches = AuditLogCompute.byAction(content: jsonl(entries), action: "recipe_edit")
        XCTAssertEqual(matches.count, 5, "all 5 matching entries must surface (no silent 1000-cap drop)")
        // Newest-first ordering — positional reverse, matching streamFilter.
        XCTAssertEqual(
            matches.map(\.id),
            ["audit_seed_700", "audit_seed_250", "audit_seed_100", "audit_seed_50", "audit_seed_10"]
        )
    }

    func testByActionEmptyContentReturnsEmpty() {
        // Missing-file case at the compute layer: empty content → [].
        XCTAssertEqual(AuditLogCompute.byAction(content: "", action: "recipe_edit").count, 0)
    }

    func testByActionNoMatchesReturnsEmpty() {
        let content = jsonl([
            ["id": "a", "action": "cost_update", "timestamp": "2026-01-01T00:00:00.000Z"],
            ["id": "b", "action": "cost_update", "timestamp": "2026-01-02T00:00:00.000Z"],
        ])
        XCTAssertEqual(AuditLogCompute.byAction(content: content, action: "recipe_edit").count, 0)
    }

    func testByActionSkipsMisformedLinesWithoutCrashing() {
        // Half-written line from an interrupted append — skipped, neighbors kept.
        let good1 = #"{"id":"1","action":"recipe_edit","timestamp":"2026-01-01T00:00:00.000Z"}"#
        let good2 = #"{"id":"2","action":"recipe_edit","timestamp":"2026-01-02T00:00:00.000Z"}"#
        let bad = #"{"id":"truncated","action":"recipe_edit"#  // no closing brace
        let content = good1 + "\n" + bad + "\n" + good2 + "\n"
        let matches = AuditLogCompute.byAction(content: content, action: "recipe_edit")
        XCTAssertEqual(matches.count, 2, "misformed line must be skipped, valid neighbors preserved")
        XCTAssertEqual(matches.map(\.id), ["2", "1"])
    }

    // ── getAuditLogForRecipe — same stream-read fix ─────────────────────

    func testForSlugReturnsAllMatchesPastLegacyCap() {
        let matchPositions: Set<Int> = [5, 100, 200]
        var entries: [[String: Any]] = []
        for i in 0..<900 {
            entries.append([
                "id": "audit_recipe_\(i)",
                "timestamp": iso(second: i),
                "action": "recipe_edit",
                "slug": matchPositions.contains(i) ? "braised-short-rib" : "other-dish",
            ])
        }
        let matches = AuditLogCompute.forSlug(content: jsonl(entries), slug: "braised-short-rib")
        XCTAssertEqual(matches.count, 3)
        XCTAssertEqual(matches.map(\.id), ["audit_recipe_200", "audit_recipe_100", "audit_recipe_5"])
    }

    func testForSlugNoMatchesReturnsEmpty() {
        let content = jsonl([
            ["id": "a", "action": "recipe_edit", "slug": "foo", "timestamp": "2026-01-01T00:00:00.000Z"],
        ])
        XCTAssertEqual(AuditLogCompute.forSlug(content: content, slug: "not-present").count, 0)
    }

    // ── exportAuditLog — same stream-read fix ───────────────────────────

    func testExportReturnsAllDateRangeMatchesPastLegacyCap() {
        // 6100 entries: 5 sparse January matches at rows 10/50/100/250/700,
        // February noise elsewhere. Pre-fix web routed through
        // getRecentAuditLog(5000) and saw zero January matches.
        let janPositions = [10, 50, 100, 250, 700]
        let janSet = Set(janPositions)
        var entries: [[String: Any]] = []
        var janCount = 0
        for i in 0..<6100 {
            if janSet.contains(i) {
                entries.append([
                    "id": "audit_jan_\(i)",
                    "timestamp": iso(month: 1, minute: janCount),
                    "action": "recipe_edit",
                ])
                janCount += 1
            } else {
                entries.append([
                    "id": "audit_feb_\(i)",
                    "timestamp": iso(month: 2, second: i % 60, ms: (i * 17) % 1000),
                    "action": "noise_action",
                ])
            }
        }
        let matches = AuditLogCompute.export(
            content: jsonl(entries),
            start: date(year: 2026, month: 1, day: 1),
            end: date(year: 2026, month: 1, day: 31, hour: 23, minute: 59, second: 59)
        )
        XCTAssertEqual(matches.count, 5, "all 5 January matches must surface (no silent 5000-cap drop)")
        XCTAssertEqual(
            matches.map(\.id),
            ["audit_jan_700", "audit_jan_250", "audit_jan_100", "audit_jan_50", "audit_jan_10"]
        )
    }

    func testExportReturnsMatchesNewestFirst() {
        var entries: [[String: Any]] = []
        for i in 0..<5 {
            entries.append([
                "id": "audit_\(i)",
                "timestamp": iso(month: 3, hour: i),
                "action": "recipe_edit",
            ])
        }
        let matches = AuditLogCompute.export(
            content: jsonl(entries),
            start: date(year: 2026, month: 3, day: 1),
            end: date(year: 2026, month: 3, day: 1, hour: 23, minute: 59, second: 59)
        )
        XCTAssertEqual(matches.map(\.id), ["audit_4", "audit_3", "audit_2", "audit_1", "audit_0"])
    }

    func testExportEmptyRangeWhenStartAfterEnd() {
        let content = jsonl([
            ["id": "a", "action": "recipe_edit", "timestamp": "2026-03-15T00:00:00.000Z"],
            ["id": "b", "action": "recipe_edit", "timestamp": "2026-03-16T00:00:00.000Z"],
        ])
        let matches = AuditLogCompute.export(
            content: content,
            start: date(year: 2026, month: 3, day: 31),
            end: date(year: 2026, month: 3, day: 1)
        )
        XCTAssertEqual(matches.count, 0)
    }

    func testExportSkipsMisformedEntryTimestamps() {
        let content = jsonl([
            ["id": "before", "action": "recipe_edit", "timestamp": "2026-04-01T00:00:00.000Z"],
            ["id": "bad", "action": "recipe_edit", "timestamp": "not-a-date"],
            ["id": "after", "action": "recipe_edit", "timestamp": "2026-04-02T00:00:00.000Z"],
        ])
        let matches = AuditLogCompute.export(
            content: content,
            start: date(year: 2026, month: 1, day: 1),
            end: date(year: 2026, month: 12, day: 31, hour: 23, minute: 59, second: 59)
        )
        // Newest-first; NaN-timestamp entry dropped, valid neighbors preserved.
        XCTAssertEqual(matches.map(\.id), ["after", "before"])
    }

    func testExportUnparseableBoundsReturnsEmptyDefensively() {
        let content = jsonl([
            ["id": "a", "action": "recipe_edit", "timestamp": "2026-03-15T00:00:00.000Z"],
        ])
        XCTAssertEqual(AuditLogCompute.export(content: content, startISO: "", endISO: "2026-12-31T00:00:00.000Z").count, 0)
        XCTAssertEqual(AuditLogCompute.export(content: content, startISO: "2026-01-01T00:00:00.000Z", endISO: "not a date").count, 0)
    }

    func testExportEmptyContentReturnsEmpty() {
        // Missing-file case at the compute layer.
        let matches = AuditLogCompute.export(
            content: "",
            start: date(year: 2026, month: 1, day: 1),
            end: date(year: 2026, month: 12, day: 31)
        )
        XCTAssertEqual(matches.count, 0)
    }

    // ── getRecentAuditLog ───────────────────────────────────────────────

    func testRecentReturnsTailWindowNewestFirst() {
        var entries: [[String: Any]] = []
        for i in 0..<10 {
            entries.append(["id": "e\(i)", "action": "a", "timestamp": iso(second: i)])
        }
        let recent = AuditLogCompute.recent(content: jsonl(entries), limit: 3)
        // Last 3 lines, reversed — most recent first.
        XCTAssertEqual(recent.map(\.id), ["e9", "e8", "e7"])
    }

    func testRecentDefaultLimit100AndNoCrashOnShortFile() {
        let entries: [[String: Any]] = [["id": "only", "action": "a"]]
        let recent = AuditLogCompute.recent(content: jsonl(entries))
        XCTAssertEqual(recent.map(\.id), ["only"])
    }

    func testRecentSkipsPartialTailLine() {
        // A crash mid-append leaves an unterminated JSON fragment at EOF —
        // it must be skipped, not crash the reader.
        let good = #"{"id":"ok","action":"a","timestamp":"2026-01-01T00:00:00.000Z"}"#
        let partial = #"{"id":"torn","action":"a","timesta"#
        let content = good + "\n" + partial
        let recent = AuditLogCompute.recent(content: content, limit: 100)
        XCTAssertEqual(recent.map(\.id), ["ok"])
    }

    // ── entry decode details the view relies on ─────────────────────────

    func testChangesPayloadStringifiedLikeWebRender() {
        let line = #"{"id":"x","action":"recipe_edit","changes":{"price":12.5,"name":"Brisket","live":true}}"#
        let entry = try! XCTUnwrap(ManagementAuditEntry.parse(line: line, fallbackId: "f"))
        XCTAssertEqual(entry.changes.map(\.key), ["live", "name", "price"])
        XCTAssertEqual(entry.changes.map(\.value), ["true", "Brisket", "12.5"])
    }

    func testEntryWithoutIdGetsPositionalFallback() {
        let content = #"{"action":"recipe_edit"}"# + "\n"
        let matches = AuditLogCompute.byAction(content: content, action: "recipe_edit")
        XCTAssertEqual(matches.count, 1)
        XCTAssertFalse(matches[0].id.isEmpty)
    }
}
