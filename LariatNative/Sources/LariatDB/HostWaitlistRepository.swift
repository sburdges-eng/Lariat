import Foundation
import GRDB
import LariatModel

/// Host-stand waitlist repository — parity with `app/api/host/waitlist/
/// route.js` (GET/POST) and `app/api/host/waitlist/[id]/route.js` (PATCH).
///
/// Audit posture (web parity): operational data — writes log JSONL lines
/// via `FohAuditLogger` (the `lib/auditLog.mjs` file stream), NOT
/// `audit_events` rows. The web routes are PIN-gated end-to-end; natively
/// the VIEW MODEL gates writes via `ManagementWrite.requireSession` +
/// `PinEntrySheet` (reads stay open, per native precedent).
public struct HostWaitlistRepository: Sendable {
    private let readDB: LariatDatabase
    private let writeDB: LariatWriteDatabase
    private let auditLogger: FohAuditLogger

    public init(
        readDB: LariatDatabase,
        writeDB: LariatWriteDatabase,
        auditLogger: FohAuditLogger? = nil
    ) {
        self.readDB = readDB
        self.writeDB = writeDB
        self.auditLogger = auditLogger ?? FohAuditLogger(auditPath: resolveManagementAuditPath())
    }

    private static let projection = """
        SELECT id, location_id, party_name, party_size, joined_at, status,
               seated_at, left_at, phone, notes
          FROM waitlist_parties
        """

    /// GET /api/host/waitlist — active waiting parties + today's
    /// seated/left, chronological, plus the day rollup.
    public func load(
        locationId: String = LocationScope.resolve(),
        nowIso: String = HostWaitlistRepository.nowIso()
    ) async throws -> WaitlistSnapshot {
        let todayPrefix = String(nowIso.prefix(10))
        let parties = try await readDB.pool.read { db in
            try WaitlistPartyRow.fetchAll(
                db,
                sql: """
                  \(Self.projection)
                   WHERE location_id = ?
                     AND (status = 'waiting'
                          OR (status = 'seated' AND substr(seated_at, 1, 10) = ?)
                          OR (status = 'left'   AND substr(left_at,   1, 10) = ?))
                   ORDER BY joined_at
                  """,
                arguments: [locationId, todayPrefix, todayPrefix]
            )
        }
        let summary = HostStandCompute.summarizeWaitlist(parties, nowIso: nowIso)
        return WaitlistSnapshot(locationId: locationId, parties: parties, summary: summary)
    }

    /// POST /api/host/waitlist — add a waiting party. Returns the fresh row
    /// (web 201 body). JSONL audit `waitlist_add`.
    @discardableResult
    public func addParty(input: WaitlistAddInput, locationId: String = LocationScope.resolve()) throws -> WaitlistPartyRow {
        guard let clean = HostStandCompute.sanitizeWaitlistInput(
            partyName: input.partyName,
            partySize: input.partySize,
            phone: input.phone,
            notes: input.notes
        ) else {
            throw WaitlistWriteError.invalidInput
        }

        let id: Int64 = try writeDB.write { db in
            try db.execute(
                sql: """
                  INSERT INTO waitlist_parties (location_id, party_name, party_size, phone, notes)
                  VALUES (?, ?, ?, ?, ?)
                  """,
                arguments: [locationId, clean.partyName, clean.partySize, clean.phone, clean.notes]
            )
            return db.lastInsertedRowID
        }

        // Web logs inside its better-sqlite3 transaction, but the JSONL
        // stream is a non-transactional file append either way; a log
        // failure there would fail the request AFTER the commit machinery,
        // so post-commit append is behaviorally equivalent.
        try auditLogger.logWaitlistAdd(
            waitlistPartyId: id,
            locationId: locationId,
            partyName: clean.partyName,
            partySize: clean.partySize
        )

        guard let row = try fetchParty(id: id) else { throw WaitlistWriteError.notFound }
        return row
    }

    /// PATCH /api/host/waitlist/[id] — waiting → seated|left. Returns the
    /// fresh row. 400 on other targets, 404 unknown id, 409 on an illegal
    /// transition. JSONL audit `waitlist_status_change`.
    @discardableResult
    public func transition(
        id: Int64,
        to next: String,
        notes: String? = nil,
        nowIso: String = HostWaitlistRepository.nowIso()
    ) throws -> WaitlistPartyRow {
        guard next == "seated" || next == "left" else { throw WaitlistWriteError.badStatus }
        let cleanNotes = notes
            .map { String($0.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500)) }
            .flatMap { $0.isEmpty ? nil : $0 }

        let fromStatus: String
        let locationId: String
        (fromStatus, locationId) = try writeDB.write { db in
            guard let row = try Row.fetchOne(
                db,
                sql: "SELECT id, status, location_id FROM waitlist_parties WHERE id = ?",
                arguments: [id]
            ) else {
                throw WaitlistWriteError.notFound
            }
            let current: String = row["status"]
            guard HostStandCompute.isValidStatusTransition(current, next) else {
                throw WaitlistWriteError.badTransition(from: current, to: next)
            }
            let stampColumn = next == "seated" ? "seated_at" : "left_at"
            try db.execute(
                sql: """
                  UPDATE waitlist_parties
                     SET status = ?,
                         \(stampColumn) = ?,
                         notes = COALESCE(?, notes),
                         updated_at = ?
                   WHERE id = ?
                  """,
                arguments: [next, nowIso, cleanNotes, nowIso, id]
            )
            return (current, row["location_id"])
        }

        try auditLogger.logWaitlistStatusChange(
            waitlistPartyId: id,
            locationId: locationId,
            from: fromStatus,
            to: next
        )

        guard let row = try fetchParty(id: id) else { throw WaitlistWriteError.notFound }
        return row
    }

    private func fetchParty(id: Int64) throws -> WaitlistPartyRow? {
        try writeDB.pool.read { db in
            try WaitlistPartyRow.fetchOne(
                db,
                sql: "\(Self.projection) WHERE id = ?",
                arguments: [id]
            )
        }
    }

    /// The web routes stamp with `new Date().toISOString()`.
    public static func nowIso() -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date())
    }
}
