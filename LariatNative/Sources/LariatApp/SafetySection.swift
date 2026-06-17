import SwiftUI

/// Safety-tier sidebar destinations (P3a: temp log; rest stubbed until P3b–P3c).
enum SafetyDestination: String, Hashable, CaseIterable, Identifiable {
    case hub = "Food Safety"
    case tempLog = "Temp log"
    case dateMarks = "Date marks"
    case calibrations = "Calibrations"
    case cleaning = "Cleaning"
    case breaks = "Breaks"

    var id: String { rawValue }

    var enabled: Bool {
        switch self {
        case .hub, .tempLog: return true
        case .dateMarks, .calibrations, .cleaning, .breaks: return false
        }
    }
}
