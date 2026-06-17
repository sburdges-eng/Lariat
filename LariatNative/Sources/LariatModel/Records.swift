import GRDB

public struct AccountingVariance: FetchableRecord, Decodable {
    public let locationId: String
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let varianceAmount: Double?
    public let variancePct: Double?
    public let snapshotAt: String?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case theoreticalCogs = "theoretical_cogs"
        case actualCogs = "actual_cogs"
        case varianceAmount = "variance_amount"
        case variancePct = "variance_pct"
        case snapshotAt = "snapshot_at"
    }
}

public struct DishCoverageSnapshot: FetchableRecord, Decodable {
    public let locationId: String
    public let totalDishes: Int?
    public let coveredDishes: Int?
    public let coveragePct: Double?
    enum CodingKeys: String, CodingKey {
        case locationId = "location_id"
        case totalDishes = "total_dishes"
        case coveredDishes = "covered_dishes"
        case coveragePct = "coverage_pct"
    }
}

public struct PackSizeChange: FetchableRecord, Decodable {
    public let id: Int64
    public let vendor: String
    public let sku: String
    public let acknowledged: Bool
}
