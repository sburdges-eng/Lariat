import Foundation

/// Sidebar tier a feature belongs to. Sidebar sections render in `allCases` order.
/// Lives in LariatModel (UI-free) so feature metadata + ordering is testable without
/// pulling in SwiftUI or the executable app target.
public enum FeatureTier: String, CaseIterable, Hashable, Sendable {
    case cook = "Cook"
    case safety = "Safety"
    case manager = "Manager"
}

/// UI-free description of one registered screen: its stable id, tier, title, and
/// whether it is currently enabled (vs shown disabled with a "Soon" badge).
/// The app layer pairs each descriptor with a `makeView` closure.
public struct FeatureDescriptor: Identifiable, Hashable, Sendable {
    public let id: String
    public let tier: FeatureTier
    public let title: String
    public let enabled: Bool

    public init(id: String, tier: FeatureTier, title: String, enabled: Bool = true) {
        self.id = id
        self.tier = tier
        self.title = title
        self.enabled = enabled
    }
}

/// Single source of truth for which features exist, their tiers, titles, enabled
/// state, and sidebar order. Adding a feature appends ONE descriptor here.
/// The app's `FeatureRegistry` maps each descriptor to a view.
public enum FeatureCatalog {
    public static let all: [FeatureDescriptor] = [
        // Cook
        FeatureDescriptor(id: "cook.today", tier: .cook, title: "Today"),
        FeatureDescriptor(id: "cook.eightySix", tier: .cook, title: "86"),
        FeatureDescriptor(id: "cook.stations", tier: .cook, title: "Stations"),
        FeatureDescriptor(id: "cook.kds", tier: .cook, title: "KDS"),
        // Safety
        FeatureDescriptor(id: "safety.hub", tier: .safety, title: "Food Safety"),
        FeatureDescriptor(id: "safety.tempLog", tier: .safety, title: "Temp log"),
        FeatureDescriptor(id: "safety.cooling", tier: .safety, title: "Cooling"),
        FeatureDescriptor(id: "safety.tphc", tier: .safety, title: "Time Control"),
        FeatureDescriptor(id: "safety.dateMarks", tier: .safety, title: "Date marks"),
        FeatureDescriptor(id: "safety.calibrations", tier: .safety, title: "Calibrations"),
        FeatureDescriptor(id: "safety.cleaning", tier: .safety, title: "Cleaning"),
        FeatureDescriptor(id: "safety.breaks", tier: .safety, title: "Breaks"),
        // Manager
        FeatureDescriptor(id: "manager.command", tier: .manager, title: "Command"),
        FeatureDescriptor(id: "manager.analytics", tier: .manager, title: "Analytics"),
        FeatureDescriptor(id: "manager.costing", tier: .manager, title: "Costing"),
        FeatureDescriptor(id: "manager.management", tier: .manager, title: "Management"),
    ]

    /// Stable default selection on launch.
    public static let defaultId = "cook.today"

    public static func descriptor(id: String) -> FeatureDescriptor? {
        all.first { $0.id == id }
    }

    public static func descriptors(for tier: FeatureTier) -> [FeatureDescriptor] {
        all.filter { $0.tier == tier }
    }
}
