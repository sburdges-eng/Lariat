import Foundation
import GRDB
import LariatModel

/// Repository for wage notices — behavior parity with `app/api/wage-notices/route.js`
/// (A3 / L4, CO Wage Theft Transparency Act §8-4-103 + COMPS §3.3). Reads via the
/// read-only pool (GET is open); the regulated write (`sign`) goes through
/// `AuditedWriteRunner` so the `wage_notices` INSERT and its `audit_events` row
/// commit (or roll back) in ONE transaction.
///
/// The sign act IS the acknowledgement — there is no separate ack table. Bad
/// shape (bad reason/pay_basis, float/negative cents, tip-credit-on-non-tipped,
/// malformed signed_on) → `validationFailed` (web 400), thrown BEFORE the write.
///
/// Writes are tagged `actor_source = native_mac` (web uses `pic_ui`; the per-write
/// PIN gate is the native analog of the web `pic.wage_notices` scope).
public struct WageNoticeRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase

    public init(readDB: LariatDatabase, writeDB: LariatWriteDatabase) {
        self.readDB = readDB
        self.writeDB = writeDB
    }

    private struct AuditPayload: Encodable { let row: WageNoticeRow }

    // ── GET — latest-per-cook board + freshness ─────────────────────────

    public func loadBoard(
        today: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> WageNoticeBoardSnapshot {
        try await readDB.pool.read { db in
            // Latest notice per cook: newest signed_on, same-day tie → highest id.
            let rows = try WageNoticeRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM wage_notices AS w
                   WHERE location_id = ?
                     AND id = (
                       SELECT id FROM wage_notices AS w2
                        WHERE w2.location_id = w.location_id AND w2.cook_id = w.cook_id
                        ORDER BY signed_on DESC, id DESC LIMIT 1
                     )
                   ORDER BY cook_id ASC
                  """,
                arguments: [locationId]
            )
            return WageNoticeBoardSnapshot(
                latestPerCook: rows,
                freshness: WageNoticeCompute.summarizeFreshness(rows, today: today)
            )
        }
    }

    // ── GET — single-cook history + latest + freshness + refresh ────────

    public func loadHistory(
        cookId: String,
        today: String = ShiftDate.todayISO(),
        locationId: String = LocationScope.resolve()
    ) async throws -> WageNoticeHistory {
        try await readDB.pool.read { db in
            let history = try WageNoticeRow.fetchAll(
                db,
                sql: """
                  SELECT * FROM wage_notices
                   WHERE location_id = ? AND cook_id = ?
                   ORDER BY signed_on DESC, id DESC
                  """,
                arguments: [locationId, cookId]
            )
            let latest = history.first
            let freshness: NoticeFreshness
            if let latest {
                freshness = WageNoticeCompute.summarizeFreshness([latest], today: today).first
                    ?? NoticeFreshness(cookId: cookId, hasNotice: true, signedOn: latest.signedOn, daysSince: nil, needsNew: false)
            } else {
                // Ghost cook — no notice on file.
                freshness = NoticeFreshness(cookId: cookId, hasNotice: false, signedOn: nil, daysSince: nil, needsNew: true)
            }
            // Whether a fresh notice is due — a hypothetical annual `next` for the
            // refresh check (prev nil short-circuits to required at hire).
            let next = WageNoticeNext(
                reason: .annual,
                wageRateCents: latest?.wageRateCents ?? 0,
                payBasis: latest?.payBasis ?? .hourly,
                tipCreditCents: latest?.tipCreditCents,
                signedOn: today
            )
            let refresh = WageNoticeCompute.requiresNewNotice(prev: latest, next: next, today: today)
            return WageNoticeHistory(history: history, latest: latest, freshness: freshness, refreshRequired: refresh)
        }
    }

    // ── POST — sign a notice ────────────────────────────────────────────

    @discardableResult
    public func sign(input: WageNoticeSignInput, context: RegulatedWriteContext) throws -> WageNoticeRow {
        let cookId = clip(input.cookId, max: 64)
        let signedOn = clip(input.signedOn, max: 10)
        let documentPath = clip(input.documentPath, max: 300)

        let shape = WageNoticeCompute.validateNoticeShape(
            WageNoticeShape(
                reason: input.reason, payBasis: input.payBasis,
                wageRateCents: input.wageRateCents, tipCreditCents: input.tipCreditCents,
                signedOn: signedOn, documentPath: documentPath
            )
        )
        guard shape.ok else {
            throw WageNoticeWriteError.validationFailed(shape.reason ?? "invalid wage notice")
        }
        guard let cookId, !cookId.isEmpty else {
            throw WageNoticeWriteError.validationFailed("cook_id is required")
        }
        // Present after a successful shape validation.
        guard let reasonRaw = input.reason, let reason = WageNoticeReason(rawValue: reasonRaw),
              let payBasisRaw = input.payBasis, let payBasis = WageNoticePayBasis(rawValue: payBasisRaw),
              let wageRateCents = input.wageRateCents,
              let signedOnValue = signedOn else {
            throw WageNoticeWriteError.validationFailed("invalid wage notice")
        }
        let locationId = context.locationId

        return try AuditedWriteRunner.perform(db: writeDB) { db in
            try db.execute(
                sql: """
                  INSERT INTO wage_notices
                    (location_id, cook_id, reason, wage_rate_cents, pay_basis, tip_credit_cents, document_path, signed_on)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                arguments: [
                    locationId, cookId, reason.rawValue, wageRateCents, payBasis.rawValue,
                    input.tipCreditCents, documentPath, signedOnValue,
                ]
            )
            let newId = db.lastInsertedRowID
            guard let row = try WageNoticeRow.fetchOne(db, sql: "SELECT * FROM wage_notices WHERE id = ?", arguments: [newId]) else {
                throw WageNoticeWriteError.persistenceFailed
            }
            _ = try AuditEventWriter.post(
                db: db,
                input: AuditEventInput(
                    entity: "wage_notices",
                    entityId: newId,
                    action: .insert,
                    actorCookId: context.actorCookId,
                    actorSource: context.actorSource,
                    payloadJSON: AuditEventWriter.encodePayload(AuditPayload(row: row)),
                    note: "\(reason.rawValue):\(payBasis.rawValue)",
                    shiftDate: context.shiftDate,
                    locationId: locationId
                )
            )
            return row
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
