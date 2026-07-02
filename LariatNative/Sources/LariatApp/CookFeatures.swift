import SwiftUI

/// Cook-tier feature modules. Each `static let` pairs a catalog id with its view
/// builder; metadata (tier/title/enabled/order) comes from `FeatureCatalog`.
extension FeatureModule {
    static let cookToday = FeatureModule(id: "cook.today") { ctx in
        AnyView(
            TodayView(
                database: ctx.database,
                writeDB: ctx.writeDatabase,
                catalog: ctx.catalog,
                onOpenEightySix: { ctx.navigate("cook.eightySix") }
            )
        )
    }

    static let cookEightySix = FeatureModule(id: "cook.eightySix") { ctx in
        if let writeDB = ctx.writeDatabase, let catalog = ctx.catalog {
            return AnyView(EightySixView(readDB: ctx.database, writeDB: writeDB, catalog: catalog))
        }
        return AnyView(TileDegrade(
            title: "86 unavailable",
            message: "Could not open the write database or station catalog.",
            systemImage: "lock"
        ))
    }

    static let cookStations = FeatureModule(id: "cook.stations") { ctx in
        if let writeDB = ctx.writeDatabase, let catalog = ctx.catalog {
            return AnyView(StationsListView(readDB: ctx.database, writeDB: writeDB, catalog: catalog))
        }
        return AnyView(TileDegrade(
            title: "Stations unavailable",
            message: "Could not open the write database or station catalog.",
            systemImage: "lock"
        ))
    }

    static let cookKds = FeatureModule(id: "cook.kds") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(KdsPunchView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "KDS unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let cookPrep = FeatureModule(id: "cook.prep") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(PrepView(
                readDB: ctx.database,
                writeDB: writeDB,
                stations: ctx.catalog?.stations ?? []
            ))
        }
        return AnyView(TileDegrade(
            title: "Prep unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let cookPrepPar = FeatureModule(id: "cook.prepPar") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(PrepParView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Prep par unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    /// Morning digest — a PIN-gated, read-only aggregate. The digest reads via the
    /// read DB; the write DB is passed only so the PIN gate (PinEntrySheet) can
    /// unlock the surface, mirroring the web /morning manager-PIN gate. When the
    /// write DB is unavailable, MorningView degrades to a locked state on its own.
    static let cookMorning = FeatureModule(id: "cook.morning") { ctx in
        AnyView(MorningView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }
}
