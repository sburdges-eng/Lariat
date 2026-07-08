import SwiftUI

/// Purchasing-tier feature modules (A4.4 wave). The order-guide hub is a pure
/// read (database only); the compare and link boards carry PIN-gated audited
/// writes and degrade to a lock tile when the write database is unavailable.
extension FeatureModule {
    static let purchasingOrderGuide = FeatureModule(id: "purchasing.orderGuide") { ctx in
        AnyView(PurchasingOrderGuideView(database: ctx.database, navigate: ctx.navigate))
    }

    static let purchasingCompare = FeatureModule(id: "purchasing.compare") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(VendorCompareView(readDB: ctx.database, writeDB: writeDB, navigate: ctx.navigate))
        }
        return AnyView(TileDegrade(
            title: "Vendor compare unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let purchasingLink = FeatureModule(id: "purchasing.link") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(VendorLinkView(readDB: ctx.database, writeDB: writeDB, navigate: ctx.navigate))
        }
        return AnyView(TileDegrade(
            title: "Link vendors unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
