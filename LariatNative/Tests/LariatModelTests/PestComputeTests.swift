import XCTest
@testable import LariatModel

/// Value-parity tests for `PestCompute` against `lib/pestControl.ts`.
///
/// Mirrors the web pins in:
///   - tests/js/test-pest-rules.mjs     (validatePestControl enum + shape guards)
///   - tests/js/test-pest-citation.mjs  (PEST_CITATION exact shape)
///
/// Rule module is pure (no I/O). The route-level DB / audit behavior is
/// pinned in PestRepositoryTests, mirroring tests/js/test-pest-api.mjs.
final class PestComputeTests: XCTestCase {

    // ── Citation (verbatim from lib/pestControl.ts) ───────────────────

    func testCitationIsExactWebString() {
        // Ported VERBATIM — an inspector pulling citations programmatically
        // must see this exact §-cite, not a paraphrase.
        XCTAssertEqual(
            PestCompute.citation,
            "FDA §6-501.111 — controlling pests; minimizing presence of pests on the premises"
        )
    }

    func testCitationIsNonEmptyString() {
        XCTAssertFalse(PestCompute.citation.isEmpty, "citation must not be empty")
    }

    func testCitationCitesSection6_501_111() {
        XCTAssertTrue(PestCompute.citation.contains("§6-501.111"))
    }

    func testCitationMatchesSiblingModuleShape() {
        // Same shape as CLEANING_CITATION / SDS_CITATION:
        //   "FDA §6-501.111 — <description>". The em-dash is load-bearing.
        XCTAssertTrue(PestCompute.citation.hasPrefix("FDA §6-501.111 — "))
    }

    // ── Input shape guards ────────────────────────────────────────────

    func testRejectsNil() {
        let r = PestCompute.validate(PestControlInput())  // no entry_type
        XCTAssertFalse(r.ok)
    }

    func testRejectsMissingEntryType() {
        let r = PestCompute.validate(PestControlInput(entryType: nil))
        XCTAssertFalse(r.ok)
        XCTAssertTrue((r.reason ?? "").contains("entry_type"))
    }

    func testRejectsUnknownEntryType() {
        let r = PestCompute.validate(PestControlInput(entryType: "fumigation"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue((r.reason ?? "").contains("entry_type"))
    }

    // ── entry_type enum ───────────────────────────────────────────────

    func testAcceptsServiceVisit() {
        XCTAssertTrue(PestCompute.validate(PestControlInput(entryType: "service_visit")).ok)
    }

    func testAcceptsTrapCheck() {
        XCTAssertTrue(PestCompute.validate(PestControlInput(entryType: "trap_check")).ok)
    }

    func testSightingRequiresPest() {
        let without = PestCompute.validate(PestControlInput(entryType: "sighting"))
        XCTAssertFalse(without.ok)
        XCTAssertTrue((without.reason ?? "").contains("pest"))

        let withPest = PestCompute.validate(PestControlInput(entryType: "sighting", pest: "roach"))
        XCTAssertTrue(withPest.ok)
    }

    // ── pest enum ─────────────────────────────────────────────────────

    func testAcceptsEachKnownPest() {
        for pest in ["roach", "mouse", "fly", "ant", "other"] {
            let r = PestCompute.validate(PestControlInput(entryType: "sighting", pest: pest))
            XCTAssertTrue(r.ok, "pest=\(pest) should be accepted; reason=\(r.reason ?? "")")
        }
    }

    func testRejectsUnknownPest() {
        let r = PestCompute.validate(PestControlInput(entryType: "sighting", pest: "rat"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue((r.reason ?? "").contains("pest"))
    }

    func testPestAllowedOnNonSightingEntry() {
        // service_visit + pest is valid: the vendor noted what they saw.
        let r = PestCompute.validate(PestControlInput(entryType: "service_visit", pest: "mouse"))
        XCTAssertTrue(r.ok)
    }

    // ── severity enum ─────────────────────────────────────────────────

    func testAcceptsEachKnownSeverity() {
        for severity in ["low", "medium", "high"] {
            let r = PestCompute.validate(PestControlInput(entryType: "trap_check", severity: severity))
            XCTAssertTrue(r.ok, "severity=\(severity) should be accepted; reason=\(r.reason ?? "")")
        }
    }

    func testRejectsUnknownSeverity() {
        let r = PestCompute.validate(PestControlInput(entryType: "trap_check", severity: "critical"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue((r.reason ?? "").contains("severity"))
    }

    func testSeverityMayBeOmitted() {
        // A clean trap check has no severity.
        XCTAssertTrue(PestCompute.validate(PestControlInput(entryType: "trap_check")).ok)
    }

    // ── Composed realistic shapes ─────────────────────────────────────

    func testAcceptsServiceVisitWithoutPestOrSeverity() {
        let r = PestCompute.validate(PestControlInput(entryType: "service_visit"))
        XCTAssertTrue(r.ok)
    }

    func testAcceptsHighSeverityRoachSighting() {
        let r = PestCompute.validate(
            PestControlInput(entryType: "sighting", pest: "roach", severity: "high")
        )
        XCTAssertTrue(r.ok)
    }

    func testSightingMissingPestSurfacesPestNotSeverity() {
        // Severity without pest is meaningless on a sighting — surface the
        // missing pest field, not severity.
        let r = PestCompute.validate(PestControlInput(entryType: "sighting", severity: "high"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue((r.reason ?? "").contains("pest"))
    }

    // ── Validation reason strings (exact web parity) ──────────────────

    func testExactReasonStrings() {
        XCTAssertEqual(
            PestCompute.validate(PestControlInput(entryType: nil)).reason,
            "invalid entry_type"
        )
        XCTAssertEqual(
            PestCompute.validate(PestControlInput(entryType: "sighting")).reason,
            "pest must be specified for a sighting"
        )
        XCTAssertEqual(
            PestCompute.validate(PestControlInput(entryType: "sighting", pest: "rat")).reason,
            "invalid pest type"
        )
        XCTAssertEqual(
            PestCompute.validate(PestControlInput(entryType: "trap_check", severity: "critical")).reason,
            "invalid severity"
        )
    }
}
