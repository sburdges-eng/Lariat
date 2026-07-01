import SwiftUI

/// Labor-tier feature modules (A3 wave). Each `static let` pairs a catalog id with
/// its view builder; metadata (tier/title/enabled/order) comes from `FeatureCatalog`.
/// These are payroll-/compliance-sensitive manager boards: reads are open, writes
/// are PIN-gated per-write (native analog of the web `pic.*` scopes).
extension FeatureModule {
    static let laborCerts = FeatureModule(id: "labor.certs") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(StaffCertsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Certifications unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let laborSickLeave = FeatureModule(id: "labor.sickLeave") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(SickLeaveView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Sick time unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    static let laborTipPool = FeatureModule(id: "labor.tipPool") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(TipPoolView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Tip pool unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
