import XCTest
@testable import LariatModel

/// Value-parity port of tests/js/test-lari-predictions-rules.mjs — every case.
final class LariPredictionsComputeTests: XCTestCase {
    private typealias C = LariPredictionsCompute
    private let TODAY = "2026-05-13"

    // ── isValidSeverity ─────────────────────────────────────────────

    func testIsValidSeverityAcceptsOkWarnAlert() {
        for s in ["ok", "warn", "alert"] {
            XCTAssertTrue(C.isValidSeverity(.string(s)))
        }
    }

    func testIsValidSeverityRejectsAnythingElse() {
        for s in ["critical", "info", "WARN", ""] {
            XCTAssertFalse(C.isValidSeverity(.string(s)))
        }
        XCTAssertFalse(C.isValidSeverity(nil))
        XCTAssertFalse(C.isValidSeverity(.null))
        XCTAssertFalse(C.isValidSeverity(.number(1)))
    }

    // ── normalizePrediction ─────────────────────────────────────────

    private func base(_ overrides: [String: AssistantJSONValue] = [:]) -> AssistantJSONValue {
        var o: [String: AssistantJSONValue] = [
            "id": .string("t1"), "surface": .string("beo"),
            "severity": .string("warn"), "text": .string("sample"),
        ]
        for (k, v) in overrides { o[k] = v }
        return .object(o)
    }

    func testNormalizeReturnsCleanPrediction() {
        let out = C.normalizePrediction(base())
        XCTAssertEqual(out, LariPrediction(id: "t1", surface: "beo", severity: .warn, text: "sample"))
    }

    func testNormalizeRejectsBlankOrMissingRequiredFields() {
        for key in ["id", "surface", "severity", "text"] {
            XCTAssertNil(C.normalizePrediction(base([key: .string("")])), "blank \(key) should reject")
        }
        for key in ["id", "surface", "text"] {
            guard case .object(var o) = base() else { return XCTFail() }
            o.removeValue(forKey: key)
            XCTAssertNil(C.normalizePrediction(.object(o)), "missing \(key) should reject")
        }
    }

    func testNormalizeRejectsNonObjectInput() {
        XCTAssertNil(C.normalizePrediction(nil))
        XCTAssertNil(C.normalizePrediction(.null))
        XCTAssertNil(C.normalizePrediction(.string("string")))
        XCTAssertNil(C.normalizePrediction(.number(42)))
        XCTAssertNil(C.normalizePrediction(.array([])))
    }

    func testNormalizeRejectsInvalidSeverity() {
        XCTAssertNil(C.normalizePrediction(base(["severity": .string("critical")])))
    }

    func testNormalizeClipsLongText() {
        let out = C.normalizePrediction(base(["text": .string(String(repeating: "x", count: 500))]))
        XCTAssertEqual(out?.text.count, 240)
    }

    func testNormalizeClipsAction() {
        let out = C.normalizePrediction(base(["action": .string(String(repeating: "y", count: 200))]))
        XCTAssertEqual(out?.action?.count, 80)
    }

    func testNormalizePreservesOptionalFields() {
        let out = C.normalizePrediction(base([
            "action": .string("open"), "source": .string("beo_events:5"), "for_role": .string("pic"),
        ]))
        XCTAssertEqual(out?.action, "open")
        XCTAssertEqual(out?.source, "beo_events:5")
        XCTAssertEqual(out?.forRole, "pic")
    }

    func testNormalizeDropsBlankOrWrongTypeOptionals() {
        let out = C.normalizePrediction(base([
            "action": .string("   "), "source": .number(42), "for_role": .string(""),
        ]))
        XCTAssertNil(out?.action)
        XCTAssertNil(out?.source)
        XCTAssertNil(out?.forRole)
    }

    // ── sortBySeverity / trimPredictions ────────────────────────────

    private func make(_ id: String, _ severity: LariSeverity, _ text: String = "x") -> LariPrediction {
        LariPrediction(id: id, surface: "beo", severity: severity, text: text)
    }

    func testSortOrdersAlertWarnOk() {
        let out = C.sortBySeverity([make("a", .ok), make("b", .alert), make("c", .warn)])
        XCTAssertEqual(out.map(\.id), ["b", "c", "a"])
    }

    func testSortTieBreaksLongerTextFirst() {
        let out = C.sortBySeverity([
            make("short", .alert, "aa"), make("long", .alert, "aaaaaaa"), make("mid", .alert, "aaaa"),
        ])
        XCTAssertEqual(out.map(\.id), ["long", "mid", "short"])
    }

    func testSortDoesNotMutateInput() {
        let list = [make("a", .ok), make("b", .alert)]
        _ = C.sortBySeverity(list)
        XCTAssertEqual(list.map(\.id), ["a", "b"])
    }

    func testTrimDefaultsTo5() {
        let fill = (0..<10).map { make("p\($0)", .warn, "t\($0)") }
        XCTAssertEqual(C.trimPredictions(fill).count, 5)
    }

    func testTrimHonorsExplicitCap() {
        let fill = (0..<10).map { make("p\($0)", .warn, "t\($0)") }
        XCTAssertEqual(C.trimPredictions(fill, 3).count, 3)
    }

    func testTrimClampsNegativeCapToZero() {
        let fill = (0..<3).map { make("p\($0)", .warn, "t\($0)") }
        XCTAssertEqual(C.trimPredictions(fill, -1).count, 0)
    }

    // ── daysUntil ───────────────────────────────────────────────────

    func testDaysUntil() {
        XCTAssertEqual(C.daysUntil("2026-05-13", "2026-05-13"), 0)
        XCTAssertEqual(C.daysUntil("2026-05-13", "2026-05-20"), 7)
        XCTAssertEqual(C.daysUntil("2026-05-20", "2026-05-13"), -7)
        XCTAssertEqual(C.daysUntil("not-a-date", "2026-05-13"), -1)
        XCTAssertEqual(C.daysUntil("2026-05-13", "2026/5/13"), -1)
    }

    // ── buildBeoPredictions ─────────────────────────────────────────

    private func beoEvent(
        id: Int64, title: String, date: String?, contact: String?, guests: Int?
    ) -> C.BeoEventRow {
        C.BeoEventRow(id: id, title: title, eventDate: date, eventTime: nil, contactName: contact, guestCount: guests, notes: nil)
    }

    func testBeoEmptyEventsReturnsEmpty() {
        XCTAssertEqual(C.buildBeoPredictions(events: [], lineItems: [], prepTasks: [], today: TODAY), [])
    }

    func testBeoAlertForTonightMissingContact() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 1, title: "Hendricks Wedding", date: TODAY, contact: nil, guests: 80)],
            lineItems: [], prepTasks: [], today: TODAY
        )
        let alert = out.first { $0.id == "beo-missing-contact-1" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
        XCTAssertTrue(alert?.text.contains("Hendricks Wedding") == true)
    }

    func testBeoAlertForOverduePrepTask() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 7, title: "Smith Bar Mitzvah", date: "2026-05-20", contact: "Sam", guests: 50)],
            lineItems: [],
            prepTasks: [C.BeoPrepTaskRow(id: 99, eventId: 7, task: "order linens", dueDate: "2026-05-10", done: 0)],
            today: TODAY
        )
        let alert = out.first { $0.id == "beo-overdue-task-99" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
        XCTAssertTrue(alert?.text.contains("order linens") == true)
    }

    func testBeoNoOverdueAlertForDoneTask() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 7, title: "Done Event", date: "2026-05-20", contact: "Sam", guests: 50)],
            lineItems: [],
            prepTasks: [C.BeoPrepTaskRow(id: 99, eventId: 7, task: "order linens", dueDate: "2026-05-10", done: 1)],
            today: TODAY
        )
        XCTAssertNil(out.first { $0.id == "beo-overdue-task-99" })
    }

    func testBeoWarnThinMenuTonight() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 3, title: "Big Party", date: TODAY, contact: "Jamie", guests: 80)],
            lineItems: [
                C.BeoLineItemRow(id: 1, eventId: 3, itemName: "Brisket", quantity: 80),
                C.BeoLineItemRow(id: 2, eventId: 3, itemName: "Salad", quantity: 80),
            ],
            prepTasks: [], today: TODAY
        )
        let warn = out.first { $0.id == "beo-thin-menu-3" }
        XCTAssertNotNil(warn)
        XCTAssertEqual(warn?.severity, .warn)
        XCTAssertTrue(warn?.text.contains("only 2 line items for 80 guests") == true)
    }

    func testBeoWarnEmptyMenuUpcoming() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 9, title: "Tomorrow Event", date: "2026-05-14", contact: "X", guests: 30)],
            lineItems: [], prepTasks: [], today: TODAY
        )
        let warn = out.first { $0.id == "beo-empty-menu-9" }
        XCTAssertNotNil(warn)
        XCTAssertEqual(warn?.severity, .warn)
        XCTAssertTrue(warn?.text.contains("no menu yet") == true)
    }

    func testBeoNoEmptyMenuWarnBeyond7Days() {
        let out = C.buildBeoPredictions(
            events: [beoEvent(id: 10, title: "Far Future", date: "2026-08-13", contact: "X", guests: 30)],
            lineItems: [], prepTasks: [], today: TODAY
        )
        XCTAssertNil(out.first { $0.id == "beo-empty-menu-10" })
    }

    func testBeoOkRollup() {
        let out = C.buildBeoPredictions(
            events: [
                beoEvent(id: 1, title: "E1", date: "2026-05-14", contact: "A", guests: 10),
                beoEvent(id: 2, title: "E2", date: "2026-05-18", contact: "B", guests: 10),
            ],
            lineItems: [
                C.BeoLineItemRow(id: 1, eventId: 1, itemName: "a", quantity: 10),
                C.BeoLineItemRow(id: 2, eventId: 2, itemName: "b", quantity: 10),
            ],
            prepTasks: [], today: TODAY
        )
        let rollup = out.first { $0.id == "beo-upcoming-rollup-\(TODAY)" }
        XCTAssertNotNil(rollup)
        XCTAssertEqual(rollup?.severity, .ok)
        XCTAssertTrue(rollup?.text.contains("2 BEOs in the next 7 days") == true)
    }

    func testBeoCapsAt5() {
        let events = (1...10).map {
            beoEvent(id: Int64($0), title: "E\($0)", date: TODAY, contact: nil, guests: 10)
        }
        let out = C.buildBeoPredictions(events: events, lineItems: [], prepTasks: [], today: TODAY)
        XCTAssertEqual(out.count, 5)
        XCTAssertTrue(out.allSatisfy { $0.severity == .alert })
    }

    func testBeoIdsStableAcrossPolls() {
        let events = [beoEvent(id: 1, title: "X", date: TODAY, contact: nil, guests: 50)]
        let a = C.buildBeoPredictions(events: events, lineItems: [], prepTasks: [], today: TODAY)
        let b = C.buildBeoPredictions(events: events, lineItems: [], prepTasks: [], today: TODAY)
        XCTAssertEqual(a.map(\.id), b.map(\.id))
    }

    // ── buildSoundPredictions ───────────────────────────────────────

    func testSoundNilScenesReturnsEmpty() {
        XCTAssertEqual(
            C.buildSoundPredictions(showId: 42, bandName: "The Stand", scenes: nil, splSummary: nil, today: TODAY),
            []
        )
    }

    func testSoundWarnOnlyWhenNoSceneNoReadings() {
        let out = C.buildSoundPredictions(showId: 42, bandName: "The Stand", scenes: [], splSummary: nil, today: TODAY)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].id, "sound-no-scene-42")
        XCTAssertEqual(out[0].severity, .warn)
        XCTAssertTrue(out[0].text.contains("No sound scene saved yet for \"The Stand\""))
    }

    func testSoundAlertOverLimit() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand",
            scenes: [C.SoundSceneInput(id: 5, sceneName: "Mix A", splLimitDb: 100, plotChannelCount: 1, savedAt: "")],
            splSummary: C.SplSummaryInput(count: 50, latest: 102, peak: 105, overLimitCount: 3, limitDb: 100),
            today: TODAY
        )
        let alert = out.first { $0.id == "sound-over-limit-42" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
        XCTAssertTrue(alert?.text.contains("3 readings") == true)
    }

    func testSoundAlertRunningBlind() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand", scenes: [],
            splSummary: C.SplSummaryInput(count: 12, latest: 102, peak: 103, overLimitCount: 0, limitDb: nil),
            today: TODAY
        )
        let alert = out.first { $0.id == "sound-running-blind-42" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
        // does NOT double-emit no-scene + running-blind together
        XCTAssertNil(out.first { $0.id == "sound-no-scene-42" })
    }

    func testSoundWarnNoCeiling() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand",
            scenes: [C.SoundSceneInput(id: 5, sceneName: "Mix A", splLimitDb: nil, plotChannelCount: 1, savedAt: "")],
            splSummary: nil, today: TODAY
        )
        let warn = out.first { $0.id == "sound-no-limit-42" }
        XCTAssertNotNil(warn)
        XCTAssertEqual(warn?.severity, .warn)
    }

    func testSoundWarnEmptyPlot() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand",
            scenes: [C.SoundSceneInput(id: 5, sceneName: "Skeleton", splLimitDb: 100, plotChannelCount: 0, savedAt: "")],
            splSummary: nil, today: TODAY
        )
        let warn = out.first { $0.id == "sound-empty-plot-42" }
        XCTAssertNotNil(warn)
        XCTAssertTrue(warn?.text.contains("Skeleton") == true)
    }

    func testSoundOkRollup() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand",
            scenes: [C.SoundSceneInput(id: 5, sceneName: "Mix A", splLimitDb: 100, plotChannelCount: 1, savedAt: "")],
            splSummary: C.SplSummaryInput(count: 80, latest: 95, peak: 98, overLimitCount: 0, limitDb: 100),
            today: TODAY
        )
        let ok = out.first { $0.id == "sound-rollup-42" }
        XCTAssertNotNil(ok)
        XCTAssertEqual(ok?.severity, .ok)
        XCTAssertTrue(ok?.text.contains("80 readings tonight · peak 98 dB · in band") == true)
    }

    func testSoundCapsAt5() {
        let out = C.buildSoundPredictions(
            showId: 42, bandName: "The Stand",
            scenes: [C.SoundSceneInput(id: 5, sceneName: "X", splLimitDb: nil, plotChannelCount: 0, savedAt: "")],
            splSummary: C.SplSummaryInput(count: 80, latest: 105, peak: 110, overLimitCount: 12, limitDb: 100),
            today: TODAY
        )
        XCTAssertLessThanOrEqual(out.count, 5)
    }

    func testSoundUsesShowNumberWhenBandNameNil() {
        let out = C.buildSoundPredictions(showId: 42, bandName: nil, scenes: [], splSummary: nil, today: TODAY)
        XCTAssertTrue(out[0].text.contains("show #42"))
    }

    // ── buildHostPredictions ────────────────────────────────────────

    private func hostSummary(
        waiting: Int = 0, seated: Int = 0, avg: Double? = nil,
        longest: Double? = nil, longestId: Int64? = nil, total: Int = 0, left: Int = 0
    ) -> C.HostWaitlistSummaryInput {
        C.HostWaitlistSummaryInput(
            total: total, waiting: waiting, seatedToday: seated, leftToday: left,
            avgWaitMinutes: avg, longestWaitMinutes: longest, longestWaitPartyId: longestId
        )
    }

    func testHostNilSummaryReturnsEmpty() {
        XCTAssertEqual(C.buildHostPredictions(summary: nil, today: TODAY), [])
    }

    func testHostNoActivityReturnsEmpty() {
        XCTAssertEqual(C.buildHostPredictions(summary: hostSummary(), today: TODAY), [])
    }

    func testHostAlertLongWait() {
        let out = C.buildHostPredictions(
            summary: hostSummary(waiting: 1, longest: 60, longestId: 7), today: TODAY
        )
        let alert = out.first { $0.id == "host-long-wait-7" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
        XCTAssertTrue(alert?.text.contains("60 min") == true)
    }

    func testHostNoLongWaitAlertAtBoundary() {
        let out = C.buildHostPredictions(
            summary: hostSummary(waiting: 1, longest: 45, longestId: 7), today: TODAY
        )
        XCTAssertNil(out.first { $0.id == "host-long-wait-7" })
    }

    func testHostAlertOverflow() {
        let out = C.buildHostPredictions(summary: hostSummary(waiting: 9), today: TODAY)
        let alert = out.first { $0.id == "host-overflow-\(TODAY)" }
        XCTAssertNotNil(alert)
        XCTAssertEqual(alert?.severity, .alert)
    }

    func testHostWarnBusy() {
        let out = C.buildHostPredictions(summary: hostSummary(waiting: 6), today: TODAY)
        let warn = out.first { $0.id == "host-busy-\(TODAY)" }
        XCTAssertNotNil(warn)
        XCTAssertEqual(warn?.severity, .warn)
    }

    func testHostNoDoubleBusyPlusOverflow() {
        let out = C.buildHostPredictions(summary: hostSummary(waiting: 10), today: TODAY)
        XCTAssertNil(out.first { $0.id == "host-busy-\(TODAY)" })
        XCTAssertNotNil(out.first { $0.id == "host-overflow-\(TODAY)" })
    }

    func testHostWarnAvgWait() {
        let out = C.buildHostPredictions(summary: hostSummary(seated: 5, avg: 35), today: TODAY)
        XCTAssertNotNil(out.first { $0.id == "host-avg-wait-\(TODAY)" })
    }

    func testHostOkRollup() {
        let out = C.buildHostPredictions(summary: hostSummary(waiting: 2, seated: 4, avg: 18), today: TODAY)
        let ok = out.first { $0.id == "host-rollup-\(TODAY)" }
        XCTAssertNotNil(ok)
        XCTAssertEqual(ok?.severity, .ok)
        XCTAssertTrue(ok?.text.contains("4 seated today · 2 waiting") == true)
        XCTAssertTrue(ok?.text.contains("avg 18 min") == true)
    }

    func testHostCapsAt5() {
        let out = C.buildHostPredictions(
            summary: hostSummary(waiting: 12, seated: 8, avg: 50, longest: 99, longestId: 42, total: 12, left: 1),
            today: TODAY
        )
        XCTAssertLessThanOrEqual(out.count, 5)
    }
}
