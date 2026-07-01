import SwiftUI

/// Safety-tier feature modules. The hub (`safety.hub`) is itself a feature that
/// renders a button per other safety module via `ctx.navigate`.
extension FeatureModule {
    static let safetyHub = FeatureModule(id: "safety.hub") { ctx in
        AnyView(FoodSafetyHubView(context: ctx))
    }

    static let safetyTempLog = FeatureModule(id: "safety.tempLog") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(TempLogView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Temp log unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyCooling = FeatureModule(id: "safety.cooling") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(CoolingView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Cooling unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyReceiving = FeatureModule(id: "safety.receiving") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(ReceivingView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Receiving unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyDateMarks = FeatureModule(id: "safety.dateMarks") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(DateMarkView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Date marks unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyCalibrations = FeatureModule(id: "safety.calibrations") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(CalibrationsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Calibrations unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyCleaning = FeatureModule(id: "safety.cleaning") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(CleaningView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Cleaning unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyBreaks = FeatureModule(id: "safety.breaks") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(BreakBoardView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Breaks unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
