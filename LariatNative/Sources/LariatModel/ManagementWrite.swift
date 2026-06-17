import Foundation
import GRDB

public enum ManagementWriteError: Error, LocalizedError {
    case pinRequired

    public var errorDescription: String? {
        switch self {
        case .pinRequired: return "PIN required"
        }
    }
}

/// Bundles PIN session check before a management-side mutation.
public struct ManagementWrite {
    public init() {}

    public func requireSession(_ session: PinSession?) throws -> ManagerPinUser {
        guard let session, session.isValid else { throw ManagementWriteError.pinRequired }
        return session.user
    }
}

public struct PinSession: Codable, Sendable, Equatable {
    public let user: ManagerPinUser
    public let expiresAt: Date

    public init(user: ManagerPinUser, expiresAt: Date) {
        self.user = user
        self.expiresAt = expiresAt
    }

    public var isValid: Bool { Date() < expiresAt }

    public static func fresh(user: ManagerPinUser, ttl: TimeInterval = 8 * 3600) -> PinSession {
        PinSession(user: user, expiresAt: Date().addingTimeInterval(ttl))
    }
}
