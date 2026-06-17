import Foundation

/// Mirrors `AuditEvent['action']` in `lib/db.ts`.
public enum AuditEventAction: String, Sendable, Codable {
    case insert
    case update
    case delete
    case correction
    case view
}

/// Input for one append-only `audit_events` row — parity with `AuditEventInput` in `lib/auditEvents.ts`.
public struct AuditEventInput: Sendable {
    public let entity: String
    public let entityId: Int64?
    public let action: AuditEventAction
    public let actorCookId: String?
    public let actorSource: String
    public let replacesId: Int64?
    public let payload: [String: String]?
    public let note: String?
    public let shiftDate: String?
    public let locationId: String?

    public init(
        entity: String,
        entityId: Int64?,
        action: AuditEventAction,
        actorCookId: String? = nil,
        actorSource: String,
        replacesId: Int64? = nil,
        payload: [String: String]? = nil,
        note: String? = nil,
        shiftDate: String? = nil,
        locationId: String? = nil
    ) {
        self.entity = entity
        self.entityId = entityId
        self.action = action
        self.actorCookId = actorCookId
        self.actorSource = actorSource
        self.replacesId = replacesId
        self.payload = payload
        self.note = note
        self.shiftDate = shiftDate
        self.locationId = locationId
    }
}

/// Actor + shift metadata for regulated native writes (`actor_source = native_mac`).
public struct RegulatedWriteContext: Sendable {
    public static let nativeMacActorSource = "native_mac"

    public let actorCookId: String?
    public let actorSource: String
    public let locationId: String
    public let shiftDate: String

    public init(actorCookId: String?, actorSource: String, locationId: String, shiftDate: String) {
        self.actorCookId = actorCookId
        self.actorSource = actorSource
        self.locationId = locationId
        self.shiftDate = shiftDate
    }

    public static func nativeMac(pinUser: ManagerPinUser?) -> RegulatedWriteContext {
        RegulatedWriteContext(
            actorCookId: pinUser.map { String($0.id) },
            actorSource: nativeMacActorSource,
            locationId: pinUser?.locationId ?? "default",
            shiftDate: ShiftDate.todayISO()
        )
    }
}
