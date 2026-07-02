import Foundation

// Port of `lib/sanitizer.ts` — sanitizer concentration validation (F4 / FDA
// §4-703.11). Three-compartment sinks, wiping-cloth buckets, and warewasher
// final rinses each have chemistry-specific ppm bands the line must hit or the
// surface is NOT sanitized. This module is pure (no I/O); the repository wraps
// it with DB writes. Numbers/citations/labels match the JS rule module exactly
// — see tests/js/test-sanitizer-rules.mjs for the pins.

/// Sanitizer chemistry — mirrors the JS `Chemistry` string union. Raw values
/// match the strings the web writes to `sanitizer_checks.chemistry` and the CHECK
/// constraint (`chlorine`,`quat`,`iodine`,`other`).
public enum SanitizerChemistry: String, Sendable, Equatable, CaseIterable {
    case chlorine
    case quat
    case iodine
    case other
}

/// Per-reading status — mirrors the JS `SanitizerStatus`. Raw values match the
/// `sanitizer_checks.status` CHECK constraint (`ok`,`low`,`high`).
public enum SanitizerStatus: String, Sendable, Equatable {
    case ok
    case low
    case high
}

/// Acceptable ppm band for a chemistry + water temperature — mirrors the JS
/// `ConcentrationBand`.
public struct SanitizerBand: Sendable, Equatable {
    public let minPpm: Double
    public let maxPpm: Double
    /// Human-readable label for the "why" shown to the cook if out of range.
    public let label: String

    public init(minPpm: Double, maxPpm: Double, label: String) {
        self.minPpm = minPpm
        self.maxPpm = maxPpm
        self.label = label
    }
}

/// Validation outcome for a reading — mirrors the JS `ValidateResult`.
public struct ValidateSanitizerResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?

    public static let success = ValidateSanitizerResult(ok: true, reason: nil)
    public static func failure(_ reason: String) -> ValidateSanitizerResult {
        ValidateSanitizerResult(ok: false, reason: reason)
    }
}

/// Result of `classifySanitizer` — mirrors the JS `ClassifyResult`.
public struct SanitizerClassification: Sendable, Equatable {
    public let status: SanitizerStatus
    public let band: SanitizerBand?
    public let requiredMinPpm: Double?
    public let requiredMaxPpm: Double?
    public let breachReason: String?

    public init(
        status: SanitizerStatus,
        band: SanitizerBand?,
        requiredMinPpm: Double?,
        requiredMaxPpm: Double?,
        breachReason: String?
    ) {
        self.status = status
        self.band = band
        self.requiredMinPpm = requiredMinPpm
        self.requiredMaxPpm = requiredMaxPpm
        self.breachReason = breachReason
    }
}

/// A well-known default check point — mirrors an entry of the JS `DEFAULT_POINTS`.
public struct SanitizerPoint: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let chemistry: SanitizerChemistry

    public init(id: String, label: String, chemistry: SanitizerChemistry) {
        self.id = id
        self.label = label
        self.chemistry = chemistry
    }
}

public enum SanitizerCompute {
    // Probes that read outside this window are lying. Real sanitizer test strips
    // top out around 500 ppm; a "1500 ppm" reading is always a misread or a wrong
    // probe, not a real event. (JS ABSOLUTE_MIN_PPM / ABSOLUTE_MAX_PPM.)
    static let absoluteMinPpm: Double = 0
    static let absoluteMaxPpm: Double = 1000

    // Water-temp plausibility band for a reading (JS uses -20..220 °F).
    static let waterTempMinF: Double = -20
    static let waterTempMaxF: Double = 220

    // Chlorine kill depends on water temperature; ≥75°F is the "hot" band break.
    static let chlorineHotTempF: Double = 75

    public static let correctiveNoteMaxLength = 500

    /// The four supported chemistries, in JS declaration order.
    public static let chemistries: [SanitizerChemistry] = SanitizerChemistry.allCases

    // ── bandFor ────────────────────────────────────────────────────────

    /// Band selector for a chemistry + water temperature. Returns the acceptable
    /// ppm range per FDA §4-703.11, or nil for `other` (record but don't classify).
    /// Mirror of JS `bandFor`.
    public static func bandFor(_ chemistry: SanitizerChemistry, waterTempF: Double?) -> SanitizerBand? {
        switch chemistry {
        case .chlorine:
            let hot = waterTempF != nil && waterTempF! >= chlorineHotTempF
            if hot {
                return SanitizerBand(minPpm: 50, maxPpm: 100, label: "chlorine @≥75°F")
            }
            return SanitizerBand(minPpm: 75, maxPpm: 100, label: "chlorine @<75°F")
        case .quat:
            return SanitizerBand(minPpm: 150, maxPpm: 400, label: "quaternary ammonia")
        case .iodine:
            return SanitizerBand(minPpm: 12.5, maxPpm: 25, label: "iodine")
        case .other:
            return nil
        }
    }

    // ── validateSanitizerCheck ─────────────────────────────────────────

    /// Mirror of JS `validateSanitizerCheck`. `chemistryRaw` is the untrusted input
    /// string — an unknown chemistry fails here (parity with the web `CHEMISTRIES`
    /// membership check) rather than being decoded away silently.
    public static func validateSanitizerCheck(
        chemistryRaw: String?,
        concentrationPpm: Double?,
        waterTempF: Double?,
        pointLabel: String?
    ) -> ValidateSanitizerResult {
        guard let raw = chemistryRaw, SanitizerChemistry(rawValue: raw) != nil else {
            return .failure(
                "chemistry must be one of: \(chemistries.map(\.rawValue).joined(separator: ", "))"
            )
        }
        guard let c = concentrationPpm, c.isFinite else {
            return .failure("concentration_ppm must be a number")
        }
        if c < absoluteMinPpm || c > absoluteMaxPpm {
            return .failure(
                "concentration \(SanitizerCompute.fmt(c)) ppm is off the charts — re-test with a fresh strip"
            )
        }
        let label = (pointLabel ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if label.isEmpty {
            return .failure(
                "point_label is required (e.g. \"dish pit final rinse\", \"wiping bucket — grill\")"
            )
        }
        if let wt = waterTempF {
            if !wt.isFinite {
                return .failure("water_temp_f must be a number or omitted")
            }
            if wt < waterTempMinF || wt > waterTempMaxF {
                return .failure("water_temp_f \(SanitizerCompute.fmt(wt))°F is out of plausible range")
            }
        }
        return .success
    }

    // ── classifySanitizer ──────────────────────────────────────────────

    /// Classify a validated reading as ok / low / high. `other` always returns ok
    /// (we record the reading but can't judge it). Mirror of JS `classifySanitizer`.
    public static func classifySanitizer(
        _ chemistry: SanitizerChemistry,
        concentrationPpm: Double,
        waterTempF: Double?
    ) -> SanitizerClassification {
        guard let band = bandFor(chemistry, waterTempF: waterTempF) else {
            return SanitizerClassification(
                status: .ok, band: nil, requiredMinPpm: nil, requiredMaxPpm: nil, breachReason: nil
            )
        }
        if concentrationPpm < band.minPpm {
            return SanitizerClassification(
                status: .low,
                band: band,
                requiredMinPpm: band.minPpm,
                requiredMaxPpm: band.maxPpm,
                breachReason: "\(band.label) read \(fmt(concentrationPpm)) ppm (min \(fmt(band.minPpm)))"
            )
        }
        if concentrationPpm > band.maxPpm {
            return SanitizerClassification(
                status: .high,
                band: band,
                requiredMinPpm: band.minPpm,
                requiredMaxPpm: band.maxPpm,
                breachReason: "\(band.label) read \(fmt(concentrationPpm)) ppm (max \(fmt(band.maxPpm)))"
            )
        }
        return SanitizerClassification(
            status: .ok,
            band: band,
            requiredMinPpm: band.minPpm,
            requiredMaxPpm: band.maxPpm,
            breachReason: nil
        )
    }

    // ── DEFAULT_POINTS ──────────────────────────────────────────────────

    /// Well-known default check points — mirror of JS `DEFAULT_POINTS`. Surfaces
    /// FDA/CO inspectors expect evidence for on every shift.
    public static let defaultPoints: [SanitizerPoint] = [
        SanitizerPoint(id: "dish_final_rinse", label: "Dish pit final rinse", chemistry: .chlorine),
        SanitizerPoint(id: "wiping_bucket_line", label: "Wiping bucket — line", chemistry: .quat),
        SanitizerPoint(id: "wiping_bucket_grill", label: "Wiping bucket — grill", chemistry: .quat),
        SanitizerPoint(id: "three_comp_sink", label: "Three-comp sink", chemistry: .quat),
    ]

    /// Normalize a corrective note: trim, nil when empty (mirror web
    /// `corrective_action ... trim() ... || null`).
    public static func normalizeCorrectiveAction(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // ── formatting ──────────────────────────────────────────────────────

    /// Render a ppm/temp number the way JS string interpolation does: integers
    /// print without a trailing `.0` (e.g. `50`, `200`), fractions keep their
    /// decimals (e.g. `12.5`). Keeps breach_reason strings byte-identical to web.
    static func fmt(_ value: Double) -> String {
        if value == value.rounded() && abs(value) < 1e15 {
            return String(Int(value))
        }
        // Trim any trailing zeros the same way JS Number->String would.
        var s = String(value)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s
    }
}
