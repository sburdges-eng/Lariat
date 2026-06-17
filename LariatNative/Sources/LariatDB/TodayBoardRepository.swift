import Foundation
import GRDB
import LariatModel

public struct TodayStockMove: Equatable, Sendable {
    public let item: String
    public let direction: String
    public let delta: String?

    public init(item: String, direction: String, delta: String?) {
        self.item = item
        self.direction = direction
        self.delta = delta
    }
}

public struct TodayBoardRawData: Equatable, Sendable {
    public let openEightySixItems: [String]
    public let recentMoves: [TodayStockMove]
    public let lineCheckEntries: [String: [LineCheckItemStatus]]
    public let signedOffStationIds: Set<String>

    public init(
        openEightySixItems: [String],
        recentMoves: [TodayStockMove],
        lineCheckEntries: [String: [LineCheckItemStatus]],
        signedOffStationIds: Set<String>
    ) {
        self.openEightySixItems = openEightySixItems
        self.recentMoves = recentMoves
        self.lineCheckEntries = lineCheckEntries
        self.signedOffStationIds = signedOffStationIds
    }
}

public struct TodayBoardSnapshot: Equatable, Sendable {
    public let shiftDate: String
    public let stations: [StationWithProgress]
    public let activeStations: [StationWithProgress]
    public let readyCount: Int
    public let flaggedCount: Int
    public let openEightySixItems: [String]
    public let recentMoves: [TodayStockMove]
    public let cascadedRecipes: [CascadedRecipe]

    public init(
        shiftDate: String,
        stations: [StationWithProgress],
        activeStations: [StationWithProgress],
        readyCount: Int,
        flaggedCount: Int,
        openEightySixItems: [String],
        recentMoves: [TodayStockMove],
        cascadedRecipes: [CascadedRecipe]
    ) {
        self.shiftDate = shiftDate
        self.stations = stations
        self.activeStations = activeStations
        self.readyCount = readyCount
        self.flaggedCount = flaggedCount
        self.openEightySixItems = openEightySixItems
        self.recentMoves = recentMoves
        self.cascadedRecipes = cascadedRecipes
    }
}

public struct TodayBoardRepository {
    let database: LariatDatabase
    let locationId: String
    let catalog: StationCatalog

    public init(
        database: LariatDatabase,
        catalog: StationCatalog,
        locationId: String = LocationScope.resolve()
    ) {
        self.database = database
        self.catalog = catalog
        self.locationId = locationId
    }

    public func load(shiftDate: String = todayISO()) async throws -> TodayBoardSnapshot {
        let raw = try await fetchRaw(shiftDate: shiftDate)
        return assemble(raw: raw, shiftDate: shiftDate)
    }

    func fetchRaw(shiftDate: String) async throws -> TodayBoardRawData {
        try await database.pool.read { db in
            let openItems = try String.fetchAll(
                db,
                sql: """
                    SELECT item FROM eighty_six
                     WHERE shift_date = ? AND resolved_at IS NULL AND location_id = ?
                     ORDER BY id DESC
                    """,
                arguments: [shiftDate, locationId]
            )

            let moveRows = try Row.fetchAll(
                db,
                sql: """
                    SELECT item, direction, delta FROM inventory_updates
                     WHERE shift_date = ? AND location_id = ?
                     ORDER BY id DESC LIMIT 4
                    """,
                arguments: [shiftDate, locationId]
            )
            let recentMoves = moveRows.map { row in
                TodayStockMove(
                    item: row["item"] as String? ?? "",
                    direction: row["direction"] as String? ?? "",
                    delta: row["delta"] as String?
                )
            }

            let entryRows = try Row.fetchAll(
                db,
                sql: """
                    SELECT station_id, item, status
                      FROM line_check_entries
                     WHERE shift_date = ? AND location_id = ?
                    """,
                arguments: [shiftDate, locationId]
            )
            var lineCheckEntries: [String: [LineCheckItemStatus]] = [:]
            for row in entryRows {
                let stationId = row["station_id"] as String? ?? ""
                let item = row["item"] as String? ?? ""
                let status = row["status"] as String? ?? ""
                lineCheckEntries[stationId, default: []].append(LineCheckItemStatus(item: item, status: status))
            }

            let signedOffIds = Set(
                try String.fetchAll(
                    db,
                    sql: """
                        SELECT DISTINCT station_id FROM station_signoffs
                         WHERE shift_date = ? AND location_id = ?
                        """,
                    arguments: [shiftDate, locationId]
                )
            )

            return TodayBoardRawData(
                openEightySixItems: openItems,
                recentMoves: recentMoves,
                lineCheckEntries: lineCheckEntries,
                signedOffStationIds: signedOffIds
            )
        }
    }

    func assemble(raw: TodayBoardRawData, shiftDate: String) -> TodayBoardSnapshot {
        let stations: [StationWithProgress] = catalog.stations.map { station in
            let template = catalog.lineCheckItems(for: station)
            guard !template.isEmpty else {
                return StationWithProgress(station: station, progress: nil)
            }
            let progress = StationProgressCompute.progress(
                templateItems: template,
                entries: raw.lineCheckEntries[station.id] ?? [],
                signedOff: raw.signedOffStationIds.contains(station.id)
            )
            return StationWithProgress(station: station, progress: progress)
        }
        let active = StationProgressCompute.activeLineCheckStations(stations)
        let cascaded = SubRecipeCascadeCompute.cascadedFromEightySix(
            itemsEightySixed: raw.openEightySixItems,
            recipes: catalog.recipes
        )
        return TodayBoardSnapshot(
            shiftDate: shiftDate,
            stations: stations,
            activeStations: active,
            readyCount: StationProgressCompute.readyCount(stations),
            flaggedCount: StationProgressCompute.flaggedCount(stations),
            openEightySixItems: raw.openEightySixItems,
            recentMoves: raw.recentMoves,
            cascadedRecipes: cascaded
        )
    }
}
