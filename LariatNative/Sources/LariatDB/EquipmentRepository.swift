import Foundation
import GRDB
import LariatModel

/// Repository for the /equipment board (A6.2) — behavior parity with
/// `app/api/equipment/{,maintenance/,parts/,schedule/}route.ts`.
///
/// AUDIT POSTURE — web parity: the four equipment routes post NO
/// `audit_events` for their writes (plain INSERTs, no `postAuditEvent`);
/// the native writes are single transactional INSERTs that mirror that —
/// pinned by EquipmentRepositoryTests (DishComponents precedent). No PIN
/// (`/equipment` is not in middleware SENSITIVE_PREFIXES); no idempotency.
/// Typed `EquipmentWriteError`s (the routes' 400 contracts) throw BEFORE
/// any write. Money columns are REAL → `Double` dollars.
public struct EquipmentRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    // Route clip caps (route.ts MAX_NAME/MAX_TEXT/MAX_NOTES; maintenance
    // route MAX_NOTE/MAX_REF).
    private static let maxName = 200
    private static let maxText = 500
    private static let maxNotes = 2000
    private static let maxMaintNote = 1000

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET /api/equipment ──────────────────────────────────────────────

    public func listEquipment(
        locationId: String = LocationScope.resolve()
    ) async throws -> [EquipmentRow] {
        try await readDB.pool.read { db in
            try EquipmentRow.fetchAll(
                db,
                sql: """
                  SELECT e.*,
                         COALESCE((SELECT SUM(cost) FROM equipment_maintenance m
                                    WHERE m.equipment_id = e.id), 0) AS maintenance_cost
                    FROM equipment e
                   WHERE e.location_id = ?
                   ORDER BY e.category, e.name
                  """,
                arguments: [locationId]
            )
        }
    }

    // ── GET /api/equipment/maintenance ──────────────────────────────────

    public func listMaintenance(
        equipmentId: Int64? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [EquipmentMaintenanceRow] {
        try await readDB.pool.read { db in
            var sql = "SELECT * FROM equipment_maintenance WHERE location_id = ?"
            var args: [DatabaseValueConvertible] = [locationId]
            if let equipmentId {
                sql += " AND equipment_id = ?"
                args.append(equipmentId)
            }
            sql += " ORDER BY service_date DESC, id DESC"
            return try EquipmentMaintenanceRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    // ── GET /api/equipment/parts ────────────────────────────────────────

    public func listParts(
        equipmentId: Int64? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [EquipmentPartRow] {
        try await readDB.pool.read { db in
            var sql = "SELECT * FROM equipment_parts WHERE location_id = ?"
            var args: [DatabaseValueConvertible] = [locationId]
            if let equipmentId {
                sql += " AND equipment_id = ?"
                args.append(equipmentId)
            }
            sql += " ORDER BY equipment_id, part_number"
            return try EquipmentPartRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    // ── GET /api/equipment/schedule ─────────────────────────────────────

    public func listSchedule(
        equipmentId: Int64? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> [EquipmentScheduleRow] {
        try await readDB.pool.read { db in
            var sql = "SELECT * FROM equipment_maintenance_schedule WHERE location_id = ?"
            var args: [DatabaseValueConvertible] = [locationId]
            if let equipmentId {
                sql += " AND equipment_id = ?"
                args.append(equipmentId)
            }
            sql += " ORDER BY equipment_id, COALESCE(next_due, '9999-12-31')"
            return try EquipmentScheduleRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
        }
    }

    // ── POST /api/equipment ─────────────────────────────────────────────

    @discardableResult
    public func addEquipment(input: EquipmentAddInput, context: RegulatedWriteContext) throws -> Int64 {
        guard let name = clip(input.name, max: Self.maxName) else {
            throw EquipmentWriteError.nameRequired
        }
        let locationId = context.locationId
        return try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO equipment (
                    name, category, make_model, model_number, serial_number,
                    purchase_date, warranty_expiration, purchase_cost,
                    vendor, vendor_order_ref, manual_path, notes,
                    status, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    name,
                    clip(input.category, max: 60) ?? "Uncategorized",
                    clip(input.makeModel, max: Self.maxText),
                    clip(input.modelNumber, max: Self.maxText),
                    clip(input.serialNumber, max: Self.maxText),
                    clip(input.purchaseDate, max: 32),
                    clip(input.warrantyExpiration, max: 32),
                    finite(input.purchaseCost),
                    clip(input.vendor, max: Self.maxText),
                    clip(input.vendorOrderRef, max: Self.maxText),
                    clip(input.manualPath, max: Self.maxText),
                    clip(input.notes, max: Self.maxNotes),
                    clip(input.status, max: 32) ?? "active",
                    locationId,
                ]
            )
            return db.lastInsertedRowID
            // NO AuditEventWriter.post — web-route parity (no audit_events).
        }
    }

    // ── POST /api/equipment/maintenance ─────────────────────────────────

    @discardableResult
    public func addMaintenance(input: EquipmentMaintenanceAddInput, context: RegulatedWriteContext) throws -> Int64 {
        guard let equipmentId = input.equipmentId, equipmentId > 0 else {
            throw EquipmentWriteError.equipmentIdRequired
        }
        guard let serviceDate = clip(input.serviceDate, max: 32) else {
            throw EquipmentWriteError.serviceDateRequired
        }
        let locationId = context.locationId
        return try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO equipment_maintenance
                    (equipment_id, service_date, type, cost, notes, receipt_reference, cook_id, location_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    equipmentId,
                    serviceDate,
                    clip(input.type, max: 32) ?? "Routine",
                    finite(input.cost),
                    clip(input.notes, max: Self.maxMaintNote),
                    clip(input.receiptReference, max: Self.maxText),
                    clip(input.cookId, max: 64),
                    locationId,
                ]
            )
            return db.lastInsertedRowID
        }
    }

    // ── POST /api/equipment/parts ───────────────────────────────────────

    @discardableResult
    public func addPart(input: EquipmentPartAddInput, context: RegulatedWriteContext) throws -> Int64 {
        guard let equipmentId = input.equipmentId, equipmentId > 0 else {
            throw EquipmentWriteError.equipmentIdRequired
        }
        guard let partNumber = clip(input.partNumber, max: Self.maxText) else {
            throw EquipmentWriteError.partNumberRequired
        }
        let locationId = context.locationId
        return try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO equipment_parts (
                    equipment_id, part_number, description, vendor, unit_price,
                    qty_on_hand, last_ordered, last_order_ref, notes, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    equipmentId,
                    partNumber,
                    clip(input.description, max: Self.maxText),
                    clip(input.vendor, max: Self.maxText),
                    finite(input.unitPrice),
                    finite(input.qtyOnHand),
                    clip(input.lastOrdered, max: 32),
                    clip(input.lastOrderRef, max: Self.maxText),
                    clip(input.notes, max: Self.maxNotes),
                    locationId,
                ]
            )
            return db.lastInsertedRowID
        }
    }

    // ── POST /api/equipment/schedule ────────────────────────────────────

    @discardableResult
    public func addSchedule(input: EquipmentScheduleAddInput, context: RegulatedWriteContext) throws -> Int64 {
        guard let equipmentId = input.equipmentId, equipmentId > 0 else {
            throw EquipmentWriteError.equipmentIdRequired
        }
        guard let task = clip(input.task, max: Self.maxText) else {
            throw EquipmentWriteError.taskRequired
        }
        guard let frequency = clip(input.frequency, max: 60) else {
            throw EquipmentWriteError.frequencyRequired
        }
        let locationId = context.locationId
        return try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO equipment_maintenance_schedule (
                    equipment_id, task, frequency, last_done, next_due, notes, location_id
                  ) VALUES (?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    equipmentId,
                    task,
                    frequency,
                    clip(input.lastDone, max: 32),
                    clip(input.nextDue, max: 32),
                    clip(input.notes, max: Self.maxNotes),
                    locationId,
                ]
            )
            return db.lastInsertedRowID
        }
    }

    // ── helpers (route `clip` / `toMoney`-`toNum` parity) ───────────────

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// `toMoney`/`toNum` parity: only finite numbers persist.
    private func finite(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }
}
