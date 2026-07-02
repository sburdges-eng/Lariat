import SwiftUI

/// Manager-tier feature modules.
extension FeatureModule {
    static let managerCommand = FeatureModule(id: "manager.command") { ctx in
        AnyView(CommandView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let managerAnalytics = FeatureModule(id: "manager.analytics") { ctx in
        AnyView(AnalyticsView(database: ctx.database))
    }

    static let managerManagement = FeatureModule(id: "manager.management") { ctx in
        AnyView(ManagementRollupView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    /// A5 — read-only JSONL audit-log viewer (`/management/audit-log`).
    /// No DB dependency: the reader resolves the management-actions JSONL path
    /// itself (LARIAT_AUDIT_PATH override, else `<dataDir>/audit/…`).
    static let managerAuditLog = FeatureModule(id: "manager.auditLog") { _ in
        AnyView(AuditLogView())
    }

    /// A5 — manager PIN users CRUD (`/management/pins`). Writes are the whole
    /// point, so the board degrades to a lock tile without the write database.
    static let managerPins = FeatureModule(id: "manager.pins") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(ManagerPinsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Manager PINs unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    /// A5 — scoped temp-PIN issuance/revocation (`/management/temp-pins`).
    static let managerTempPins = FeatureModule(id: "manager.tempPins") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(TempPinsView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Temp PINs unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }

    /// A5 — receiving-matches resolver (`/management/receiving-matches`).
    static let managerReceivingMatches = FeatureModule(id: "manager.receivingMatches") { ctx in
        if let writeDB = ctx.writeDatabase {
            return AnyView(ReceivingMatchesView(readDB: ctx.database, writeDB: writeDB))
        }
        return AnyView(TileDegrade(
            title: "Receiving matches unavailable",
            message: "Could not open the write database.",
            systemImage: "lock"
        ))
    }
}
