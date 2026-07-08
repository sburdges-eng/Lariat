import SwiftUI
import LariatDB
import LariatModel

/// Shared dependency-injection container handed to every feature's `makeView`.
/// `navigate` replaces the old per-feature `onOpenX` closures: a feature asks to
/// open another feature by its stable `id` (e.g. `ctx.navigate("safety.cooling")`).
struct AppContext {
    let database: LariatDatabase
    let writeDatabase: LariatWriteDatabase?
    let catalog: StationCatalog?
    let navigate: (String) -> Void
}

/// A self-describing screen: its UI-free metadata (`descriptor`, the single source
/// of truth from `FeatureCatalog`) paired with a `makeView` that owns its own DI
/// wiring and degrade fallback. Adding a feature means adding one of these to the
/// registry — no edits to the shell, the sidebar, or any destination enum.
struct FeatureModule: Identifiable {
    let descriptor: FeatureDescriptor
    /// Builds the feature's view from shared context. Owns its DI + degrade fallback.
    let makeView: (AppContext) -> AnyView

    var id: String { descriptor.id }
    var tier: FeatureTier { descriptor.tier }
    var title: String { descriptor.title }
    var enabled: Bool { descriptor.enabled }

    /// Build a module by looking its metadata up in `FeatureCatalog` by id, so the
    /// catalog stays the single source of truth for tier/title/enabled/order.
    init(id: String, makeView: @escaping (AppContext) -> AnyView) {
        guard let descriptor = FeatureCatalog.descriptor(id: id) else {
            preconditionFailure("FeatureModule '\(id)' has no FeatureCatalog descriptor")
        }
        self.descriptor = descriptor
        self.makeView = makeView
    }
}
