import SwiftUI

/// Cook-tier sidebar destinations (P2a: Today only; rest stubbed until P2b–P2d).
enum CookDestination: String, Hashable, CaseIterable, Identifiable {
    case today = "Today"
    case eightySix = "86"
    case stations = "Stations"
    case kds = "KDS"

    var id: String { rawValue }

    var enabled: Bool {
        switch self {
        case .today: return true
        case .eightySix, .stations, .kds: return false
        }
    }

    var stubMessage: String? {
        enabled ? nil : "Coming soon"
    }
}
