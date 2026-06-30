import SwiftUI

/// Safety-tier sidebar destinations (P3a: temp log; P3b: date marks + calibrations).
enum SafetyDestination: String, Hashable, CaseIterable, Identifiable {
    case hub = "Food Safety"
    case tempLog = "Temp log"
    case cooling = "Cooling"
    case dateMarks = "Date marks"
    case calibrations = "Calibrations"
    case cleaning = "Cleaning"
    case breaks = "Breaks"

    var id: String { rawValue }

    var enabled: Bool {
        switch self {
        case .hub, .tempLog, .cooling, .dateMarks, .calibrations: return true
        case .cleaning, .breaks: return true
        }
    }
}
