import SwiftUI

/// Manager-tier feature modules.
extension FeatureModule {
    static let managerCommand = FeatureModule(id: "manager.command") { ctx in
        AnyView(CommandView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }

    static let managerAnalytics = FeatureModule(id: "manager.analytics") { ctx in
        AnyView(AnalyticsView(database: ctx.database))
    }

    static let managerCosting = FeatureModule(id: "manager.costing") { ctx in
        AnyView(CostingView(database: ctx.database))
    }

    static let managerManagement = FeatureModule(id: "manager.management") { ctx in
        AnyView(ManagementRollupView(database: ctx.database, writeDatabase: ctx.writeDatabase))
    }
}
