import XCTest
@testable import LariatModel

/// `LariatApp` has no test target — the SwiftUI view-model layer is where every
/// hole the Phase C1 verify-41 sweep found actually lived, and it cannot be
/// exercised by a unit test. This scans its source instead.
///
/// The specific failure being prevented: #607 fixed the unconfigured-install
/// fail-open in `RegulatedReadGate` and in `MorningViewModel`, but
/// `ShowsBoardSupport` carried a THIRD copy of the same decision
/// (`if !gateOn || pinStore.activeUser != nil { gate = .open }`) and kept
/// serving seven boards — settlement payouts, box office revenue, run-of-show,
/// staffing, production detail — on an install with no manager PIN. Filed as
/// #608. Duplication is what let the copies drift; a unit test on the shared
/// rule cannot see a caller that never calls it.
///
/// So this asserts the shape of the calls, not the behavior: gate decisions
/// live in `LariatModel` and the app layer only maps their result.
final class GateRuleDriftTests: XCTestCase {
    private var appSources: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // Tests/LariatModelTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // LariatNative
            .appendingPathComponent("Sources/LariatApp")
    }

    private func swiftSources() throws -> [(path: String, text: String)] {
        let fm = FileManager.default
        guard let walker = fm.enumerator(at: appSources, includingPropertiesForKeys: nil) else {
            XCTFail("could not enumerate \(appSources.path)")
            return []
        }
        var out: [(String, String)] = []
        for case let url as URL in walker where url.pathExtension == "swift" {
            out.append((url.lastPathComponent, try String(contentsOf: url, encoding: .utf8)))
        }
        XCTAssertGreaterThan(out.count, 50, "expected to find the LariatApp sources at \(appSources.path)")
        return out
    }

    /// Collapse runs of whitespace so the match survives reformatting.
    private func normalized(_ text: String) -> String {
        text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    // THE READ HOLE: "no PIN configured" must never be a branch that opens a
    // board. Any `!gateOn ||` / `!gateConfigured ||` is that branch — it reads
    // "unconfigured OR unlocked → open", which is exactly what #607 reversed
    // and #608 found still live in the shows copy.
    func testNoAppFileTreatsAnUnconfiguredGateAsOpen() throws {
        for (path, text) in try swiftSources() {
            let body = normalized(text)
            for token in ["!gateOn ||", "!gateConfigured ||", "!gateOn {", "!gateConfigured {"] {
                XCTAssertFalse(
                    body.contains(token),
                    """
                    \(path) decides the PIN gate itself with `\(token)`. \
                    An unconfigured install must not open a manager-tier board — \
                    call RegulatedReadGate.evaluate and map its result.
                    """
                )
            }
        }
    }

    // THE WRITE HOLE: an unconfigured install must not hand back a nil actor
    // and let a regulated write land unattributed.
    func testNoAppFileWritesWithoutAnActorWhenTheGateIsOff() throws {
        for (path, text) in try swiftSources() {
            XCTAssertFalse(
                normalized(text).contains("guard gateOn else { return nil }"),
                """
                \(path) attributes a write to no one when no PIN is configured. \
                Call ManagementWrite().requireActor(gateConfigured:session:), \
                which refuses instead.
                """
            )
        }
    }

    // Positive half: the shows gate must actually route through the shared
    // rules. Without this, deleting the gate entirely would pass the two
    // negative tests above.
    func testShowsGateDelegatesToTheSharedRules() throws {
        let sources = try swiftSources()
        guard let shows = sources.first(where: { $0.path == "ShowsBoardSupport.swift" })?.text else {
            return XCTFail("ShowsBoardSupport.swift not found — did the shows gate move?")
        }
        XCTAssertTrue(
            shows.contains("RegulatedReadGate.evaluate"),
            "the shows read gate must use the shared rule, not its own copy"
        )
        XCTAssertTrue(
            shows.contains("requireActor"),
            "shows writes must resolve their actor through ManagementWrite.requireActor"
        )
    }

    // The test above pins the RULE but not its ADOPTION: it proves
    // ShowsBoardSupport calls the shared gate, and says nothing about whether
    // any given shows board actually uses it. Unlike the manager rollups, the
    // shows boards are not wrapped by ManagerGatedBoard — each view carries its
    // own ShowsGateModel — so a board added without one, or an existing gate
    // deleted, is invisible to every other test. Same hole #654/#667 closed one
    // tier up, in the shape this tier uses.
    //
    // Every shows surface is PIN-gated on the web (/shows + /api/shows
    // SENSITIVE_PREFIXES); native must not be the softer door.
    func testEveryShowsBoardCarriesTheGate() throws {
        let sources = try swiftSources()
        guard let features = sources.first(where: { $0.path == "ShowsFeatures.swift" })?.text else {
            return XCTFail("ShowsFeatures.swift not found — did the shows modules move?")
        }

        // Pull the view each shows.* module renders, straight from the registry
        // source, so a NEW board is covered the moment it is registered rather
        // than when someone remembers to update a hardcoded list here.
        let moduleRe = try NSRegularExpression(
            pattern: #"FeatureModule\(id: "(shows\.[A-Za-z]+)"\)[^}]*?AnyView\(\s*([A-Za-z]+)"#,
            options: [.dotMatchesLineSeparators]
        )
        let ns = features as NSString
        let matches = moduleRe.matches(in: features, range: NSRange(location: 0, length: ns.length))

        XCTAssertGreaterThanOrEqual(
            matches.count, 7,
            "expected to find the shows modules in ShowsFeatures.swift — did the registration shape change?"
        )

        for m in matches {
            let id = ns.substring(with: m.range(at: 1))
            let view = ns.substring(with: m.range(at: 2))
            guard let viewSource = sources.first(where: { $0.path == "\(view).swift" })?.text else {
                XCTFail("\(id) renders \(view) but \(view).swift was not found")
                continue
            }
            XCTAssertTrue(
                viewSource.contains("ShowsGateModel"),
                "\(id) renders \(view), which carries no ShowsGateModel — a cook with no manager PIN would see shows data that the web gates"
            )
        }
    }

    // The #401 stash pattern assumes a throw from `actorForWrite()` means a PIN
    // sheet is now up: it dismisses the open form and parks the write until a
    // successful verify replays it, reporting through `onCancel` if the sheet
    // is dismissed. `.noPinConfigured` raises NO sheet, so a caller that treats
    // it like the others closes the form over a write that can never replay and
    // can never report — a silent drop, which is the exact failure the stash
    // pattern exists to prevent. Any site that stashes must handle it first.
    func testStashingCallersHandleTheNoPinConfiguredRefusal() throws {
        for (path, text) in try swiftSources()
        where text.contains("actorForWrite") && text.contains("stashPendingWrite") {
            XCTAssertTrue(
                text.contains("noPinConfigured"),
                """
                \(path) stashes a write when actorForWrite() throws, but does not \
                handle .noPinConfigured — which throws without presenting a PIN \
                sheet, so the stashed write can never replay and never reports.
                """
            )
        }
    }

    // Morning is the other caller #607 rewired; pin it the same way so the two
    // cannot drift apart again from the other side.
    func testMorningGateDelegatesToTheSharedRule() throws {
        let sources = try swiftSources()
        guard let morning = sources.first(where: { $0.path == "MorningViewModel.swift" })?.text else {
            return XCTFail("MorningViewModel.swift not found — did the morning gate move?")
        }
        XCTAssertTrue(
            morning.contains("RegulatedReadGate.evaluate"),
            "the morning read gate must use the shared rule, not its own copy"
        )
    }

    // #654 put the three manager rollup boards behind a PIN, and nothing has
    // held them there since: `ManagerGatedBoard` appears in the whole repo only
    // at its definition and its three call sites. LariatApp is an
    // executableTarget with no test target, so a unit test cannot reach the
    // wrapper at all — a source scan is the only mechanism that can see it, and
    // this file is where that mechanism already lives.
    //
    // Without this, a commit that deleted the wrapper — plausibly a refactor
    // "simplifying" the AnyView(ManagerGatedBoard(...) { ... }) nesting back to
    // a plain AnyView(CommandView(...)) — would go green. FeatureRegistryTests
    // names all three ids but asserts over FeatureCatalog descriptors in
    // LariatModel; unwrapping leaves those byte-identical.
    func testManagerRollupBoardsStayPinGated() throws {
        let sources = try swiftSources()
        guard let modules = sources.first(where: { $0.path == "ManagerFeatures.swift" })?.text else {
            return XCTFail("ManagerFeatures.swift not found — did the manager modules move?")
        }
        let body = normalized(modules)

        // Slice per module rather than scanning the whole file: a bare
        // `contains("ManagerGatedBoard(")` stays green when only ONE of the
        // three is unwrapped, which is the likelier accident.
        for (id, board) in [
            ("manager.command", "CommandView"),
            ("manager.analytics", "AnalyticsView"),
            ("manager.management", "ManagementRollupView"),
        ] {
            guard let start = body.range(of: "FeatureModule(id: \"\(id)\")") else {
                XCTFail("\(id) module declaration not found — did the id change?")
                continue
            }
            let rest = body[start.upperBound...]
            let end = rest.range(of: "static let")?.lowerBound ?? rest.endIndex
            let slice = String(rest[..<end])

            XCTAssertTrue(
                slice.contains("ManagerGatedBoard("),
                "\(id) no longer mounts its board inside ManagerGatedBoard — a cook with no manager PIN would see rollup numbers"
            )
            XCTAssertTrue(
                slice.contains(board),
                "\(id) no longer renders \(board). If the view was renamed, update this test — this assertion is a swap-out signal, not a gate failure."
            )
        }

        // The wrapper must still BRANCH on the gate, not merely mention it.
        // Asserting only that it references ShowsGateModel would stay green
        // over a body neutered to `if true { content() }`, which reads as
        // gated and is not.
        guard let gate = sources.first(where: { $0.path == "ManagerGatedBoard.swift" })?.text else {
            return XCTFail("ManagerGatedBoard.swift not found — the manager rollup gate is gone")
        }
        let gateBody = normalized(gate)
        XCTAssertTrue(
            gateBody.contains("ShowsGateModel"),
            "ManagerGatedBoard must reuse the shared gate rule, not a fourth copy"
        )
        XCTAssertTrue(
            gateBody.contains("case .locked:"),
            "ManagerGatedBoard must still handle the locked state — a wrapper that cannot lock is not a gate"
        )
        XCTAssertTrue(
            gateBody.contains("case .open: content()"),
            "ManagerGatedBoard must render its content ONLY in the .open case"
        )
    }
}
