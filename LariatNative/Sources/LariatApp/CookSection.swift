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
        case .eightySix: return true
        case .stations: return true
        case .kds: return true
        }
    }

    var stubMessage: String? {
        enabled ? nil : "Coming soon"
    }
}
