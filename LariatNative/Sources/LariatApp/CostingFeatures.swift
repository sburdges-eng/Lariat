import SwiftUI

/// Costing-tier feature modules.
extension FeatureModule {
    static let costingOverview = FeatureModule(id: "costing.overview") { ctx in
        AnyView(CostingView(database: ctx.database))
    }

    static let costingPriceShocks = FeatureModule(id: "costing.priceShocks") { ctx in
        AnyView(PriceShocksView(database: ctx.database))
    }

    static let costingVarianceAttribution = FeatureModule(id: "costing.varianceAttribution") { ctx in
        AnyView(VarianceAttributionView(database: ctx.database))
    }

    static let costingDepletionExceptions = FeatureModule(id: "costing.depletionExceptions") { ctx in
        AnyView(DepletionExceptionsView(database: ctx.database))
    }

    static let costingIngredientMasters = FeatureModule(id: "costing.ingredientMasters") { ctx in
        AnyView(IngredientMastersView(readDB: ctx.database, writeDB: ctx.writeDatabase))
    }

    static let costingMenuEngineering = FeatureModule(id: "costing.menuEngineering") { ctx in
        AnyView(MenuEngineeringView(database: ctx.database, navigate: ctx.navigate))
    }

    static let costingMarginDeltas = FeatureModule(id: "costing.marginDeltas") { ctx in
        AnyView(MarginDeltasView(database: ctx.database))
    }
}
