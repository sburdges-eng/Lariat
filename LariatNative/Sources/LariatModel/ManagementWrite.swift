import Foundation
import GRDB

public enum ManagementWriteError: Error, LocalizedError, Equatable {
    /// A PIN is configured and none is active — a PIN sheet can satisfy this.
    case pinRequired
    /// No manager PIN exists on this install, so there is nothing to prompt
    /// for and no one to attribute the write to. Callers must refuse rather
    /// than raise a PIN sheet nothing can satisfy.
    case noPinConfigured

    public var errorDescription: String? {
        switch self {
        case .pinRequired: return "PIN required"
        case .noPinConfigured:
            return "No manager PIN is set. Add one on the Manager → PINs board before saving this."
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

    /// Actor for a management write, given the deployment's gate state.
    ///
    /// Write-side twin of `RegulatedReadGate.evaluate`, and deliberately the
    /// same shape: a valid session is authority whatever the gate table
    /// currently says (the credential was checked when it was issued), and
    /// nothing else attributes a write. An install with no PIN configured used
    /// to hand back a nil actor — the write landed with an audit row naming no
    /// one, which is worse than a refused write. It refuses now, and does so
    /// with a distinct error so the caller knows a PIN sheet cannot help.
    public func requireActor(gateConfigured: Bool, session: PinSession?) throws -> ManagerPinUser {
        if let session, session.isValid { return session.user }
        guard gateConfigured else { throw ManagementWriteError.noPinConfigured }
        throw ManagementWriteError.pinRequired
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
