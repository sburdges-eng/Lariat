import Foundation
import LariatModel

/// The single shared list of every screen in the app. Adding a feature means
/// adding ONE line here (plus its own `FeatureModule` file + a `FeatureCatalog`
/// descriptor) — no edits to the shell, the sidebar, or any destination enum.
///
/// Metadata (tier/title/enabled/order) is owned by `FeatureCatalog`; this list
/// binds each id to its view builder.
enum FeatureRegistry {
    static let all: [FeatureModule] = [
        // Cook
        .cookToday,
        .cookEightySix,
        .cookStations,
        .cookKds,
        .cookPrep,
        .cookPrepPar,
        .cookMorning,
        // Safety
        .safetyHub,
        .safetyTempLog,
        .safetyCooling,
        .safetyDateMarks,
        .safetyCalibrations,
        .safetyCleaning,
        .safetyBreaks,
        .safetySanitizer,
        .safetyTphc,
        .safetyPest,
        .safetySds,
        .safetySickWorker,
        .safetyReceiving,
        .safetyHaccpPlan,
        // Labor
        .laborCerts,
        .laborSickLeave,
        .laborTipPool,
        .laborWageNotices,
        // Inventory
        .inventoryPar,
        .inventoryCounts,
        .inventoryLog,
        .inventoryWaste,
        // Manager
        .managerCommand,
        .managerAnalytics,
        .managerManagement,
        .managerAuditLog,
        .managerPins,
        .managerTempPins,
        .managerReceivingMatches,
        // Costing
        .costingOverview,
        .costingPriceShocks,
        .costingVarianceAttribution,
        .costingDepletionExceptions,
        .costingIngredientMasters,
        .costingMenuEngineering,
        .costingMarginDeltas,
        .costingComponents,
        // Purchasing
        .purchasingOrderGuide,
        .purchasingCompare,
        .purchasingLink,
        // Front of house
        .fohFloor,
        .fohHost,
        .fohReservations,
        .fohBooking,
    ]

    /// Stable default selection on launch.
    static let defaultId = FeatureCatalog.defaultId

    /// Resolve a feature by id.
    static func module(id: String) -> FeatureModule? {
        all.first { $0.id == id }
    }

    /// Modules for a tier, in registry (sidebar) order.
    static func modules(for tier: FeatureTier) -> [FeatureModule] {
        all.filter { $0.tier == tier }
    }
}
