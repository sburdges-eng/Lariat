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
}
