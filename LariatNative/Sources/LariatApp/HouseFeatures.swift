import SwiftUI

/// House-tier feature modules (A6.2): venue-program boards that are neither
/// kitchen production nor compliance — the bar program (pour costs + bar
/// par, read-only), the equipment tracker (open non-audited writes, web
/// parity), and the gold-stars recognition wall (PIN-gated audited writes).
/// Tier choice documented in
/// docs/superpowers/plans/2026-07-02-lariat-native-a6-2-bar-equipment-goldstars.md.
extension FeatureModule {
    static let houseBar = FeatureModule(id: "house.bar") { ctx in
        AnyView(BarView(readDB: ctx.database, navigate: ctx.navigate))
    }

    static let houseBarPar = FeatureModule(id: "house.barPar") { ctx in
        AnyView(BarParView(readDB: ctx.database, navigate: ctx.navigate))
    }

    static let houseEquipment = FeatureModule(id: "house.equipment") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(EquipmentView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Equipment unavailable",
            message: "Could not open the write database.",
            systemImage: "wrench.and.screwdriver"
        ))
    }

    static let houseGoldStars = FeatureModule(id: "house.goldStars") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(GoldStarsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Gold stars unavailable",
            message: "Could not open the write database.",
            systemImage: "star"
        ))
    }
}
