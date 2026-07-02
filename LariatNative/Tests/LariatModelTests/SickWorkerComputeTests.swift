import XCTest
@testable import LariatModel

// Value-parity port of tests/js/test-sick-worker-rules.mjs — FDA §2-201.11
// exclusion/restriction math (`lib/sickWorker.ts`) plus the scheduler gate
// (`lib/sickWorkerGate.ts`, FDA §2-201.12). Known input/output values lifted
// from the web test so the Swift classifier cannot drift from the JS rules.

final class SickWorkerComputeTests: XCTestCase {

    // ── requiredActionFor — the canonical rule table ───────────────────

    func testVomitingExcluded() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.vomiting], diagnosis: nil), .excluded)
    }

    func testDiarrheaExcluded() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.diarrhea], diagnosis: nil), .excluded)
    }

    func testJaundiceExcluded() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.jaundice], diagnosis: nil), .excluded)
    }

    func testSoreThroatWithFeverRestricted() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.soreThroatWithFever], diagnosis: nil), .restricted)
    }

    func testInfectedLesionRestricted() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.infectedLesion], diagnosis: nil), .restricted)
    }

    func testAnyBig6DiagnosisExcluded() {
        for d in SickWorkerCompute.diagnoses {
            XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [], diagnosis: d), .excluded, "diagnosis \(d.rawValue)")
        }
    }

    func testNoSymptomsNoDiagnosisNone() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [], diagnosis: nil), .none)
    }

    func testMixedSeveritiesStrictestWins() {
        XCTAssertEqual(
            SickWorkerCompute.requiredActionFor(symptoms: [.infectedLesion, .vomiting], diagnosis: nil),
            .excluded
        )
    }

    func testDiagnosisOverridesLighterSymptoms() {
        XCTAssertEqual(
            SickWorkerCompute.requiredActionFor(symptoms: [.infectedLesion], diagnosis: .norovirus),
            .excluded
        )
    }

    // ── normalizeSymptoms ──────────────────────────────────────────────

    func testNormalizeAcceptsArrayOfValidKeys() {
        XCTAssertEqual(SickWorkerCompute.normalizeSymptoms(array: ["vomiting", "diarrhea"]), [.vomiting, .diarrhea])
    }

    func testNormalizeAcceptsCommaSeparatedString() {
        XCTAssertEqual(SickWorkerCompute.normalizeSymptoms(string: "vomiting, diarrhea"), [.vomiting, .diarrhea])
    }

    func testNormalizeTrimsAndFiltersEmptySlots() {
        XCTAssertEqual(SickWorkerCompute.normalizeSymptoms(string: "  vomiting  ,  , diarrhea "), [.vomiting, .diarrhea])
    }

    func testNormalizeDedupesPreservingFirstSeenOrder() {
        XCTAssertEqual(
            SickWorkerCompute.normalizeSymptoms(array: ["diarrhea", "vomiting", "diarrhea"]),
            [.diarrhea, .vomiting]
        )
    }

    func testNormalizeRejectsUnknownSymptom() {
        XCTAssertNil(SickWorkerCompute.normalizeSymptoms(array: ["headache"]))
    }

    func testNormalizeEmptyArrayIsValid() {
        XCTAssertEqual(SickWorkerCompute.normalizeSymptoms(array: []), [])
    }

    // ── normalizeDiagnosis ─────────────────────────────────────────────

    func testDiagnosisAcceptsValidKey() {
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis("norovirus"), .valid(.norovirus))
    }

    func testDiagnosisNullEmptyBecomeNull() {
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis(nil), .none)
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis(""), .none)
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis("  "), .none)
    }

    func testDiagnosisNoneTreatedAsNull() {
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis("none"), .none)
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis("NONE"), .none)
    }

    func testDiagnosisUnknownStringReturnsInvalid() {
        XCTAssertEqual(SickWorkerCompute.normalizeDiagnosis("covid"), .invalid)
    }

    func testSymptomsAndDiagnosesHaveNoOverlap() {
        let sym = Set(SickWorkerCompute.symptoms.map(\.rawValue))
        for d in SickWorkerCompute.diagnoses {
            XCTAssertFalse(sym.contains(d.rawValue), "\(d.rawValue) leaked into SYMPTOMS")
        }
    }

    // ── validateSickReport ─────────────────────────────────────────────

    private func baseInput(
        cookId: String = "alice",
        symptoms: [String] = ["vomiting"],
        diagnosis: String? = nil,
        action: String = "excluded",
        startedAt: String = "2026-04-20T10:00:00Z"
    ) -> SickReportInput {
        SickReportInput(cookId: cookId, symptoms: .array(symptoms), diagnosedIllness: diagnosis, action: action, startedAt: startedAt)
    }

    func testValidateAcceptsCleanReportAtRequiredSeverity() {
        XCTAssertEqual(SickWorkerCompute.validateSickReport(baseInput()), .success)
    }

    func testValidateAcceptsHigherSeverityThanRequired() {
        // restricted symptom, PIC escalates to excluded
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: ["infected_lesion"], action: "excluded"))
        XCTAssertEqual(r, .success)
    }

    func testValidateRejectsLowerSeverityThanFDAFloor() {
        // vomiting requires excluded; PIC cannot downgrade to restricted
        let r = SickWorkerCompute.validateSickReport(baseInput(action: "restricted"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "FDA requires") != nil)
    }

    func testValidateRejectsNoneOnReportableSymptom() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: ["diarrhea"], action: "none"))
        XCTAssertFalse(r.ok)
    }

    func testValidateRejectsMonitorOnExclusionRequiredSymptom() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: ["jaundice"], action: "monitor"))
        XCTAssertFalse(r.ok)
    }

    func testValidateRejectsUnknownActionString() {
        let r = SickWorkerCompute.validateSickReport(baseInput(action: "fired"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "action") != nil)
    }

    func testValidateRejectsMissingCookId() {
        let r = SickWorkerCompute.validateSickReport(baseInput(cookId: ""))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "cook_id") != nil)
    }

    func testValidateRejectsWhitespaceOnlyCookId() {
        let r = SickWorkerCompute.validateSickReport(baseInput(cookId: "   "))
        XCTAssertFalse(r.ok)
    }

    func testValidateRejectsBadStartedAt() {
        let r = SickWorkerCompute.validateSickReport(baseInput(startedAt: "yesterday"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "started_at") != nil)
    }

    func testValidateRejectsUnknownSymptom() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: ["cough"]))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "symptom", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsUnknownDiagnosis() {
        let r = SickWorkerCompute.validateSickReport(baseInput(diagnosis: "flu"))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "diagnosis", options: .caseInsensitive) != nil)
    }

    func testValidateRejectsEmptyReport() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: []))
        XCTAssertFalse(r.ok)
        XCTAssertTrue(r.reason?.range(of: "symptom", options: .caseInsensitive) != nil
                      || r.reason?.range(of: "diagnosis", options: .caseInsensitive) != nil)
    }

    func testValidateAcceptsDiagnosisOnlyReport() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: [], diagnosis: "norovirus", action: "excluded"))
        XCTAssertEqual(r, .success)
    }

    func testValidateRejectsDiagnosisOnlyReportAtLowerThanExcluded() {
        let r = SickWorkerCompute.validateSickReport(baseInput(symptoms: [], diagnosis: "shigella", action: "restricted"))
        XCTAssertFalse(r.ok)
    }

    // ── cookHasActiveExclusion / evaluateCookEligibility (sickWorkerGate) ─

    func testGateEmptyRowsAreNotBlocked() {
        XCTAssertFalse(SickWorkerCompute.cookHasActiveExclusion([]))
        XCTAssertEqual(SickWorkerCompute.evaluateCookEligibility([]), .ok)
    }

    func testGateOpenExcludedRowBlocks() {
        let rows = [SickWorkerGateRow(action: "excluded", returnAt: nil)]
        XCTAssertTrue(SickWorkerCompute.cookHasActiveExclusion(rows))
    }

    func testGateOpenRestrictedRowBlocks() {
        let rows = [SickWorkerGateRow(action: "restricted", returnAt: nil)]
        XCTAssertTrue(SickWorkerCompute.cookHasActiveExclusion(rows))
    }

    func testGateClearedRowIgnoredEvenIfExcluded() {
        let rows = [SickWorkerGateRow(action: "excluded", returnAt: "2026-04-21T10:00:00Z")]
        XCTAssertFalse(SickWorkerCompute.cookHasActiveExclusion(rows))
    }

    func testGateMonitorAndNoneRowsDoNotBlock() {
        let rows = [
            SickWorkerGateRow(action: "monitor", returnAt: nil),
            SickWorkerGateRow(action: "none", returnAt: nil),
        ]
        XCTAssertFalse(SickWorkerCompute.cookHasActiveExclusion(rows))
    }

    func testGateReturnsReasonAndCitationOnBlock() {
        let rows = [SickWorkerGateRow(action: "excluded", returnAt: nil)]
        let result = SickWorkerCompute.evaluateCookEligibility(rows)
        guard case let .blocked(reason, citation) = result else { return XCTFail("expected blocked") }
        XCTAssertTrue(reason.range(of: "exclusion") != nil)
        XCTAssertEqual(citation, SickWorkerCompute.exclusionCitation)
    }

    func testGateCitationConstant() {
        XCTAssertEqual(SickWorkerCompute.exclusionCitation, "FDA 2022 §2-201.12")
    }

    // ── suggestedAction (board minimum, mirrors SickWorkerBoard.jsx useMemo) ─

    func testSuggestedActionExcludeSymptom() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.vomiting], diagnosis: nil), .excluded)
    }

    func testSuggestedActionRestrictSymptom() {
        XCTAssertEqual(SickWorkerCompute.requiredActionFor(symptoms: [.soreThroatWithFever], diagnosis: nil), .restricted)
    }
}
