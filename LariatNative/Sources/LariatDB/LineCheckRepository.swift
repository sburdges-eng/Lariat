import Foundation
import GRDB
import LariatModel

public struct LineCheckRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let catalog: StationCatalog

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase, catalog: StationCatalog) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.catalog = catalog
    }

    public func loadStationList(
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> [StationListRow] {
        let candidates = catalog.stations.filter { !catalog.lineCheckItems(for: $0).isEmpty }
        return try await readDB.pool.read { db in
            var rows: [StationListRow] = []
            for station in candidates {
                let template = catalog.lineCheckItems(for: station)
                let entries = try Self.fetchLatestEntries(
                    db: db, shiftDate: date, stationId: station.id, locationId: locationId
                )
                let signedOff = try Self.hasSignoff(
                    db: db, shiftDate: date, stationId: station.id, locationId: locationId
                )
                let progress = Self.computeProgress(
                    template: template,
                    entries: entries,
                    signedOff: signedOff
                )
                rows.append(StationListRow(station: station, progress: progress))
            }
            return rows
        }
    }

    public func loadChecklist(
        stationId: String,
        date: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> StationChecklistSnapshot {
        guard let station = catalog.stations.first(where: { $0.id == stationId }) else {
            throw LineCheckWriteError.stationNotFound
        }
        let template = catalog.lineCheckItems(for: station)
        return try await readDB.pool.read { db in
            let latest = try Self.fetchLatestEntries(
                db: db, shiftDate: date, stationId: stationId, locationId: locationId
            )
            let signoff = try Self.fetchSignoff(
                db: db, shiftDate: date, stationId: stationId, locationId: locationId
            )
            var items: [String: LineCheckItemState] = [:]
            for item in template {
                if let row = latest[item] {
                    items[item] = Self.itemState(from: row)
                } else {
                    items[item] = LineCheckItemState(status: nil)
                }
            }
            let progress = Self.computeProgress(
                template: template,
                entries: latest,
                signedOff: signoff != nil
            )
            return StationChecklistSnapshot(
                station: station,
                shiftDate: date,
                templateItems: template,
                items: items,
                signoff: signoff,
                progress: progress
            )
        }
    }

    @discardableResult
    public func postEntry(_ input: LineCheckPostInput, context: RegulatedWriteContext) throws -> Int64 {
        let shiftDate = clip(input.shiftDate, max: 32) ?? context.shiftDate
        let stationId = clip(input.stationId, max: 64)
        let item = clip(input.item, max: 300)
        let cookId = clip(input.cookId, max: 64)
        guard let stationId, let item, !item.isEmpty else { throw LineCheckWriteError.missingFields }
        guard let cookId, !cookId.isEmpty else { throw LineCheckWriteError.cookRequired }

        let par = clip(input.par, max: 64)
        let have = clip(input.have, max: 64)
        let need = clip(input.need, max: 64)
        let note = clip(input.note, max: 1000)
        let glove: Int? = {
            guard let attested = input.gloveChangeAttested else { return nil }
            return attested ? 1 : 0
        }()

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO line_check_entries (
                    shift_date, station_id, item, status, par, have, need, note,
                    cook_id, glove_change_attested, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    shiftDate, stationId, item, input.status.rawValue,
                    par, have, need, note, cookId, glove, context.locationId,
                ]
            )
            let newId = db.lastInsertedRowID
            var payload: [String: String] = [
                "station_id": stationId,
                "item": item,
                "status": input.status.rawValue,
            ]
            if let glove { payload["glove_change_attested"] = String(glove) }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "line_check_entries",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId ?? cookId,
                    actorSource: context.actorSource,
                    payload: payload,
                    shiftDate: shiftDate,
                    locationId: context.locationId
                )
            )
            return newId
        }
    }

    @discardableResult
    public func signoff(
        stationId: String,
        context: RegulatedWriteContext,
        signoffType: String = "self"
    ) throws -> StationSignoffRow {
        let station = clip(stationId, max: 64)
        let cookId = clip(context.actorCookId, max: 64)
        guard let station, let cookId, !cookId.isEmpty else { throw LineCheckWriteError.cookRequired }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // Gate ordering (parity with app/api/signoff/route.ts): regulatory >
            // operational > write. L5 (minor/HO equipment) fires before L6
            // (sick-worker exclusion), both before the unnoted-fails 409 check.

            // L5 — minor on prohibited station (CO YEOA + 29 CFR 570.50+). Read
            // the cook's ACTIVE minor flag (effective_to IS NULL) scoped to this
            // location; an assignment to hazardous equipment is a 422 block.
            let minorFlag = try Int.fetchOne(
                db,
                sql: """
                  SELECT 1 FROM staff_flags
                   WHERE location_id = ? AND cook_id = ? AND flag = 'minor' AND effective_to IS NULL
                   LIMIT 1
                  """,
                arguments: [context.locationId, cookId]
            )
            if minorFlag != nil, MinorRestrictions.isStationProhibitedForMinor(station) {
                throw LineCheckWriteError.minorProhibited(
                    citation: MinorRestrictions.citation,
                    station: station
                )
            }

            // L6 — sick-worker exclusion (FDA 2022 §2-201.12). Pull every OPEN
            // report (return_at IS NULL) for this cook+location; the pure helper
            // decides if any blocks (excluded|restricted). monitor/none never block.
            let sickRows = try Row.fetchAll(
                db,
                sql: """
                  SELECT action, return_at FROM sick_worker_reports
                   WHERE location_id = ? AND cook_id = ? AND return_at IS NULL
                  """,
                arguments: [context.locationId, cookId]
            ).map { row -> SickWorkerGateRow in
                let action: String = row["action"] ?? ""
                let returnAt: String? = row["return_at"]
                return SickWorkerGateRow(action: action, returnAt: returnAt)
            }
            if SickWorkerCompute.cookHasActiveExclusion(sickRows) {
                throw LineCheckWriteError.sickExcluded(citation: SickWorkerCompute.exclusionCitation)
            }

            let unnoted = try Self.unnotedFails(
                db: db,
                shiftDate: context.shiftDate,
                stationId: station,
                locationId: context.locationId
            )
            if !unnoted.isEmpty {
                throw LineCheckWriteError.unnotedFails(items: unnoted)
            }

            let type = clip(signoffType, max: 32) ?? "self"
            try db.execute(
                sql: """
                  INSERT INTO station_signoffs (shift_date, station_id, cook_id, signoff_type, location_id)
                  VALUES (?, ?, ?, ?, ?)
                  """,
                arguments: [context.shiftDate, station, cookId, type, context.locationId]
            )
            let newId = db.lastInsertedRowID
            guard let row = try StationSignoffRow.fetchOne(
                db, sql: "SELECT * FROM station_signoffs WHERE id = ?", arguments: [newId]
            ) else {
                throw LineCheckWriteError.missingFields
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "station_signoffs",
                    entityId: newId,
                    action: .insert,
                    actorCookId: cookId,
                    actorSource: context.actorSource,
                    payload: ["station_id": station, "signoff_type": type],
                    shiftDate: context.shiftDate,
                    locationId: context.locationId
                )
            )
            return row
        }
    }

    private static func fetchLatestEntries(
        db: Database,
        shiftDate: String,
        stationId: String,
        locationId: String
    ) throws -> [String: LineCheckEntryRow] {
        let rows = try LineCheckEntryRow.fetchAll(
            db,
            sql: """
              SELECT * FROM line_check_entries
               WHERE id IN (
                 SELECT MAX(id) FROM line_check_entries
                  WHERE shift_date = ? AND station_id = ? AND location_id = ?
                  GROUP BY item
               )
              """,
            arguments: [shiftDate, stationId, locationId]
        )
        return Dictionary(rows.map { ($0.item, $0) }, uniquingKeysWith: { _, last in last })
    }

    private static func fetchSignoff(
        db: Database,
        shiftDate: String,
        stationId: String,
        locationId: String
    ) throws -> StationSignoffRow? {
        try StationSignoffRow.fetchOne(
            db,
            sql: """
              SELECT * FROM station_signoffs
               WHERE shift_date = ? AND station_id = ? AND location_id = ?
               ORDER BY id DESC LIMIT 1
              """,
            arguments: [shiftDate, stationId, locationId]
        )
    }

    private static func hasSignoff(
        db: Database,
        shiftDate: String,
        stationId: String,
        locationId: String
    ) throws -> Bool {
        try fetchSignoff(db: db, shiftDate: shiftDate, stationId: stationId, locationId: locationId) != nil
    }

    private static func unnotedFails(
        db: Database,
        shiftDate: String,
        stationId: String,
        locationId: String
    ) throws -> [String] {
        try String.fetchAll(
            db,
            sql: """
              SELECT item FROM line_check_entries AS l
               WHERE shift_date = ? AND station_id = ? AND location_id = ?
                 AND id = (
                   SELECT MAX(id) FROM line_check_entries
                    WHERE shift_date = l.shift_date
                      AND station_id = l.station_id
                      AND location_id = l.location_id
                      AND item = l.item
                 )
                 AND status = 'fail'
                 AND (note IS NULL OR TRIM(note) = '')
              """,
            arguments: [shiftDate, stationId, locationId]
        )
    }

    private static func computeProgress(
        template: [String],
        entries: [String: LineCheckEntryRow],
        signedOff: Bool
    ) -> StationProgress? {
        let statuses = template.compactMap { item -> LineCheckItemStatus? in
            guard let row = entries[item] else { return nil }
            return LineCheckItemStatus(item: item, status: row.status)
        }
        return StationProgressCompute.progress(
            templateItems: template,
            entries: statuses,
            signedOff: signedOff
        )
    }

    private static func itemState(from row: LineCheckEntryRow) -> LineCheckItemState {
        let status = LineCheckStatus(rawValue: row.status)
        let glove: Bool? = {
            guard let v = row.gloveChangeAttested else { return nil }
            return v != 0
        }()
        return LineCheckItemState(
            status: status,
            par: row.par ?? "",
            have: row.have ?? "",
            need: row.need ?? "",
            note: row.note ?? "",
            gloveChangeAttested: glove
        )
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
