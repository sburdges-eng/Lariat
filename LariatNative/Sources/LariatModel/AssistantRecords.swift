import Foundation

// Phase B — kitchen assistant records. Parity sources:
//   app/api/kitchen-assistant/route.js (limits, response envelope)
//   lib/lariConversationMemory.ts (stored turn)
//   lib/kitchenAssistantUndo.ts (undo meta)
//   lib/kitchenAssistantContext.ts (ContextSource)

/// Route-level input limits — `app/api/kitchen-assistant/route.js` L54-56.
public enum AssistantLimits {
    public static let maxMessage = 2000
    public static let maxItem = 300
    public static let maxNote = 500
}

/// One grounded-context provenance row (`ContextSource` in kitchenAssistantContext.ts).
public struct AssistantContextSource: Sendable, Equatable, Codable {
    public let type: String
    public let detail: String

    public init(type: String, detail: String) {
        self.type = type
        self.detail = detail
    }
}

/// `buildGroundedContext` result.
public struct AssistantGroundedContext: Sendable, Equatable {
    public let contextText: String
    public let sources: [AssistantContextSource]

    public init(contextText: String, sources: [AssistantContextSource]) {
        self.contextText = contextText
        self.sources = sources
    }
}

/// Stored conversation turn — `StoredConversationTurn` in lariConversationMemory.ts.
public struct StoredConversationTurn: Sendable, Equatable, Codable {
    public let id: Int64
    public let userContent: String
    public let assistantContent: String
    public let managerTier: Int
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case userContent = "user_content"
        case assistantContent = "assistant_content"
        case managerTier = "manager_tier"
        case createdAt = "created_at"
    }

    public init(id: Int64, userContent: String, assistantContent: String, managerTier: Int, createdAt: String) {
        self.id = id
        self.userContent = userContent
        self.assistantContent = assistantContent
        self.managerTier = managerTier
        self.createdAt = createdAt
    }
}

/// Undo metadata riding in the assistant response — `KitchenAssistantUndoMeta`.
public struct KitchenAssistantUndoMeta: Sendable, Equatable, Codable {
    public let auditEventId: Int64
    public let entity: KitchenAssistantUndoableEntity
    public let entityId: Int64
    public let expiresAt: String
    public let label: String

    enum CodingKeys: String, CodingKey {
        case auditEventId = "audit_event_id"
        case entity
        case entityId = "entity_id"
        case expiresAt = "expires_at"
        case label
    }

    public init(auditEventId: Int64, entity: KitchenAssistantUndoableEntity, entityId: Int64, expiresAt: String, label: String) {
        self.auditEventId = auditEventId
        self.entity = entity
        self.entityId = entityId
        self.expiresAt = expiresAt
        self.label = label
    }
}

/// Entities the 30-second undo supports — `UndoableEntity` in kitchenAssistantUndo.ts.
public enum KitchenAssistantUndoableEntity: String, Sendable, Codable, CaseIterable {
    case eightySix = "eighty_six"
    case inventoryUpdates = "inventory_updates"
    case lineCheckEntries = "line_check_entries"
    case equipmentMaintenance = "equipment_maintenance"
    case orderGuideItems = "order_guide_items"
    case goldStars = "gold_stars"

    /// `UNDOABLE_CONFIG[entity].mode` parity.
    public enum Mode: Sendable, Equatable {
        case resolveEightySix
        case deleteRow
    }

    public var mode: Mode {
        self == .eightySix ? .resolveEightySix : .deleteRow
    }

    /// `UNDOABLE_CONFIG[entity].table` parity (1:1 with rawValue on the web too).
    public var table: String { rawValue }
}

/// Full response envelope of POST /api/kitchen-assistant (success path).
public struct AssistantResponse: Sendable, Equatable {
    public let answer: String
    public let model: String
    public let locationId: String
    public let sources: [AssistantContextSource]
    public let latencyMs: Int
    public let actionExecuted: Bool
    public let actionError: Bool
    public let undo: KitchenAssistantUndoMeta?
    public let disclaimer: String

    public static let disclaimerText = "Check tags with a manager. Do not trust AI for allergies."

    public init(
        answer: String,
        model: String,
        locationId: String,
        sources: [AssistantContextSource],
        latencyMs: Int,
        actionExecuted: Bool,
        actionError: Bool,
        undo: KitchenAssistantUndoMeta?,
        disclaimer: String = AssistantResponse.disclaimerText
    ) {
        self.answer = answer
        self.model = model
        self.locationId = locationId
        self.sources = sources
        self.latencyMs = latencyMs
        self.actionExecuted = actionExecuted
        self.actionError = actionError
        self.undo = undo
        self.disclaimer = disclaimer
    }
}

// ── LLM-supplied JSON (UNTRUSTED) ─────────────────────────────────────

/// A parsed JSON value from the LLM's action block. LLM input is UNTRUSTED:
/// accessors below reproduce the web route's exact coercion/validation
/// semantics — nothing else in the codebase should coerce these implicitly.
public indirect enum AssistantJSONValue: Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([AssistantJSONValue])
    case object([String: AssistantJSONValue])

    public static func from(any value: Any) -> AssistantJSONValue {
        switch value {
        case let s as String: return .string(s)
        case let n as NSNumber:
            // NSNumber bridges JSON bools too — CFBoolean is the reliable discriminator.
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        case let a as [Any]: return .array(a.map(AssistantJSONValue.from(any:)))
        case let o as [String: Any]: return .object(o.mapValues(AssistantJSONValue.from(any:)))
        case is NSNull: return .null
        default: return .null
        }
    }

    /// JS `typeof x === 'string' ? …clip… : null` — only true strings clip.
    /// Mirrors route.js `clip(s, max)`: trim, empty → nil, else slice(0, max).
    public func clip(_ max: Int) -> String? {
        guard case .string(let s) = self else { return nil }
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(max))
    }

    /// JS truthiness (`if (payload.item)`).
    public var isTruthy: Bool {
        switch self {
        case .string(let s): return !s.isEmpty
        case .number(let n): return n != 0 && !n.isNaN
        case .bool(let b): return b
        case .null: return false
        case .array, .object: return true
        }
    }

    /// JS `Number(x)` coercion. `.nan` where JS yields NaN.
    public var jsNumber: Double {
        switch self {
        case .number(let n): return n
        case .bool(let b): return b ? 1 : 0
        case .null: return 0
        case .string(let s):
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.isEmpty { return 0 }
            return Double(t) ?? .nan
        case .array(let a):
            // JS: Number([]) = 0, Number([x]) = Number(x), else NaN.
            if a.isEmpty { return 0 }
            if a.count == 1 { return a[0].jsNumber }
            return .nan
        case .object: return .nan
        }
    }

    /// `typeof x === 'number' && Number.isFinite(x)` — the line_check reading gate.
    public var strictFiniteNumber: Double? {
        guard case .number(let n) = self, n.isFinite else { return nil }
        return n
    }

    public var stringValue: String? {
        guard case .string(let s) = self else { return nil }
        return s
    }

    public var boolValue: Bool? {
        guard case .bool(let b) = self else { return nil }
        return b
    }

    public var arrayValue: [AssistantJSONValue]? {
        guard case .array(let a) = self else { return nil }
        return a
    }

    public var objectValue: [String: AssistantJSONValue]? {
        guard case .object(let o) = self else { return nil }
        return o
    }
}

/// The extracted `{ "action": "...", ... }` payload.
public struct AssistantActionPayload: Sendable, Equatable {
    public let action: String
    public let fields: [String: AssistantJSONValue]

    public init(action: String, fields: [String: AssistantJSONValue]) {
        self.action = action
        self.fields = fields
    }

    /// Missing key ⇒ JS `undefined` (distinct from JSON null).
    public subscript(key: String) -> AssistantJSONValue? {
        fields[key]
    }

    /// JS `Number(payload.k)` where a missing key is `undefined` → NaN.
    public func jsNumber(_ key: String) -> Double {
        fields[key]?.jsNumber ?? .nan
    }

    public func clip(_ key: String, _ max: Int) -> String? {
        fields[key]?.clip(max)
    }

    public func isTruthy(_ key: String) -> Bool {
        fields[key]?.isTruthy ?? false
    }
}
