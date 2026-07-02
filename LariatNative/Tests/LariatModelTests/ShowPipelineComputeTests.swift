import XCTest
@testable import LariatModel

/// Ports every oracle case in `tests/js/test-show-status.mjs`
/// (statusColor + pipelineStage + KNOWN_STAGES from lib/showStatus.ts).
final class ShowPipelineComputeTests: XCTestCase {

    // ── statusColor ──────────────────────────────────────────────────────

    func testLiteralYIsGreen() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("y"),
            ShowStatusBadge(color: .green, label: "y")
        )
    }

    func testLiteralNIsRed() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("n"),
            ShowStatusBadge(color: .red, label: "n")
        )
    }

    func testDashIsNeutral() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("-"),
            ShowStatusBadge(color: .neutral, label: "—")
        )
    }

    func testEmptyIsNeutral() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor(""),
            ShowStatusBadge(color: .neutral, label: "—")
        )
    }

    func testPendingIsAmber() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("pending"),
            ShowStatusBadge(color: .amber, label: "pending")
        )
    }

    func testWIsAmberWaiting() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("w"),
            ShowStatusBadge(color: .amber, label: "w")
        )
    }

    func testAcceptedIsGreen() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("accepted"),
            ShowStatusBadge(color: .green, label: "accepted")
        )
    }

    func testDetailStringPreservedGreenWithDetail() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("jb, bit, sk"),
            ShowStatusBadge(color: .green, label: "jb, bit, sk")
        )
    }

    func testNumericPostsGreenWithCountLabel() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("6.0"),
            ShowStatusBadge(color: .green, label: "6")
        )
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("0"),
            ShowStatusBadge(color: .neutral, label: "—")
        )
    }

    func testUnknownValueIsGreenNeverRedOnNovelty() {
        XCTAssertEqual(
            ShowPipelineCompute.statusColor("co-host accepted"),
            ShowStatusBadge(color: .green, label: "co-host accepted")
        )
    }

    // ── pipelineStage ────────────────────────────────────────────────────

    func testEveryFixtureRowMapsToExpectedStage() {
        // Each fixture: (row, showIsPast, expected stage) — web verbatim.
        let fixtures: [([String: String], Bool, String)] = [
            ([:], false, "Inquiry"),
            (["announce_date": "y"], false, "Hold"),
            (["announce_date": "y", "meta_ads": "y"], false, "Offer Out"),
            (["announce_date": "y", "meta_ads": "y", "fb_event": "y", "assets": "y"], false, "Confirmed"),
            (["announce_date": "y", "meta_ads": "y", "fb_event": "y", "create_dice_tickets": "y"], false, "On Sale"),
            // Settled requires showIsPast=true; ticketed rows stay On Sale otherwise.
            (["create_dice_tickets": "y", "dice_email": "tix, dos"], true, "Settled"),
        ]
        for (row, past, expected) in fixtures {
            let stage = ShowPipelineCompute.pipelineStage(row, showIsPast: past)
            XCTAssertTrue(
                ShowPipelineCompute.knownStages.contains(stage),
                "\(stage) not in knownStages"
            )
            XCTAssertEqual(stage, expected, "fixture \(row) (past=\(past))")
        }
    }

    func testKnownStagesIsExactlyTheSixExpected() {
        XCTAssertEqual(
            ShowPipelineCompute.knownStages,
            ["Inquiry", "Hold", "Offer Out", "Confirmed", "On Sale", "Settled"]
        )
    }

    // ── parseStatusJson (authored — rowToShow's JSON.parse + String()) ───

    func testParseStatusJsonCoercesScalarsLikeJs() {
        let parsed = ShowPipelineCompute.parseStatusJson(
            #"{"announce_date":"y","posts":6.0,"assets":null,"fb_event":true}"#
        )
        XCTAssertEqual(parsed["announce_date"], "y")
        XCTAssertEqual(parsed["posts"], "6")       // JS String(6.0) === "6"
        XCTAssertEqual(parsed["assets"], "")       // null → '' in statusColor
        XCTAssertEqual(parsed["fb_event"], "true")
        XCTAssertEqual(ShowPipelineCompute.parseStatusJson(nil), [:])
        XCTAssertEqual(ShowPipelineCompute.parseStatusJson("not json"), [:])
    }

    func testParseStatusJsonKeepsNumericZeroAndOneAsCounts() {
        // JSON 0/1 must render "0"/"1" (count semantics → neutral/green "1"),
        // never "false"/"true": NSNumber bridges 0/1 to Bool unless the
        // CFBoolean check runs first. A green "false" flipped isGreenish and
        // inflated the pipeline stage (Hold classified as Confirmed).
        let parsed = ShowPipelineCompute.parseStatusJson(
            #"{"posts":0,"door_tix":1,"flag":true,"off":false,"z":0.0,"o":1.0}"#
        )
        XCTAssertEqual(parsed["posts"], "0")
        XCTAssertEqual(parsed["door_tix"], "1")
        XCTAssertEqual(parsed["flag"], "true")
        XCTAssertEqual(parsed["off"], "false")
        XCTAssertEqual(parsed["z"], "0")
        XCTAssertEqual(parsed["o"], "1")
        XCTAssertEqual(ShowPipelineCompute.statusColor(parsed["posts"]).color, .neutral)
        XCTAssertEqual(ShowPipelineCompute.statusColor(parsed["door_tix"]).color, .green)
        XCTAssertEqual(ShowPipelineCompute.statusColor(parsed["door_tix"]).label, "1")
    }

    func testStatusColorHugeNumericDoesNotTrap() {
        // 1e19 > Int64.max — the label path used to crash on Double→Int.
        let badge = ShowPipelineCompute.statusColor("1e19")
        XCTAssertEqual(badge.color, .green)
    }
}
