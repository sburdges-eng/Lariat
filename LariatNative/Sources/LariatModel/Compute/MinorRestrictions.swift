import Foundation

/// L5 — minor-employee station restrictions. Pure port of `lib/minorRestrictions.ts`.
///
/// Citation: C.R.S. §8-12-101 et seq. (Colorado Youth Employment Opportunity
/// Act) + 29 CFR 570.50+ (federal Hazardous Orders 14/15/16). Employees under
/// 18 may not operate power-driven slicers, choppers, grinders, mixers, deep
/// fryers, and similar equipment. Station ids are pattern-matched against the
/// hazard categories. Expansion is by code-edit (parity with the web module).
///
/// No DB, no I/O. The repository reads cook minor-status from `staff_flags`
/// and asks this whether the assignment is prohibited.
public enum MinorRestrictions {
    public static let citation =
        "C.R.S. §8-12-101 et seq. (CO YEOA); 29 CFR 570.50+ (Hazardous Orders 14-16)"

    // Mirrors MINOR_PROHIBITED_STATION_PATTERNS in lib/minorRestrictions.ts,
    // pattern-for-pattern. Case-insensitive.
    private static let patternSources = [
        "^prep$|^prep[-_]",   // prep — slicers, dicers, mandolines
        "grind",              // meat/spice grinders (HO 10)
        "slicer",             // power-driven slicers (HO 10)
        "mixer",              // commercial mixers (HO 11)
        "bakery",             // bakery mixers + bench equipment (HO 11)
        "^fry(er)?($|[-_])",  // deep fryers (HO 14 — conservative full ban)
    ]

    private static let patterns: [NSRegularExpression] = patternSources.compactMap {
        try? NSRegularExpression(pattern: $0, options: [.caseInsensitive])
    }

    public static func isStationProhibitedForMinor(_ stationId: String) -> Bool {
        let id = stationId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return false }
        let range = NSRange(id.startIndex..<id.endIndex, in: id)
        for re in patterns where re.firstMatch(in: id, options: [], range: range) != nil {
            return true
        }
        return false
    }
}
