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

    static let safetySanitizer = FeatureModule(id: "safety.sanitizer") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(SanitizerView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Sanitizer unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyTphc = FeatureModule(id: "safety.tphc") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(TphcView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Time Control unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetyPest = FeatureModule(id: "safety.pest") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(PestView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Pest control unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetySds = FeatureModule(id: "safety.sds") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(SdsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "SDS registry unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let safetySickWorker = FeatureModule(id: "safety.sickWorker") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(SickWorkerView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Sick worker board unavailable",
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

    /// Inspector-ready HACCP plan — READ-ONLY aggregate (no write DB needed).
    static let safetyHaccpPlan = FeatureModule(id: "safety.haccpPlan") { ctx in
        AnyView(HaccpPlanView(database: ctx.database))
    }
}
