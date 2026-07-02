import Foundation
import GRDB
import LariatModel

/// Zero-state discriminator counts for the margin-deltas board — mirrors
/// `app/menu-engineering/margin-deltas/page.jsx` L79-85, which decides which
/// empty state to show: missing snapshots, missing dish wiring, or nothing
/// above the threshold. Lives in its own file (A4.3 T2) so the already-ported
/// `MarginDeltasRepository.swift` stays untouched.
public struct MarginDeltasZeroStateCounts: Sendable, Equatable {
    public let historyCount: Int
    public let componentsCount: Int

    public init(historyCount: Int, componentsCount: Int) {
        self.historyCount = historyCount
        self.componentsCount = componentsCount
    }
}

extension MarginDeltasRepository {
    public func zeroStateCounts() async throws -> MarginDeltasZeroStateCounts {
        let loc = locationId
        return try await database.pool.read { db in
            let history = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) AS c FROM vendor_prices_history WHERE location_id = ?",
                arguments: [loc]) ?? 0
            let components = try Int.fetchOne(db,
                sql: "SELECT COUNT(*) AS c FROM dish_components WHERE location_id = ?",
                arguments: [loc]) ?? 0
            return MarginDeltasZeroStateCounts(historyCount: history, componentsCount: components)
        }
    }
}
