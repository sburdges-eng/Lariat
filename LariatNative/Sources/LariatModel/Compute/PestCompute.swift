import Foundation

// Port of `lib/pestControl.ts` — pest-control rule module (F8 / FDA §6-501.111).
//
// FDA §6-501.111 requires the operator to control pests by routinely inspecting
// incoming shipments, the premises, and using methods that minimize pest
// presence. We log three entry kinds — vendor service visits, line-cook
// sightings, and trap-check sweeps.
//
// Pure module: no I/O, no DB, no clock read. Numbers/citation/enum reasons match
// the JS rule module exactly — see tests/js/test-pest-rules.mjs and
// tests/js/test-pest-citation.mjs for the pins.

/// Validation outcome — mirrors the JS `{ok, reason}` return shape. As in the
/// sibling modules (cleaning, sds), there is no `citation` field on the result;
/// the constant is consumed by the UI / audit / inspector tooling directly.
public struct ValidatePestResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidatePestResult(ok: true, reason: nil)
    public static func failure(_ reason: String) -> ValidatePestResult {
        ValidatePestResult(ok: false, reason: reason)
    }
}

public enum PestCompute {
    /// Controlling FDA Food Code section for pest presence on the premises.
    /// Ported VERBATIM from `PEST_CITATION` in `lib/pestControl.ts` — do not reword.
    public static let citation =
        "FDA §6-501.111 — controlling pests; minimizing presence of pests on the premises"

    // ── Enums (single source of truth, mirrors the JS Sets) ───────────

    public static let entryTypes: Set<String> = ["service_visit", "sighting", "trap_check"]
    public static let pests: Set<String> = ["roach", "mouse", "fly", "ant", "other"]
    public static let severities: Set<String> = ["low", "medium", "high"]

    /// Mirror of `validatePestControl`. Reason strings match the web module
    /// verbatim so the route surfaces the same 400 body.
    public static func validate(_ input: PestControlInput) -> ValidatePestResult {
        guard let entryType = input.entryType, entryTypes.contains(entryType) else {
            return .failure("invalid entry_type")
        }
        if entryType == "sighting", (input.pest ?? "").isEmpty {
            return .failure("pest must be specified for a sighting")
        }
        if let pest = input.pest, !pest.isEmpty, !pests.contains(pest) {
            return .failure("invalid pest type")
        }
        if let severity = input.severity, !severity.isEmpty, !severities.contains(severity) {
            return .failure("invalid severity")
        }
        return .success
    }
}
