import Foundation
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
