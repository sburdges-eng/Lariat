import Foundation

// Port of `lib/sickWorker.ts` (FDA Food Code 2022 §2-201.11 / CO 6 CCR 1010-2)
// AND `lib/sickWorkerGate.ts` (FDA §2-201.12 scheduler gate). Employee-health
// exclusion/restriction math for the F5 sick-report board and the L6 line gate.
//
// Pure (no I/O). The repository wraps the validation with DB writes; the gate
// is consulted read-side by the signoff/line path. Vocabulary keys, action
// ranking, and citations match the JS rule modules exactly — see
// tests/js/test-sick-worker-rules.mjs for the pinned values.

/// FDA §2-201.11(A)(3) — the 5 reportable symptoms. Raw values are the
/// canonical keys stored comma-joined in `sick_worker_reports.symptoms`.
public enum SickSymptom: String, Sendable, Equatable, CaseIterable {
    case vomiting
    case diarrhea
    case jaundice
    case soreThroatWithFever = "sore_throat_with_fever"
    case infectedLesion = "infected_lesion"
}

/// FDA §2-201.11(A)(1-2) — the "Big-6" notifiable diagnoses. Raw values match
/// `sick_worker_reports.diagnosed_illness`.
public enum SickDiagnosis: String, Sendable, Equatable, CaseIterable {
    case norovirus
    case salmonellaTyphi = "salmonella_typhi"
    case salmonellaNontyphoidal = "salmonella_nontyphoidal"
    case shigella
    case stecEhec = "stec_ehec"
    case hepatitisA = "hepatitis_a"
}

/// Regulatory action — mirrors `SickWorkerReport['action']` (the CHECK set on
/// `sick_worker_reports.action`). Ordered by severity via `rank`.
public enum SickAction: String, Sendable, Equatable {
    case excluded
    case restricted
    case monitor
    case none

    /// Severity rank — parity with the JS `rankAction`. Higher = stricter.
    var rank: Int {
        switch self {
        case .excluded: return 3
        case .restricted: return 2
        case .monitor: return 1
        case .none: return 0
        }
    }
}

/// Result of `normalizeDiagnosis` — mirrors the JS `Diagnosis | null | 'invalid'`
/// tri-state. `.none` = no diagnosis reported; `.invalid` = unknown key (web 400).
public enum SickDiagnosisResult: Sendable, Equatable {
    case valid(SickDiagnosis)
    case none
    case invalid
}

/// Validation outcome — mirrors the JS `ValidateResult`.
public struct ValidateSickResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidateSickResult(ok: true, reason: nil)
    public static func failure(_ reason: String) -> ValidateSickResult {
        ValidateSickResult(ok: false, reason: reason)
    }
}

/// Symptoms input — either an array of keys or a comma-joined string (parity
/// with the JS `symptoms: unknown` accepting `string[] | string`).
public enum SickSymptomsInput: Sendable, Equatable {
    case array([String])
    case string(String)
}

/// Raw sick-report input — parity with the JS `SickReportInput`.
public struct SickReportInput: Sendable, Equatable {
    public let cookId: String
    public let symptoms: SickSymptomsInput
    public let diagnosedIllness: String?
    public let action: String
    public let startedAt: String

    public init(cookId: String, symptoms: SickSymptomsInput, diagnosedIllness: String?, action: String, startedAt: String) {
        self.cookId = cookId
        self.symptoms = symptoms
        self.diagnosedIllness = diagnosedIllness
        self.action = action
        self.startedAt = startedAt
    }
}

/// Minimal row view for the scheduler gate (mirrors the JS `SickWorkerRow`).
public struct SickWorkerGateRow: Sendable, Equatable {
    public let action: String
    public let returnAt: String?

    public init(action: String, returnAt: String?) {
        self.action = action
        self.returnAt = returnAt
    }
}

/// Result of `evaluateCookEligibility` — symmetric with the L5 minor-assignment
/// gate shape (`{ ok } | { blocked, reason, citation }`).
public enum CookEligibilityResult: Sendable, Equatable {
    case ok
    case blocked(reason: String, citation: String)
}

public enum SickWorkerCompute {
    public static let symptoms = SickSymptom.allCases
    public static let diagnoses = SickDiagnosis.allCases

    /// FDA §2-201.12 citation for the line-work exclusion (matches
    /// `SICK_WORKER_EXCLUSION_CITATION` in `lib/sickWorkerGate.ts`).
    public static let exclusionCitation = "FDA 2022 §2-201.12"

    private static let blockingActions: Set<String> = ["excluded", "restricted"]

    // ── ISO-8601 parsing (parity with JS Date.parse for accepted inputs) ──

    private static let isoWithFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func isParsableISO(_ ts: String) -> Bool {
        if ts.isEmpty { return false }
        if isoNoFraction.date(from: ts) != nil { return true }
        if isoWithFraction.date(from: ts) != nil { return true }
        return false
    }

    // ── FDA action rules ──────────────────────────────────────────────
    //
    // - Vomiting / diarrhea / jaundice / any Big-6 diagnosis → EXCLUDE.
    // - Sore throat with fever → RESTRICT (no exposed-food tasks).
    // - Infected lesion → RESTRICT (PIC may upgrade to EXCLUDE in the note).
    // - Multiple symptoms: the strictest wins. Diagnosis overrides symptoms.

    /// Mirror of `requiredActionFor` — the FDA floor for a symptom/diagnosis combo.
    public static func requiredActionFor(symptoms: [SickSymptom], diagnosis: SickDiagnosis?) -> SickAction {
        var worst: SickAction = .none
        func bump(_ a: SickAction) {
            if a.rank > worst.rank { worst = a }
        }

        if diagnosis != nil { bump(.excluded) }

        for s in symptoms {
            switch s {
            case .vomiting, .diarrhea, .jaundice:
                bump(.excluded)
            case .soreThroatWithFever, .infectedLesion:
                bump(.restricted)
            }
        }
        return worst
    }

    // ── Input normalization ────────────────────────────────────────────

    /// Mirror of `normalizeSymptoms(array)`. Returns nil on any unknown key.
    /// Trims, filters empties, dedupes preserving first-seen order.
    public static func normalizeSymptoms(array: [String]) -> [SickSymptom]? {
        let cleaned = array.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return normalize(cleaned)
    }

    /// Mirror of `normalizeSymptoms(string)`. Comma-split, trim, filter, dedupe.
    public static func normalizeSymptoms(string: String) -> [SickSymptom]? {
        let cleaned = string.split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return normalize(cleaned)
    }

    private static func normalize(_ cleaned: [String]) -> [SickSymptom]? {
        var out: [SickSymptom] = []
        var seen = Set<SickSymptom>()
        for key in cleaned {
            guard let sym = SickSymptom(rawValue: key) else { return nil }
            if seen.insert(sym).inserted { out.append(sym) }
        }
        return out
    }

    /// Mirror of `normalizeDiagnosis`. null/empty/"none" → `.none`; unknown → `.invalid`.
    public static func normalizeDiagnosis(_ x: String?) -> SickDiagnosisResult {
        guard let x else { return .none }
        let t = x.trimmingCharacters(in: .whitespaces)
        if t.isEmpty || t.lowercased() == "none" { return .none }
        guard let dx = SickDiagnosis(rawValue: t) else { return .invalid }
        return .valid(dx)
    }

    // ── Full report validation ──────────────────────────────────────────

    /// Mirror of `validateSickReport`. Enforces the FDA floor: PIC may RAISE
    /// severity but never LOWER it below `requiredActionFor`.
    public static func validateSickReport(_ x: SickReportInput) -> ValidateSickResult {
        if x.cookId.trimmingCharacters(in: .whitespaces).isEmpty {
            return .failure("cook_id is required")
        }
        if !isParsableISO(x.startedAt) {
            return .failure("started_at must be an ISO timestamp")
        }

        let syms: [SickSymptom]?
        switch x.symptoms {
        case .array(let a): syms = normalizeSymptoms(array: a)
        case .string(let s): syms = normalizeSymptoms(string: s)
        }
        guard let symptoms = syms else {
            return .failure("Unknown symptom — expected keys in \(SickSymptom.allCases.map(\.rawValue).joined(separator: ", "))")
        }

        let dxResult = normalizeDiagnosis(x.diagnosedIllness)
        let diagnosis: SickDiagnosis?
        switch dxResult {
        case .invalid:
            return .failure("Unknown diagnosis — expected one of \(SickDiagnosis.allCases.map(\.rawValue).joined(separator: ", ")) or null")
        case .none:
            diagnosis = nil
        case .valid(let d):
            diagnosis = d
        }

        if symptoms.isEmpty && diagnosis == nil {
            return .failure("Need at least one symptom or a diagnosed illness")
        }

        guard let action = SickAction(rawValue: x.action) else {
            return .failure("action must be one of excluded|restricted|monitor|none")
        }

        let required = requiredActionFor(symptoms: symptoms, diagnosis: diagnosis)
        if action.rank < required.rank {
            return .failure("FDA requires at least \"\(required.rawValue)\" for these symptoms/diagnosis; got \"\(action.rawValue)\"")
        }

        return .success
    }

    // ── Scheduler gate (lib/sickWorkerGate.ts) ─────────────────────────

    /// Mirror of `cookHasActiveExclusion`. True iff at least one row is an OPEN
    /// exclusion (return_at nil) with a blocking action (excluded|restricted).
    /// Cleared rows and monitor/none rows never block.
    public static func cookHasActiveExclusion(_ rows: [SickWorkerGateRow]) -> Bool {
        for r in rows {
            if r.returnAt != nil { continue }
            if blockingActions.contains(r.action) { return true }
        }
        return false
    }

    /// Mirror of `evaluateCookEligibility`.
    public static func evaluateCookEligibility(_ rows: [SickWorkerGateRow]) -> CookEligibilityResult {
        if !cookHasActiveExclusion(rows) { return .ok }
        return .blocked(
            reason: "this cook is on a reportable-illness exclusion and can't work the line",
            citation: exclusionCitation
        )
    }
}
