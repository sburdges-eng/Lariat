import XCTest
@testable import LariatModel

/// H6c — pure core for the menu-bar extra's status item + panel. Partitions the
/// live CommandAlert set into deterministically-sorted red/amber sections and
/// derives the status-item badge + worst-severity glyph state. No SwiftUI, no
/// Foundation UI, no I/O — the App-layer panel/scene is `swift build` + GUI smoke.
final class MenuBarStatusComputeTests: XCTestCase {

    private func alert(_ source: String, count: Int, severity: CommandAlert.Severity) -> CommandAlert {
        CommandAlert(severity: severity, source: source, message: "\(count) \(source)", count: count)
    }

    func test_empty_isClean_noBadge() {
        let s = MenuBarStatusCompute.status(from: [])
        XCTAssertEqual(s.overall, .clean)
        XCTAssertTrue(s.isAllClear)
        XCTAssertNil(s.badgeText)
        XCTAssertTrue(s.redAlerts.isEmpty)
        XCTAssertTrue(s.amberAlerts.isEmpty)
        XCTAssertEqual(s.redCount, 0)
        XCTAssertEqual(s.amberCount, 0)
    }

    func test_redOnly_overallRed_badgeIsRedCount() {
        let s = MenuBarStatusCompute.status(from: [
            alert("temp", count: 3, severity: .red),
            alert("eighty-six", count: 2, severity: .red),
        ])
        XCTAssertEqual(s.overall, .red)
        XCTAssertFalse(s.isAllClear)
        XCTAssertEqual(s.redCount, 2)
        XCTAssertEqual(s.badgeText, "2")     // count of red *rows*, not sum of their counts
        XCTAssertTrue(s.amberAlerts.isEmpty)
    }

    func test_amberOnly_overallAmber_noBadge() {
        let s = MenuBarStatusCompute.status(from: [
            alert("sales-drop", count: 1, severity: .amber),
        ])
        XCTAssertEqual(s.overall, .amber)
        XCTAssertFalse(s.isAllClear)         // amber present → not all-clear
        XCTAssertNil(s.badgeText)            // amber never contributes to the badge
        XCTAssertTrue(s.redAlerts.isEmpty)
        XCTAssertEqual(s.amberCount, 1)
    }

    func test_mixed_bothSections_badgeCountsRedOnly() {
        let s = MenuBarStatusCompute.status(from: [
            alert("temp", count: 3, severity: .red),
            alert("sales-drop", count: 1, severity: .amber),
            alert("eighty-six", count: 2, severity: .red),
            alert("labor-drift", count: 4, severity: .amber),
        ])
        XCTAssertEqual(s.overall, .red)      // red wins over amber
        XCTAssertEqual(s.redCount, 2)
        XCTAssertEqual(s.amberCount, 2)
        XCTAssertEqual(s.badgeText, "2")     // red rows only
        // partition is clean: no amber leaked into red or vice-versa
        XCTAssertTrue(s.redAlerts.allSatisfy { $0.severity == .red })
        XCTAssertTrue(s.amberAlerts.allSatisfy { $0.severity == .amber })
    }

    func test_sort_isDeterministic_countDescThenSourceAsc() {
        // Shuffled input with a count tie (both == 2) must always come out in the
        // same order: count descending, then source ascending as the tie-break.
        let input = [
            alert("zeta", count: 2, severity: .red),
            alert("alpha", count: 5, severity: .red),
            alert("beta", count: 2, severity: .red),   // ties zeta on count → source breaks it
        ]
        let s = MenuBarStatusCompute.status(from: input)
        XCTAssertEqual(s.redAlerts.map(\.source), ["alpha", "beta", "zeta"])
        // Re-running on a differently-ordered copy yields the identical ordering.
        let s2 = MenuBarStatusCompute.status(from: input.reversed())
        XCTAssertEqual(s2.redAlerts.map(\.source), ["alpha", "beta", "zeta"])
    }
}
