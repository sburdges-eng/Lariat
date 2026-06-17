import Foundation
import GRDB

/// Temp-PIN scope checks — port of `hasPinOrTempPin` / `lib/tempPin.ts`.
public struct TempPinVerifier {
    public static let backDateScope = "haccp.back_date"

    public init() {}

    /// True when back-dated temp logs require PIN (mirrors `pinRequiredForDate` in temp-log route).
    public func pinRequiredForBackDate(
        shiftDate: String,
        env: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        guard let pin = env["LARIAT_PIN"], !pin.isEmpty else { return false }
        return shiftDate != ShiftDate.todayISO()
    }

    /// Master manager PIN **or** active `temp_pins` row with matching scope.
    public func hasPinOrScope(
        pin: String,
        scope: String,
        db: Database,
        locationId: String = LocationScope.resolve(),
        env: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> Bool {
        let verifier = PinVerifier()
        if (try? verifier.verify(pin: pin, db: db, locationId: locationId, env: env)) != nil {
            return true
        }
        if let fmt = PinHash.validateFormat(pin) {
            throw PinGateError.format(fmt)
        }
        let hash = PinHash.sha256Hex(pin)
        guard try db.tableExists("temp_pins") else { return false }
        let rows = try Row.fetchAll(
            db,
            sql: """
              SELECT scopes_json FROM temp_pins
               WHERE pin_hash = ?
                 AND revoked_at IS NULL
                 AND datetime(expires_at) > datetime('now')
              """,
            arguments: [hash]
        )
        for row in rows {
            let scopes = Self.parseScopes(row["scopes_json"])
            if Self.hasScope(scopes, scope) { return true }
        }
        return false
    }

    public static func parseScopes(_ json: String?) -> [String] {
        guard let json, let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              let array = value as? [Any] else { return [] }
        return array.compactMap { $0 as? String }
    }

    public static func hasScope(_ scopes: [String], _ scope: String) -> Bool {
        scopes.contains(scope)
    }
}
