import XCTest
@testable import LariatModel

/// Write-side analog of `RegulatedReadGateTests`. #607 closed the read-side
/// fail-open on an install with no manager PIN; the write side had the same
/// hole in a different shape — `ShowsBoardSupport.actorForWrite()` did
///
///     guard gateOn else { return nil }
///
/// so on an unconfigured install every Shows write (settlement payouts, box
/// office counts, stage and sound changes) was committed with a nil actor.
/// A regulated write nobody can be held to is worse than a refused one: the
/// audit row exists and names no one.
///
/// The comment on that guard claimed web parity. It was stale — web's
/// `pinRequiredForPic()` became unconditionally `true` on 2026-07-28
/// (`lib/pin.ts`), and the shows routes call `requirePin`, so web refuses.
///
/// The rule mirrors `RegulatedReadGate.evaluate` deliberately: a valid session
/// is authority regardless of what the gate table currently says, and the
/// absence of one is never attributed.
final class ManagementWriteTests: XCTestCase {
    private let manager = ManagerPinUser(id: 7, locationId: "lariat", name: "Dana", role: "manager")

    private func validSession() -> PinSession {
        PinSession.fresh(user: manager)
    }

    private func expiredSession() -> PinSession {
        PinSession(user: manager, expiresAt: Date().addingTimeInterval(-60))
    }

    // THE FIXED CASE: nothing configured used to return a nil actor and let the
    // write land unattributed. It now refuses, with an error distinct from
    // `.pinRequired` because there is no PIN to prompt for — the caller must
    // not raise a PIN sheet nothing can satisfy.
    func testUnconfiguredInstallRefusesInsteadOfWritingUnattributed() throws {
        XCTAssertThrowsError(
            try ManagementWrite().requireActor(gateConfigured: false, session: nil)
        ) { error in
            XCTAssertEqual(
                error as? ManagementWriteError, .noPinConfigured,
                "an unconfigured install must refuse the write, not attribute it to no one"
            )
        }
    }

    // Configured but locked is the ordinary prompt case — distinct error, so
    // the caller knows a PIN sheet CAN satisfy it.
    func testConfiguredWithoutSessionRequiresPin() throws {
        XCTAssertThrowsError(
            try ManagementWrite().requireActor(gateConfigured: true, session: nil)
        ) { error in
            XCTAssertEqual(error as? ManagementWriteError, .pinRequired)
        }
    }

    // A valid session is the actor.
    func testValidSessionIsTheActor() throws {
        let actor = try ManagementWrite().requireActor(gateConfigured: true, session: validSession())
        XCTAssertEqual(actor, manager)
    }

    // Same reasoning as `RegulatedReadGate`: an operator who unlocked before the
    // last PIN was disabled keeps their session — the credential was checked
    // when it was issued.
    func testValidSessionIsTheActorEvenIfTheGateReadsUnconfigured() throws {
        let actor = try ManagementWrite().requireActor(gateConfigured: false, session: validSession())
        XCTAssertEqual(actor, manager)
    }

    // An expired session is not a session. It must not attribute a write, and
    // on a configured install it is the prompt case.
    func testExpiredSessionIsNotAnActor() throws {
        XCTAssertThrowsError(
            try ManagementWrite().requireActor(gateConfigured: true, session: expiredSession())
        ) { error in
            XCTAssertEqual(error as? ManagementWriteError, .pinRequired)
        }
    }

    // An expired session on an unconfigured install refuses too — and refuses
    // as "no PIN configured", since prompting still cannot help.
    func testExpiredSessionOnUnconfiguredInstallRefuses() throws {
        XCTAssertThrowsError(
            try ManagementWrite().requireActor(gateConfigured: false, session: expiredSession())
        ) { error in
            XCTAssertEqual(error as? ManagementWriteError, .noPinConfigured)
        }
    }

    // No combination of inputs yields an actor without a valid session. Small
    // enough to assert exhaustively, so drift cannot reintroduce a fail-open.
    func testNoActorWithoutAValidSession() {
        let sessions: [(String, PinSession?)] = [
            ("nil", nil),
            ("expired", expiredSession())
        ]
        for gateConfigured in [true, false] {
            for (label, session) in sessions {
                XCTAssertThrowsError(
                    try ManagementWrite().requireActor(gateConfigured: gateConfigured, session: session),
                    "gateConfigured=\(gateConfigured) session=\(label) must not produce an actor"
                )
            }
        }
    }

    // The refusal has to tell the operator what to do — the write is otherwise
    // a dead end, and since #606 setting the first PIN is possible.
    func testNoPinConfiguredErrorExplainsItself() {
        let message = ManagementWriteError.noPinConfigured.errorDescription ?? ""
        XCTAssertTrue(message.contains("PIN"), "message should name the PIN: \(message)")
        XCTAssertNotEqual(
            message, ManagementWriteError.pinRequired.errorDescription,
            "the two refusals are different situations and must read differently"
        )
    }
}
