import Foundation
import GRDB
import LariatModel

/// Repository for tip-pool distributions — behavior parity with
/// `app/api/tip-pool/route.js` (A3 / L3, COMPS #39 §3.3/§3.4 + FLSA). Reads via
/// the read-only pool (GET is open); the regulated write (`add`) goes through
/// `AuditedWriteRunner` so the `tip_pool_distributions` INSERT and its
/// `audit_events` row commit (or roll back) in ONE transaction.
///
/// Status semantics mirror the web route:
///   - bad shape (malformed shift_date, missing pool_ref/cook_id, unknown kind,
///     negative amount) → `validationFailed` (web 400/422) — thrown BEFORE the
///     transaction opens, so nothing is written.
///   - a `tip_pool` line for an ineligible cook (active manager/owner/exempt flag
///     or excluded role) → `poolIneligible` (web 422) — thrown INSIDE the
///     transaction BEFORE the INSERT so no row + no audit survive. The eligibility
///     gate ONLY applies to `kind == .tip_pool`; `service_charge`/`direct_tip`
///     flow to managers legally and are never gated.
///
/// Writes are tagged `actor_source = native_mac` (the web route uses `pic_ui`;
/// this is the established LariatNative divergence — the per-write PIN gate is the
/// native analog of the web `pic.tip_pool` scope, enforced at the view-model).
public struct TipPoolRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    // ── GET — daily / range rows + pool summary + comps ─────────────────
    //
    // Parity with the web GET `?date=&date_end=&pool_ref=`. A single-day query
    // (no `date_end`) orders `id ASC`; a range query orders `shift_date ASC,
    // id ASC`. An optional `pool_ref` filters. Returns the rows, the
    // `summarizePool` aggregate, and the active COMPS comp-period config.

    public struct DailyPool: Sendable, Equatable {
        public let rows: [TipDistributionRow]
        public let summary: PoolSummary
        public let comps: CompsConfig
        public init(rows: [TipDistributionRow], summary: PoolSummary, comps: CompsConfig) {
            self.rows = rows
            self.summary = summary
            self.comps = comps
        }
    }

    /// The active comp-period config handed back so the UI renders the tip-credit
    /// math without hard-coding numbers — parity with the route's `comps` block.
    public struct CompsConfig: Sendable, Equatable {
        public let stdMinWageCents: Int
        public let tippedMinWageCents: Int
        public let tipCreditCents: Int
        public init(stdMinWageCents: Int, tippedMinWageCents: Int, tipCreditCents: Int) {
            self.stdMinWageCents = stdMinWageCents
            self.tippedMinWageCents = tippedMinWageCents
            self.tipCreditCents = tipCreditCents
        }
        public static let compsDefault = CompsConfig(
            stdMinWageCents: TipPoolCompute.stdMinWageCents2026,
            tippedMinWageCents: TipPoolCompute.tippedMinWageCents2026,
            tipCreditCents: TipPoolCompute.tipCreditCents2026
        )
    }

    public func loadPool(
        date: String,
        dateEnd: String? = nil,
        poolRef: String? = nil,
        locationId: String = LocationScope.resolve()
    ) async throws -> DailyPool {
        try await readDB.pool.read { db in
            var sql = "SELECT * FROM tip_pool_distributions WHERE location_id = ? AND shift_date >= ?"
            var args: [DatabaseValueConvertible] = [locationId, date]
            let end = dateEnd ?? date
            sql += " AND shift_date <= ?"
            args.append(end)
            if let poolRef, !poolRef.isEmpty {
                sql += " AND pool_ref = ?"
                args.append(poolRef)
            }
            // Single-day query orders id ASC; a range orders by shift_date then id.
            if dateEnd == nil {
                sql += " ORDER BY id ASC"
            } else {
                sql += " ORDER BY shift_date ASC, id ASC"
            }
            let rows = try TipDistributionRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
            return DailyPool(
                rows: rows,
                summary: TipPoolCompute.summarizePool(rows),
                comps: .compsDefault
            )
        }
    }

    // ── POST — add a distribution line ──────────────────────────────────

    /// Audit payload shape — the full inserted row snapshot (parity with the
    /// route's `payload: row`).
    private struct AuditPayload: Encodable {
        let row: TipDistributionRow
    }

    @discardableResult
    public func add(input: TipDistributionInput, context: RegulatedWriteContext) throws -> TipPoolWriteResult {
        // Clip text fields (parity with the route's `clip`): trim → null-if-empty
        // → prefix. shift_date defaults to today when absent.
        let shiftDate = clip(input.shiftDate, max: 32) ?? ShiftDate.todayISO()
        let poolRef = clip(input.poolRef, max: 120)
        let cookId = clip(input.cookId, max: 64)
        let role = clip(input.role, max: 64)
        let kind = clip(input.kind, max: 32)
        let note = clip(input.note, max: 300)
        let locationId = context.locationId

        // Shape validation (web 400/422). Thrown BEFORE the transaction.
        let shape = TipPoolCompute.validateDistributionShape(
            DistributionShape(
                shiftDate: shiftDate, poolRef: poolRef, cookId: cookId,
                role: role, kind: kind, amountCents: input.amountCents, note: note
            )
        )
        guard shape.ok else {
            throw TipPoolWriteError.validationFailed(shape.reason ?? "invalid tip-pool line")
        }
        // After a successful shape validation these are all present + non-empty.
        guard let poolRefValue = poolRef,
              let cookIdValue = cookId,
              let kindRaw = kind,
              let kindValue = TipKind(rawValue: kindRaw) else {
            throw TipPoolWriteError.validationFailed("invalid tip-pool line")
        }

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            // COMPS §3.4 eligibility: ONLY gate a `tip_pool` line. Managers/owners
            // may legally receive `service_charge`/`direct_tip`, so those skip the
            // gate. Thrown BEFORE the INSERT so no row + no audit survive.
            if kindValue == .tip_pool {
                let flags = try StaffFlag.fetchActive(db, locationId: locationId, cookId: cookIdValue)
                if !TipPoolCompute.isPoolEligible(flags, role: role) {
                    throw TipPoolWriteError.poolIneligible(citation: "7 CCR 1103-1 §3.4")
                }
            }

            try db.execute(
                sql: """
                  INSERT INTO tip_pool_distributions
                    (shift_date, location_id, pool_ref, cook_id, role, kind, amount_cents, note)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [shiftDate, locationId, poolRefValue, cookIdValue, role, kindValue.rawValue, input.amountCents, note]
            )
            let newId = db.lastInsertedRowID
            guard let row = try TipDistributionRow.fetchOne(db, sql: "SELECT * FROM tip_pool_distributions WHERE id = ?", arguments: [newId]) else {
                throw TipPoolWriteError.persistenceFailed
            }

            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "tip_pool_distributions",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(AuditPayload(row: row)),
                    note: note,
                    shiftDate: shiftDate,
                    locationId: locationId
                )
            )
            return TipPoolWriteResult(entry: row)
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    private func clip(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }
}

// ── active staff_flags fetch (mirrors the route's SELECT) ──────────────

private extension StaffFlag {
    /// Active flags for the cook (`effective_to IS NULL`) at the location — the
    /// same filter the web route applies before `isPoolEligible`.
    static func fetchActive(_ db: Database, locationId: String, cookId: String) throws -> [StaffFlag] {
        let rows = try Row.fetchAll(
            db,
            sql: """
              SELECT cook_id, flag, effective_to
                FROM staff_flags
               WHERE location_id = ? AND cook_id = ? AND effective_to IS NULL
              """,
            arguments: [locationId, cookId]
        )
        return rows.map {
            StaffFlag(cookId: $0["cook_id"], flag: $0["flag"], effectiveTo: $0["effective_to"])
        }
    }
}
