import Foundation

/// Output row of `DepletionExceptionsRepository.list` — one dish whose sales
/// couldn't be resolved into inventory depletions. Mirrors
/// `lib/depletionExceptions.ts`'s `DepletionException` interface. Lives in
/// LariatModel (not LariatDB) so the View can consume it without importing
/// GRDB, mirroring the `MarginDeltaRow` precedent.
public struct DepletionException: Sendable, Equatable, Identifiable {
    public var id: String { dishName }
    public let dishName: String
    public let reason: DepletionReason
    public let detail: String?
    public let affectedSalesCount: Int
    public let totalQuantitySold: Double
    public let totalNetSales: Double?
    public let latestImportedAt: String?
    public let samplePeriodLabels: [String]

    public init(
        dishName: String,
        reason: DepletionReason,
        detail: String?,
        affectedSalesCount: Int,
        totalQuantitySold: Double,
        totalNetSales: Double?,
        latestImportedAt: String?,
        samplePeriodLabels: [String]
    ) {
        self.dishName = dishName
        self.reason = reason
        self.detail = detail
        self.affectedSalesCount = affectedSalesCount
        self.totalQuantitySold = totalQuantitySold
        self.totalNetSales = totalNetSales
        self.latestImportedAt = latestImportedAt
        self.samplePeriodLabels = samplePeriodLabels
    }
}
