import SwiftUI

/// Inventory-tier feature modules (A4.1). Each `static let` pairs a catalog id
/// with its view builder; metadata (tier/title/order) comes from `FeatureCatalog`.
/// Reads are open; add/remove writes are audited but NOT PIN-gated (the
/// /inventory area is unregulated relative to the safety/labor tiers).
extension FeatureModule {
    static let inventoryPar = FeatureModule(id: "inventory.par") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(InventoryParView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Par unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let inventoryCounts = FeatureModule(id: "inventory.counts") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(InventoryCountsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Counts unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let inventoryLog = FeatureModule(id: "inventory.log") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(InventoryLogView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Log unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let inventoryWaste = FeatureModule(id: "inventory.waste") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(InventoryWasteView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Waste unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
