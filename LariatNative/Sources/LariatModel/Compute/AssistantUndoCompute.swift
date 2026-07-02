import Foundation

/// Pure half of `lib/kitchenAssistantUndo.ts` — undo-meta construction and
/// timestamp normalization. The transactional undo executor lives in
/// LariatDB.AssistantUndoRepository.
public enum AssistantUndoCompute {
    /// `KITCHEN_ASSISTANT_UNDO_WINDOW_MS`
    public static let undoWindowMs: Double = 30_000

    /// `isKitchenAssistantUndoableEntity(entity)`
    public static func undoableEntity(_ entity: String?) -> KitchenAssistantUndoableEntity? {
        guard let entity else { return nil }
        return KitchenAssistantUndoableEntity(rawValue: entity)
    }

    /// `buildKitchenAssistantUndoMeta(input)` — nil unless every field is valid.
    public static func buildUndoMeta(
        auditEventId: Int64?,
        entity: String?,
        entityId: Int64?,
        label: String?,
        createdAt: String? = nil,
        now: Date = Date()
    ) -> KitchenAssistantUndoMeta? {
        guard let auditEventId, let undoable = undoableEntity(entity) else { return nil }
        guard let entityId, entityId > 0 else { return nil }
        let trimmedLabel = (label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty else { return nil }
        let baseMs: Double
        if let createdAt {
            baseMs = normalizeTimestampMs(createdAt)
            guard baseMs.isFinite else { return nil }
        } else {
            baseMs = now.timeIntervalSince1970 * 1000
        }
        let expires = Date(timeIntervalSince1970: (baseMs + undoWindowMs) / 1000)
        return KitchenAssistantUndoMeta(
            auditEventId: auditEventId,
            entity: undoable,
            entityId: entityId,
            expiresAt: LariConversationMemoryCompute.isoString(expires),
            label: trimmedLabel
        )
    }

    /// `normalizeTimestampMs(value)` — SQLite `datetime('now')` strings carry no
    /// timezone and are UTC; ISO-like strings without a zone get `Z` appended,
    /// space-separated ones get `T` + `Z`. Returns .nan when unparseable.
    public static func normalizeTimestampMs(_ value: String) -> Double {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .nan }
        let hasZone = trimmed.hasSuffix("Z") || trimmed.hasSuffix("z")
            || trimmed.range(of: "[+-]\\d\\d:\\d\\d$", options: .regularExpression) != nil
        let isoLike: String
        if hasZone {
            isoLike = trimmed
        } else if trimmed.contains("T") {
            isoLike = trimmed + "Z"
        } else {
            isoLike = trimmed.replacingOccurrences(of: " ", with: "T") + "Z"
        }
        guard let date = parseDate(isoLike) else { return .nan }
        return date.timeIntervalSince1970 * 1000
    }

    private static func parseDate(_ value: String) -> Date? {
        let fmts = [
            "yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX",
            "yyyy-MM-dd'T'HH:mm:ssXXXXX",
            "yyyy-MM-dd'T'HH:mmXXXXX",
        ]
        for f in fmts {
            let fmt = DateFormatter()
            fmt.locale = Locale(identifier: "en_US_POSIX")
            fmt.timeZone = TimeZone(identifier: "UTC")
            fmt.dateFormat = f
            if let d = fmt.date(from: value) { return d }
        }
        return nil
    }

    /// `buildUndoSuccessMessage(entity, beforeRow, afterPayload)` — the
    /// kitchen-native success copy shown after a successful undo.
    public static func undoSuccessMessage(
        entity: KitchenAssistantUndoableEntity,
        beforeItem: String?,
        beforeIngredient: String?,
        beforeCookName: String?
    ) -> String {
        func firstNonEmpty(_ s: String?, fallback: String) -> String {
            let t = (s ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return t.isEmpty ? fallback : t
        }
        switch entity {
        case .eightySix:
            return "\(firstNonEmpty(beforeItem, fallback: "that item")) is back on."
        case .lineCheckEntries:
            return "Removed \(firstNonEmpty(beforeItem, fallback: "that check"))."
        case .inventoryUpdates:
            return "Removed \(firstNonEmpty(beforeItem, fallback: "that stock update"))."
        case .orderGuideItems:
            return "Removed \(firstNonEmpty(beforeIngredient, fallback: "that order guide row"))."
        case .equipmentMaintenance:
            return "Removed that maintenance ticket."
        case .goldStars:
            return "Removed \(firstNonEmpty(beforeCookName, fallback: "that cook"))'s Gold Star."
        }
    }
}
