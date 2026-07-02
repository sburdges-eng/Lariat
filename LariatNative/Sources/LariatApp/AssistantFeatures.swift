import SwiftUI

/// Phase B feature module: the LaRi kitchen assistant (LLM chat + actions).
/// Tier rationale (documented in docs/superpowers/plans/
/// 2026-07-02-lariat-native-phase-b-assistant.md): the web surface is
/// deliberately open to line cooks — questions un-gated, mutations PIN-gated
/// inside the flow — which maps onto the existing COOK tier + in-surface
/// PinEntrySheet (cook.morning precedent). No new FeatureTier.
extension FeatureModule {
    /// `/kitchen-assistant` — chat surface + the ten audited LLM actions.
    /// Writes are the point (86s, line checks, gold stars, …), so the board
    /// degrades to a lock tile without the write database.
    static let cookAssistant = FeatureModule(id: "cook.assistant") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(KitchenAssistantView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Assistant unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
