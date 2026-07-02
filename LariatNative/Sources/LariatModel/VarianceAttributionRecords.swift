import Foundation

// Record types for costing.varianceAttribution — port of lib/varianceAttribution.ts.
// Money is `Double` dollars (NOT cents) for this wave; see A4.2 plan Global Constraints.

// MARK: - Window / delta (Task 1)

public struct VarianceAttrPeriod: Sendable, Equatable {
    public let periodStart: String?
    public let periodEnd: String
    public let theoreticalCogs: Double?
    public let actualCogs: Double?
    public let varianceAmount: Double?
    public let variancePct: Double?
    public let thresholdColor: ThresholdColor

    public init(
        periodStart: String?, periodEnd: String,
        theoreticalCogs: Double?, actualCogs: Double?,
        varianceAmount: Double?, variancePct: Double?,
        thresholdColor: ThresholdColor
    ) {
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.theoreticalCogs = theoreticalCogs
        self.actualCogs = actualCogs
        self.varianceAmount = varianceAmount
        self.variancePct = variancePct
        self.thresholdColor = thresholdColor
    }
}

public struct VarianceAttrWindow: Sendable, Equatable {
    public let from: String?
    public let to: String?

    public init(from: String?, to: String?) {
        self.from = from
        self.to = to
    }
}

public struct VarianceAttrDelta: Sendable, Equatable {
    public let baseline: VarianceAttrPeriod?
    public let current: VarianceAttrPeriod?
    public let deltaAmount: Double?
    public let deltaPct: Double?

    public init(baseline: VarianceAttrPeriod?, current: VarianceAttrPeriod?, deltaAmount: Double?, deltaPct: Double?) {
        self.baseline = baseline
        self.current = current
        self.deltaAmount = deltaAmount
        self.deltaPct = deltaPct
    }
}

/// Raw variance row the repository hands in (period_end + the four numeric cols).
public struct VarianceAttrRow: Sendable, Equatable {
    public let periodStart: String?
    public let periodEnd: String
    public let theoreticalCogs: Double?
    public let actualCogs: Double?
    public let varianceAmount: Double?
    public let variancePct: Double?

    public init(
        periodStart: String?, periodEnd: String,
        theoreticalCogs: Double?, actualCogs: Double?,
        varianceAmount: Double?, variancePct: Double?
    ) {
        self.periodStart = periodStart
        self.periodEnd = periodEnd
        self.theoreticalCogs = theoreticalCogs
        self.actualCogs = actualCogs
        self.varianceAmount = varianceAmount
        self.variancePct = variancePct
    }
}

public enum VarianceAttrWindowResult: Sendable, Equatable {
    /// window.from/to are non-nil in this case.
    case ok(window: VarianceAttrWindow, delta: VarianceAttrDelta)
    case failed(reason: String)
}

// MARK: - Evidence sections (Task 2)

public struct PriceMoveItem: Sendable, Equatable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let firstPrice: Double?
    public let lastPrice: Double?
    public let pctMove: Double?
    public let firstAt: String
    public let lastAt: String
    public let snapshots: Int
    public let linkedToMenu: Bool

    public init(
        vendor: String, sku: String, ingredient: String,
        firstPrice: Double?, lastPrice: Double?, pctMove: Double?,
        firstAt: String, lastAt: String, snapshots: Int, linkedToMenu: Bool
    ) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.firstPrice = firstPrice
        self.lastPrice = lastPrice
        self.pctMove = pctMove
        self.firstAt = firstAt
        self.lastAt = lastAt
        self.snapshots = snapshots
        self.linkedToMenu = linkedToMenu
    }
}

public struct CompositionChangeItem: Sendable, Equatable {
    public let dishName: String
    public let component: String
    public let componentType: String
    /// "created" | "updated"
    public let changeKind: String
    public let changedAt: String

    public init(dishName: String, component: String, componentType: String, changeKind: String, changedAt: String) {
        self.dishName = dishName
        self.component = component
        self.componentType = componentType
        self.changeKind = changeKind
        self.changedAt = changedAt
    }
}

public struct CountCorrectionItem: Sendable, Equatable {
    /// "audit" | "count_closed"
    public let kind: String
    public let entity: String?
    public let action: String?
    public let transition: String?
    public let actorCookId: String?
    public let entityId: Int?
    public let countId: Int?
    public let lines: Int?
    public let label: String?
    public let countDate: String?
    public let at: String

    public init(
        kind: String, entity: String?, action: String?, transition: String?, actorCookId: String?,
        entityId: Int?, countId: Int?, lines: Int?, label: String?, countDate: String?, at: String
    ) {
        self.kind = kind
        self.entity = entity
        self.action = action
        self.transition = transition
        self.actorCookId = actorCookId
        self.entityId = entityId
        self.countId = countId
        self.lines = lines
        self.label = label
        self.countDate = countDate
        self.at = at
    }
}

public struct UnresolvedDepletionItem: Sendable, Equatable {
    public let itemName: String
    public let periodLabel: String?
    public let qtySold: Double?
    public let netSales: Double?

    public init(itemName: String, periodLabel: String?, qtySold: Double?, netSales: Double?) {
        self.itemName = itemName
        self.periodLabel = periodLabel
        self.qtySold = qtySold
        self.netSales = netSales
    }
}

// Raw rows the repository hands in.

public struct PriceSnapRow: Sendable, Equatable {
    public let vendor: String
    public let sku: String
    public let ingredient: String
    public let unitPrice: Double?
    public let snapshotAt: String

    public init(vendor: String, sku: String, ingredient: String, unitPrice: Double?, snapshotAt: String) {
        self.vendor = vendor
        self.sku = sku
        self.ingredient = ingredient
        self.unitPrice = unitPrice
        self.snapshotAt = snapshotAt
    }
}

public struct CompRow: Sendable, Equatable {
    public let dishName: String
    public let componentType: String
    public let recipeSlug: String?
    public let vendorIngredient: String?
    public let qtyPerServing: Double?
    public let unit: String?
    public let createdAt: String?
    public let updatedAt: String?

    public init(
        dishName: String, componentType: String, recipeSlug: String?, vendorIngredient: String?,
        qtyPerServing: Double?, unit: String?, createdAt: String?, updatedAt: String?
    ) {
        self.dishName = dishName
        self.componentType = componentType
        self.recipeSlug = recipeSlug
        self.vendorIngredient = vendorIngredient
        self.qtyPerServing = qtyPerServing
        self.unit = unit
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct AuditRow: Sendable, Equatable {
    public let entity: String
    public let entityId: Int?
    public let action: String
    public let actorCookId: String?
    public let payloadJson: String?
    public let createdAt: String

    public init(entity: String, entityId: Int?, action: String, actorCookId: String?, payloadJson: String?, createdAt: String) {
        self.entity = entity
        self.entityId = entityId
        self.action = action
        self.actorCookId = actorCookId
        self.payloadJson = payloadJson
        self.createdAt = createdAt
    }
}

public struct ClosedCountRow: Sendable, Equatable {
    public let id: Int
    public let label: String?
    public let countDate: String?
    public let closedAt: String
    public let lines: Int

    public init(id: Int, label: String?, countDate: String?, closedAt: String, lines: Int) {
        self.id = id
        self.label = label
        self.countDate = countDate
        self.closedAt = closedAt
        self.lines = lines
    }
}

public struct SalesLineRow: Sendable, Equatable {
    public let itemName: String
    public let periodLabel: String?
    public let quantitySold: Double?
    public let netSales: Double?

    public init(itemName: String, periodLabel: String?, quantitySold: Double?, netSales: Double?) {
        self.itemName = itemName
        self.periodLabel = periodLabel
        self.quantitySold = quantitySold
        self.netSales = netSales
    }
}

// MARK: - Repository payload (Task 3)

public struct VarianceAttributionResult: Sendable, Equatable {
    public let ok: Bool
    public let reason: String?
    public let locationId: String
    public let window: VarianceAttrWindow
    public let variance: VarianceAttrDelta
    public let priceMoves: [PriceMoveItem]
    public let compositionChanges: [CompositionChangeItem]
    public let countCorrections: [CountCorrectionItem]
    public let unresolvedDepletions: [UnresolvedDepletionItem]
    public let unresolvedNote: String?
    public let unattributed: Bool
    public let caveat: String

    public init(
        ok: Bool, reason: String?, locationId: String,
        window: VarianceAttrWindow, variance: VarianceAttrDelta,
        priceMoves: [PriceMoveItem], compositionChanges: [CompositionChangeItem],
        countCorrections: [CountCorrectionItem], unresolvedDepletions: [UnresolvedDepletionItem],
        unresolvedNote: String?, unattributed: Bool, caveat: String
    ) {
        self.ok = ok
        self.reason = reason
        self.locationId = locationId
        self.window = window
        self.variance = variance
        self.priceMoves = priceMoves
        self.compositionChanges = compositionChanges
        self.countCorrections = countCorrections
        self.unresolvedDepletions = unresolvedDepletions
        self.unresolvedNote = unresolvedNote
        self.unattributed = unattributed
        self.caveat = caveat
    }
}
