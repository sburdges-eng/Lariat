import XCTest
@testable import LariatModel

// Value-parity port of `tests/js/test-show-status.mjs` — every JS case has a
// 1:1 native test. Approach 1 contract: unknown values render green with
// their literal label (never red on novelty).
final class ShowStatusComputeTests: XCTestCase {

    // ── statusColor ────────────────────────────────────────────────────

    func testLiteralYGreen() {
        XCTAssertEqual(ShowStatusCompute.statusColor("y", "meta_ads"),
                       ShowStatusBadge(color: .green, label: "y"))
    }

    func testLiteralNRed() {
        XCTAssertEqual(ShowStatusCompute.statusColor("n", "meta_ads"),
                       ShowStatusBadge(color: .red, label: "n"))
    }

    func testDashNeutral() {
        XCTAssertEqual(ShowStatusCompute.statusColor("-", "meta_ads"),
                       ShowStatusBadge(color: .neutral, label: "—"))
    }

    func testEmptyNeutral() {
        XCTAssertEqual(ShowStatusCompute.statusColor("", "meta_ads"),
                       ShowStatusBadge(color: .neutral, label: "—"))
    }

    func testPendingAmber() {
        XCTAssertEqual(ShowStatusCompute.statusColor("pending", "co_host_sent"),
                       ShowStatusBadge(color: .amber, label: "pending"))
    }

    func testWAmberWaiting() {
        XCTAssertEqual(ShowStatusCompute.statusColor("w", "newsletter"),
                       ShowStatusBadge(color: .amber, label: "w"))
    }

    func testAcceptedGreen() {
        XCTAssertEqual(ShowStatusCompute.statusColor("accepted", "co_host_sent"),
                       ShowStatusBadge(color: .green, label: "accepted"))
    }

    func testDetailStringPreservedGreen() {
        XCTAssertEqual(ShowStatusCompute.statusColor("jb, bit, sk", "listing_jambase_bit_songkick"),
                       ShowStatusBadge(color: .green, label: "jb, bit, sk"))
    }

    func testNumericPostsGreenWithCountLabel() {
        XCTAssertEqual(ShowStatusCompute.statusColor("6.0", "posts"),
                       ShowStatusBadge(color: .green, label: "6"))
        XCTAssertEqual(ShowStatusCompute.statusColor("0", "posts"),
                       ShowStatusBadge(color: .neutral, label: "—"))
    }

    func testUnknownValueGreenNeverRedOnNovelty() {
        XCTAssertEqual(ShowStatusCompute.statusColor("co-host accepted", "co_host_sent"),
                       ShowStatusBadge(color: .green, label: "co-host accepted"))
    }

    func testNilValueNeutral() {
        XCTAssertEqual(ShowStatusCompute.statusColor(nil as ShowStatusValue?, "meta_ads"),
                       ShowStatusBadge(color: .neutral, label: "—"))
    }

    func testNumberValueGreenCount() {
        XCTAssertEqual(ShowStatusCompute.statusColor(.number(12), "door_tix"),
                       ShowStatusBadge(color: .green, label: "12"))
    }

    // ── pipelineStage ──────────────────────────────────────────────────

    func testPipelineStageFixtures() {
        // [row, showIsPast, expected] — the exact web fixture table.
        let fixtures: [([String: ShowStatusValue], Bool, PipelineStage)] = [
            ([:], false, .inquiry),
            (["announce_date": .string("y")], false, .hold),
            (["announce_date": .string("y"), "meta_ads": .string("y")], false, .offerOut),
            (["announce_date": .string("y"), "meta_ads": .string("y"),
              "fb_event": .string("y"), "assets": .string("y")], false, .confirmed),
            (["announce_date": .string("y"), "meta_ads": .string("y"),
              "fb_event": .string("y"), "create_dice_tickets": .string("y")], false, .onSale),
            // Settled requires showIsPast=true; without it, ticketed rows stay On Sale.
            (["create_dice_tickets": .string("y"), "dice_email": .string("tix, dos")], true, .settled),
        ]
        for (row, past, expected) in fixtures {
            let stage = ShowStatusCompute.pipelineStage(row, showIsPast: past)
            XCTAssertTrue(PipelineStage.allCases.contains(stage))
            XCTAssertEqual(stage, expected, "fixture \(row) (past=\(past))")
        }
    }

    func testSettledWithoutPastStaysOnSale() {
        let row: [String: ShowStatusValue] = [
            "create_dice_tickets": .string("y"), "dice_email": .string("tix, dos"),
        ]
        XCTAssertEqual(ShowStatusCompute.pipelineStage(row, showIsPast: false), .onSale)
    }

    func testKnownStagesAreExactlySixInOrder() {
        XCTAssertEqual(PipelineStage.allCases.map(\.rawValue),
                       ["Inquiry", "Hold", "Offer Out", "Confirmed", "On Sale", "Settled"])
    }
}
