import Foundation
import GRDB

public enum PinGateError: Error, LocalizedError {
    case notConfigured
    case invalidPin
    case format(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured: return "PIN not set up"
        case .invalidPin: return "Wrong PIN"
        case .format(let msg): return msg
        }
    }
}

/// Verifies manager PIN against `manager_pin_users` or `LARIAT_PIN` env override.
public struct PinVerifier {
  public init() {}

  public func gateConfigured(env: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    if let pin = env["LARIAT_PIN"], !pin.isEmpty { return true }
    return false // DB check deferred to verify() when pool provided
  }

  public func gateConfigured(db: Database, locationId: String = LocationScope.resolve(), env: [String: String] = ProcessInfo.processInfo.environment) throws -> Bool {
    if let pin = env["LARIAT_PIN"], !pin.isEmpty { return true }
    guard try db.tableExists("manager_pin_users") else { return false }
    let count = try Int.fetchOne(db, sql: """
      SELECT COUNT(*) FROM manager_pin_users
       WHERE location_id = ? AND is_active = 1
    """, arguments: [locationId]) ?? 0
    return count > 0
  }

  public func verify(
    pin: String,
    db: Database,
    locationId: String = LocationScope.resolve(),
    env: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> ManagerPinUser {
    if let expected = env["LARIAT_PIN"], !expected.isEmpty {
      if constantTimeEqual(pin, expected) {
        return ManagerPinUser(id: 0, locationId: locationId, name: "Override", role: "owner")
      }
    }

    if let fmt = PinHash.validateFormat(pin) { throw PinGateError.format(fmt) }

    let hash = PinHash.sha256Hex(pin)
    if let row = try Row.fetchOne(db, sql: """
      SELECT id, location_id, name, role FROM manager_pin_users
       WHERE location_id = ? AND pin_hash = ? AND is_active = 1
       LIMIT 1
    """, arguments: [locationId, hash]) {
      return ManagerPinUser(
        id: row["id"],
        locationId: row["location_id"],
        name: row["name"],
        role: row["role"]
      )
    }

  if try gateConfigured(db: db, locationId: locationId, env: env) {
      throw PinGateError.invalidPin
    }
    throw PinGateError.notConfigured
  }

  private func constantTimeEqual(_ a: String, _ b: String) -> Bool {
    let da = Data(a.utf8), db = Data(b.utf8)
    let len = max(da.count, db.count)
    var diff = da.count ^ db.count
    for i in 0..<len {
      let x = i < da.count ? da[i] : 0
      let y = i < db.count ? db[i] : 0
      diff |= Int(x ^ y)
    }
    return diff == 0
  }
}
