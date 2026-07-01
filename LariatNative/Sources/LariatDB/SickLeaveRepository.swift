import Foundation
import GRDB
import LariatModel

/// Repository for paid-sick-leave balances — behavior parity with
/// `app/api/sick-leave/route.js` (A3 / L2, HFWA). Reads via the read-only pool
/// (GET is open); regulated writes (accrual / use) go through `AuditedWriteRunner`
/// so the `paid_sick_leave_balances` mutation and its `audit_events` row commit
/// (or roll back) in ONE transaction.
///
/// Status semantics mirror the web route:
///   - bad shape (missing cook_id, out-of-range year, non-positive hours,
///     malformed dated_on) → validationFailed (web 400) — thrown BEFORE the
///     transaction opens.
///   - accrual clipped to <= 0 (cap reached / zero) → capReached (web 422),
///     thrown INSIDE the transaction BEFORE the audit write so the shell-insert
///     (on a first-ever entry) AND the audit roll back — no row-change, no audit.
///   - use exceeds available → notEnough (web 422), same rollback discipline.
///
/// Upsert is one transaction: SELECT `(location,cook,year)` → INSERT shell
/// `(0,0,cap 48,0)` with `action=insert` (else `action=update`) → run the pure
/// rule → success UPDATE + `last_accrued_on=dated_on` + audit. UNIQUE(location,
/// cook,year) backs the upsert.
///
/// **Front-load cap semantics:** an accrual given only `hours` (no `hours_worked`)
/// synthesizes `drivingHoursWorked = hours * 30` so the 48h annual cap still
/// binds the front-load; a `hours_worked` accrual uses the HFWA ratio directly.
///
/// Writes are tagged `actor_source = native_mac` (the web route uses `pic_ui`;
/// this is the established LariatNative divergence — the per-write PIN gate is the
/// native analog of the web `pic.sick_leave` scope, enforced at the view-model).
public struct SickLeaveRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    /// Audit payload shape — mirrors the web `{ kind, hours, row }`.
    private struct AuditPayload: Encodable {
        let kind: String
        let hours: Double
        let row: SickLeaveBalanceRow
    }

    // ── GET — single cook balance + recent events ──────────────────────
    //
    // Parity with the web GET `?cook_id=&year=`. Returns a summary (a
    // zero-balance default when the row is absent) plus up to 50 recent audit
    // events for that balance row (newest first), matching the route.

    public struct SingleBalance: Sendable, Equatable {
        public let balance: BalanceSummary
        public let events: [SickLeaveEvent]
        public init(balance: BalanceSummary, events: [SickLeaveEvent]) {
            self.balance = balance
            self.events = events
        }
    }

    public func loadBalance(
        cookId: String,
        accrualYear: Int,
        locationId: String = LocationScope.resolve()
    ) async throws -> SingleBalance {
        try await readDB.pool.read { db in
            let row = try SickLeaveBalanceRow.fetchOne(
                db,
                sql: """
                  SELECT * FROM paid_sick_leave_balances
                  WHERE location_id = ? AND cook_id = ? AND accrual_year = ?
                  """,
                arguments: [locationId, cookId, accrualYear]
            )
            let balance: BalanceSummary
            if let row {
                balance = SickLeaveCompute.summarizeBalance(SickLeaveState(row: row))
            } else {
                // Zero-balance default — parity with the route's absent-row shape.
                balance = BalanceSummary(
                    cookId: cookId, accrualYear: accrualYear, hoursAccrued: 0, hoursUsed: 0,
                    hoursAvailable: 0, capHours: SickLeaveCompute.hfwaAnnualCapHours,
                    carryoverHours: 0, atCap: false
                )
            }
            var events: [SickLeaveEvent] = []
            if let row {
                events = try SickLeaveEvent.fetchAll(
                    db,
                    sql: """
                      SELECT id, action, note, created_at
                      FROM audit_events
                      WHERE entity = 'paid_sick_leave_balances' AND entity_id = ?
                      ORDER BY id DESC
                      LIMIT 50
                      """,
                    arguments: [row.id]
                )
            }
            return SingleBalance(balance: balance, events: events)
        }
    }

    // ── GET — list balances for the location/year ──────────────────────
    //
    // Parity with the web GET `?year=` (no cook_id) — all balances for the
    // location + year, ordered `cook_id ASC`, each summarized.

    public func listBalances(
        accrualYear: Int,
        locationId: String = LocationScope.resolve()
    ) async throws -> [BalanceSummary] {
        try await readDB.pool.read { db in
            let rows = try SickLeaveBalanceRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM paid_sick_leave_balances
                  WHERE location_id = ? AND accrual_year = ?
                  ORDER BY cook_id ASC
                  """,
                arguments: [locationId, accrualYear]
            )
            return rows.map { SickLeaveCompute.summarizeBalance(SickLeaveState(row: $0)) }
        }
    }

    // ── POST — accrual ─────────────────────────────────────────────────

    @discardableResult
    public func accrue(input: SickLeaveAccrualInput, context: RegulatedWriteContext) throws -> SickLeaveWriteResult {
        let cookId = try validatedCookId(input.cookId)
        try validateYear(input.accrualYear)

        // `hours_worked` (if present) must be finite & >= 0 (web 400).
        if let hw = input.hoursWorked, !(hw.isFinite && hw >= 0) {
            throw SickLeaveWriteError.validationFailed("hours_worked must be a non-negative number")
        }

        // Accrual needs `hours > 0` OR a present `hours_worked` (web 400).
        let hoursRaw = input.hours
        let hoursValidPositive = (hoursRaw?.isFinite == true) && (hoursRaw ?? 0) > 0
        if input.hoursWorked == nil && !hoursValidPositive {
            throw SickLeaveWriteError.validationFailed("hours or hours_worked must be a positive number")
        }
        let hours = (hoursRaw?.isFinite == true) ? (hoursRaw ?? 0) : 0

        let note = clip(input.note, max: 300)
        let dateOf = try validatedDate(input.datedOn)
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let (row, action, entityId) = try upsertShell(db, locationId: locationId, cookId: cookId, accrualYear: input.accrualYear)

            // Front-load path: only `hours` given → synthesize the driving
            // hours-worked (× 30) so the 48h cap binds. Else use `hours_worked`.
            let drivingHoursWorked = input.hoursWorked ?? (hours * SickLeaveCompute.hfwaAccrualHoursWorkedPerHourEarned)
            let result = SickLeaveCompute.accrueHours(SickLeaveState(row: row), hoursWorked: drivingHoursWorked)
            let appliedHours = result.hoursAdded
            guard appliedHours > 0 else {
                // Cap reached / zero accrual → 422. Throw BEFORE the audit write
                // so the shell insert + everything rolls back (no row, no audit).
                throw SickLeaveWriteError.capReached(
                    reason: result.reason ?? "no accrual applied",
                    hoursUncapped: result.hoursUncapped
                )
            }
            let newAccrued = row.hoursAccrued + appliedHours
            try db.execute(
                sql: """
                  UPDATE paid_sick_leave_balances
                  SET hours_accrued = ?, last_accrued_on = ?, updated_at = datetime('now')
                  WHERE id = ?
                  """,
                arguments: [newAccrued, dateOf, entityId]
            )
            return try finalize(db, kind: .accrual, entityId: entityId, action: action, appliedHours: appliedHours, note: note, context: context, locationId: locationId)
        }
    }

    // ── POST — use ─────────────────────────────────────────────────────

    @discardableResult
    public func use(input: SickLeaveUseInput, context: RegulatedWriteContext) throws -> SickLeaveWriteResult {
        let cookId = try validatedCookId(input.cookId)
        try validateYear(input.accrualYear)

        // Use needs `hours > 0` (web 400).
        guard input.hours.isFinite && input.hours > 0 else {
            throw SickLeaveWriteError.validationFailed("hours must be a positive number")
        }
        let note = clip(input.note, max: 300)
        _ = try validatedDate(input.datedOn)  // validated for parity even though use doesn't set last_accrued_on
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            let (row, action, entityId) = try upsertShell(db, locationId: locationId, cookId: cookId, accrualYear: input.accrualYear)

            let result = SickLeaveCompute.useHours(SickLeaveState(row: row), hoursToUse: input.hours)
            guard result.ok else {
                // Insufficient balance → 422. Throw BEFORE the audit write so the
                // shell insert + everything rolls back (no row-change, no audit).
                throw SickLeaveWriteError.notEnough(
                    reason: result.reason ?? "not enough sick time",
                    hoursAvailable: result.newBalance
                )
            }
            let appliedHours = input.hours
            let newUsed = row.hoursUsed + appliedHours
            try db.execute(
                sql: """
                  UPDATE paid_sick_leave_balances
                  SET hours_used = ?, updated_at = datetime('now')
                  WHERE id = ?
                  """,
                arguments: [newUsed, entityId]
            )
            return try finalize(db, kind: .use, entityId: entityId, action: action, appliedHours: appliedHours, note: note, context: context, locationId: locationId)
        }
    }

    // ── upsert + finalize helpers ──────────────────────────────────────

    /// SELECT the balance row; if absent INSERT a shell `(0, 0, cap 48, 0)` and
    /// re-SELECT. Returns `(row, action, entityId)` where action is `.insert`
    /// (fresh shell) or `.update` (pre-existing). Mirrors the route's upsert.
    private func upsertShell(_ db: Database, locationId: String, cookId: String, accrualYear: Int) throws -> (SickLeaveBalanceRow, AuditEventAction, Int64) {
        if let existing = try SickLeaveBalanceRow.fetchOne(
            db,
            sql: "SELECT * FROM paid_sick_leave_balances WHERE location_id = ? AND cook_id = ? AND accrual_year = ?",
            arguments: [locationId, cookId, accrualYear]
        ) {
            return (existing, .update, existing.id)
        }
        try db.execute(
            sql: """
              INSERT INTO paid_sick_leave_balances
                (location_id, cook_id, accrual_year, hours_accrued, hours_used, cap_hours, carryover_hours)
              VALUES (?, ?, ?, 0, 0, ?, 0)
              """,
            arguments: [locationId, cookId, accrualYear, SickLeaveCompute.hfwaAnnualCapHours]
        )
        let newId = db.lastInsertedRowID
        guard let row = try SickLeaveBalanceRow.fetchOne(db, sql: "SELECT * FROM paid_sick_leave_balances WHERE id = ?", arguments: [newId]) else {
            throw SickLeaveWriteError.persistenceFailed
        }
        return (row, .insert, newId)
    }

    /// Re-SELECT the updated row, post the audit event (in-transaction), and build
    /// the write result. Note `"${kind}:${note}"` when a note is present, else
    /// `"${kind}"` — parity with the route.
    private func finalize(
        _ db: Database,
        kind: SickLeaveKind,
        entityId: Int64,
        action: AuditEventAction,
        appliedHours: Double,
        note: String?,
        context: RegulatedWriteContext,
        locationId: String
    ) throws -> SickLeaveWriteResult {
        guard let updated = try SickLeaveBalanceRow.fetchOne(db, sql: "SELECT * FROM paid_sick_leave_balances WHERE id = ?", arguments: [entityId]) else {
            throw SickLeaveWriteError.persistenceFailed
        }
        let payload = AuditPayload(kind: kind.rawValue, hours: appliedHours, row: updated)
        _ = try AuditEventWriter.post(
            db: db,
            input: AuditEventInput(
                entity: "paid_sick_leave_balances",
                entityId: entityId,
                action: action,
                actorCookId: context.actorCookId,
                actorSource: context.actorSource,
                payloadJSON: AuditEventWriter.encodePayload(payload),
                note: note != nil ? "\(kind.rawValue):\(note!)" : kind.rawValue,
                shiftDate: context.shiftDate,
                locationId: locationId
            )
        )
        return SickLeaveWriteResult(
            kind: kind,
            hoursApplied: appliedHours,
            balance: SickLeaveCompute.summarizeBalance(SickLeaveState(row: updated)),
            row: updated
        )
    }

    // ── validation helpers (parity with the route's 400 checks) ────────

    private func validatedCookId(_ raw: String) throws -> String {
        guard let cook = clip(raw, max: 64) else {
            throw SickLeaveWriteError.validationFailed("cook_id is required")
        }
        return cook
    }

    private func validateYear(_ year: Int) throws {
        guard year >= 2000 && year <= 2100 else {
            throw SickLeaveWriteError.validationFailed("accrual_year must be a 4-digit year")
        }
    }

    private func validatedDate(_ raw: String?) throws -> String? {
        guard let clipped = clip(raw, max: 10) else { return nil }
        guard isYMD(clipped) else {
            throw SickLeaveWriteError.validationFailed("dated_on must be YYYY-MM-DD")
        }
        return clipped
    }

    private func isYMD(_ s: String) -> Bool {
        // `^\d{4}-\d{2}-\d{2}$`
        let parts = s.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2 else { return false }
        return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
    }

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}
