import Foundation
import GRDB
import LariatModel

public struct AccountingVarianceView: Equatable {
    public let theoreticalCogs: Double
    public let actualCogs: Double
    public let variancePct: Double?
}

public struct DishCoverageView: Equatable {
    public let coveragePct: Double?
    public let totalDishes: Int?
    public let coveredDishes: Int?
}

public struct RollupSnapshot: Equatable {
    public let variance: AccountingVarianceView?
    public let coverage: DishCoverageView?
    public let unacknowledgedPackSizeChanges: Int
}

public struct ManagementRollupRepository {
    let database: LariatDatabase
    let locationId: String

    public init(database: LariatDatabase, locationId: String = LocationScope.resolve()) {
        self.database = database
        self.locationId = locationId
    }

    public func load() throws -> RollupSnapshot {
        try database.pool.read { db in
            let v = try AccountingVariance.fetchOne(db,
                sql: "SELECT * FROM accounting_variance WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let c = try DishCoverageSnapshot.fetchOne(db,
                sql: "SELECT * FROM dish_coverage_snapshots WHERE location_id = ? ORDER BY snapshot_at DESC, id DESC LIMIT 1",
                arguments: [locationId])
            let unack = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged = 0") ?? 0
            return RollupSnapshot(
                variance: v.map { AccountingVarianceView(theoreticalCogs: $0.theoreticalCogs, actualCogs: $0.actualCogs, variancePct: $0.variancePct) },
                coverage: c.map { DishCoverageView(coveragePct: $0.coveragePct, totalDishes: $0.totalDishes, coveredDishes: $0.coveredDishes) },
                unacknowledgedPackSizeChanges: unack)
        }
    }
}

extension ManagementRollupRepository {
    /// Re-queries every `interval`. SwiftUI consumes this to refresh tiles, since the
    /// web app writes the shared DB from another process (GRDB ValueObservation can't see that).
    public func stream(every interval: Duration = .seconds(3)) -> AsyncStream<RollupSnapshot> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    if let snap = try? load() { continuation.yield(snap) }
                    try? await Task.sleep(for: interval)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
