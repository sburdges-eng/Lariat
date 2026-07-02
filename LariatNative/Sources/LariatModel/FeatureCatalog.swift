import Foundation

/// Sidebar tier a feature belongs to. Sidebar sections render in `allCases` order.
/// Lives in LariatModel (UI-free) so feature metadata + ordering is testable without
/// pulling in SwiftUI or the executable app target.
public enum FeatureTier: String, CaseIterable, Hashable, Sendable {
    case cook = "Cook"
    case safety = "Safety"
    case labor = "Labor"
    case inventory = "Inventory"
    case manager = "Manager"
    case costing = "Costing"
    case purchasing = "Purchasing"
    case foh = "Front of house"
    case shows = "Shows"
    case house = "House"
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
        FeatureDescriptor(id: "cook.prep", tier: .cook, title: "Prep"),
        FeatureDescriptor(id: "cook.prepPar", tier: .cook, title: "Prep par"),
        // PIN-gated on the web (/morning is a SENSITIVE_PREFIX); the surface
        // enforces the PIN itself, so it stays enabled in the catalog.
        FeatureDescriptor(id: "cook.morning", tier: .cook, title: "Morning"),
        // Safety
        FeatureDescriptor(id: "safety.hub", tier: .safety, title: "Food Safety"),
        FeatureDescriptor(id: "safety.tempLog", tier: .safety, title: "Temp log"),
        FeatureDescriptor(id: "safety.cooling", tier: .safety, title: "Cooling"),
        FeatureDescriptor(id: "safety.dateMarks", tier: .safety, title: "Date marks"),
        FeatureDescriptor(id: "safety.calibrations", tier: .safety, title: "Calibrations"),
        FeatureDescriptor(id: "safety.cleaning", tier: .safety, title: "Cleaning"),
        FeatureDescriptor(id: "safety.breaks", tier: .safety, title: "Breaks"),
        FeatureDescriptor(id: "safety.sanitizer", tier: .safety, title: "Sanitizer"),
        FeatureDescriptor(id: "safety.tphc", tier: .safety, title: "Time Control"),
        FeatureDescriptor(id: "safety.pest", tier: .safety, title: "Pest control"),
        FeatureDescriptor(id: "safety.sds", tier: .safety, title: "SDS"),
        FeatureDescriptor(id: "safety.sickWorker", tier: .safety, title: "Sick worker"),
        FeatureDescriptor(id: "safety.receiving", tier: .safety, title: "Receiving"),
        FeatureDescriptor(id: "safety.haccpPlan", tier: .safety, title: "HACCP plan"),
        // Labor
        FeatureDescriptor(id: "labor.certs", tier: .labor, title: "Certifications"),
        FeatureDescriptor(id: "labor.sickLeave", tier: .labor, title: "Sick time"),
        FeatureDescriptor(id: "labor.tipPool", tier: .labor, title: "Tip pool"),
        FeatureDescriptor(id: "labor.wageNotices", tier: .labor, title: "Wage notices"),
        // Inventory
        FeatureDescriptor(id: "inventory.par", tier: .inventory, title: "Par"),
        FeatureDescriptor(id: "inventory.counts", tier: .inventory, title: "Counts"),
        FeatureDescriptor(id: "inventory.log", tier: .inventory, title: "Log"),
        FeatureDescriptor(id: "inventory.waste", tier: .inventory, title: "Waste"),
        // Manager
        FeatureDescriptor(id: "manager.command", tier: .manager, title: "Command"),
        FeatureDescriptor(id: "manager.analytics", tier: .manager, title: "Analytics"),
        FeatureDescriptor(id: "manager.management", tier: .manager, title: "Management"),
        // Manager — A5 management-writes wave
        FeatureDescriptor(id: "manager.auditLog", tier: .manager, title: "Audit log"),
        FeatureDescriptor(id: "manager.pins", tier: .manager, title: "PINs"),
        FeatureDescriptor(id: "manager.tempPins", tier: .manager, title: "Temp PINs"),
        FeatureDescriptor(id: "manager.receivingMatches", tier: .manager, title: "Receiving matches"),
        // Costing
        FeatureDescriptor(id: "costing.overview", tier: .costing, title: "Costing"),
        FeatureDescriptor(id: "costing.priceShocks", tier: .costing, title: "Price shocks"),
        FeatureDescriptor(id: "costing.varianceAttribution", tier: .costing, title: "Variance attribution"),
        FeatureDescriptor(id: "costing.depletionExceptions", tier: .costing, title: "Depletion exceptions"),
        FeatureDescriptor(id: "costing.ingredientMasters", tier: .costing, title: "Ingredient masters"),
        FeatureDescriptor(id: "costing.menuEngineering", tier: .costing, title: "Menu performance"),
        FeatureDescriptor(id: "costing.marginDeltas", tier: .costing, title: "Margin moves"),
        FeatureDescriptor(id: "costing.components", tier: .costing, title: "Dish components"),
        // Purchasing (A4.4)
        FeatureDescriptor(id: "purchasing.orderGuide", tier: .purchasing, title: "Order guide"),
        FeatureDescriptor(id: "purchasing.compare", tier: .purchasing, title: "Vendor compare"),
        FeatureDescriptor(id: "purchasing.link", tier: .purchasing, title: "Link vendors"),
        // Front of house (A6.1). /host + /booking are PIN-gated on the web
        // middleware; natively the host board gates its own writes and
        // booking is read-only, so all four stay enabled in the catalog.
        FeatureDescriptor(id: "foh.floor", tier: .foh, title: "Floor"),
        FeatureDescriptor(id: "foh.host", tier: .foh, title: "Host stand"),
        FeatureDescriptor(id: "foh.reservations", tier: .foh, title: "Reservations"),
        FeatureDescriptor(id: "foh.booking", tier: .foh, title: "Booking"),
        // Shows (A6.4) — PIN-gated on the web (/shows SENSITIVE_PREFIXES);
        // each surface enforces the PIN itself, so they stay enabled here.
        FeatureDescriptor(id: "shows.tonight", tier: .shows, title: "Tonight"),
        FeatureDescriptor(id: "shows.boxOffice", tier: .shows, title: "Box office"),
        FeatureDescriptor(id: "shows.settlement", tier: .shows, title: "Settlement"),
        FeatureDescriptor(id: "shows.sound", tier: .shows, title: "Sound"),
        FeatureDescriptor(id: "shows.stage", tier: .shows, title: "Stage"),
        FeatureDescriptor(id: "shows.archive", tier: .shows, title: "Archive"),
        // House (A6.2) — venue-program boards. /bar and /equipment are open
        // on the web (not in middleware SENSITIVE_PREFIXES); /gold-stars
        // reads are open and its writes PIN-gate themselves in the surface,
        // so all four stay enabled in the catalog.
        FeatureDescriptor(id: "house.bar", tier: .house, title: "Bar program"),
        FeatureDescriptor(id: "house.barPar", tier: .house, title: "Bar par"),
        FeatureDescriptor(id: "house.equipment", tier: .house, title: "Equipment"),
        FeatureDescriptor(id: "house.goldStars", tier: .house, title: "Gold stars"),
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
