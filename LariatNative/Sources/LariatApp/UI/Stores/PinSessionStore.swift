import Foundation
import GRDB
import LariatModel
import Observation

@Observable @MainActor
public final class PinSessionStore {
    public static let shared = PinSessionStore()
    private let defaultsKey = "lariat.manager.pin.session"
    public private(set) var session: PinSession?

    public init() {
        load()
    }

    public func save(user: ManagerPinUser) {
        session = PinSession.fresh(user: user)
        persist()
    }

    public func clear() {
        session = nil
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    /// Re-check DB-backed users on each write — session blob alone is not trusted.
    public func validateActiveUser(db: Database) throws {
        guard let session, session.isValid else {
            throw ManagementWriteError.pinRequired
        }
        if session.user.id == 0 { return }
        guard try db.tableExists("manager_pin_users") else {
            clear()
            throw PinGateError.invalidPin
        }
        let active: Int = try Int.fetchOne(
            db,
            sql: "SELECT is_active FROM manager_pin_users WHERE id = ?",
            arguments: [session.user.id]
        ) ?? 0
        guard active == 1 else {
            clear()
            throw PinGateError.invalidPin
        }
    }

    public var activeUser: ManagerPinUser? {
        guard let session, session.isValid else { return nil }
        return session.user
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode(PinSession.self, from: data),
              decoded.isValid else {
            session = nil
            return
        }
        session = decoded
    }

    private func persist() {
        guard let session, let data = try? JSONEncoder().encode(session) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }
}
