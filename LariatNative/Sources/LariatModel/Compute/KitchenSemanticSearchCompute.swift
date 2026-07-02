import Foundation

/// Pure half of `lib/kitchenSemanticSearch.ts` — corpus rows, lexical
/// tokenize/normalize/score/excerpt/rank, and the prompt formatter. Corpus
/// building from the DB lives in LariatDB.KitchenSemanticSearchRepository.
///
/// Deferral (Phase B plan): the web's `referenceRecipeHits` uses the datapack
/// HYBRID channel (BM25 + BGE). Natively the reference bucket runs lexical FTS
/// via DatapackRepository — same graceful behavior the web has when the vector
/// pack is absent.
public enum KitchenSemanticSearchCompute {
    public static let defaultLimit = 6
    public static let maxLimit = 12
    public static let maxLocalRows = 200
    public static let maxAuditRows = 120
    public static let maxText = 900

    static let stopWords: Set<String> = [
        "and", "are", "but", "for", "from", "has", "have", "how", "that",
        "the", "this", "was", "were", "what", "when", "where", "which",
        "with", "find", "look", "show", "tell", "about",
    ]

    /// `SAFE_AUDIT_ENTITIES` — the only audit entities cook-tier search may read.
    public static let safeAuditEntities = [
        "beo_line_items",
        "beo_prep_tasks",
        "cooling_batches",
        "eighty_six",
        "equipment_maintenance",
        "inventory_updates",
        "kds_ticket_state",
        "line_check_entries",
        "prep_tasks",
        "receiving_checks",
        "station_signoffs",
        "temp_log",
    ]

    public enum HitType: String, Sendable, Codable {
        case recipe
        case beoLineItem = "beo_line_item"
        case beoPrepTask = "beo_prep_task"
        case auditEvent = "audit_event"
        case referenceRecipe = "reference_recipe"

        /// `labelForType(type)`
        public var label: String {
            switch self {
            case .recipe: return "Recipe"
            case .beoLineItem: return "BEO line"
            case .beoPrepTask: return "BEO prep"
            case .auditEvent: return "Audit"
            case .referenceRecipe: return "Reference recipe"
            }
        }
    }

    public struct CorpusRow: Sendable, Equatable {
        public let type: HitType
        public let title: String
        public let detail: String
        public let text: String
        public let id: String
        public let source: String?

        public init(type: HitType, title: String, detail: String, text: String, id: String, source: String?) {
            self.type = type
            self.title = title
            self.detail = detail
            self.text = text
            self.id = id
            self.source = source
        }
    }

    public struct Hit: Sendable, Equatable {
        public let type: HitType
        public let score: Double
        public let title: String
        public let detail: String
        public let excerpt: String
        public let id: String
        public let source: String?

        public init(type: HitType, score: Double, title: String, detail: String, excerpt: String, id: String, source: String?) {
            self.type = type
            self.score = score
            self.title = title
            self.detail = detail
            self.excerpt = excerpt
            self.id = id
            self.source = source
        }
    }

    public struct SearchResult: Sendable, Equatable {
        public let query: String
        public let hits: [Hit]

        public init(query: String, hits: [Hit]) {
            self.query = query
            self.hits = hits
        }
    }

    // ── ranking ─────────────────────────────────────────────────────

    public static func normalizeLimit(_ raw: Int?) -> Int {
        guard let raw else { return defaultLimit }
        return max(1, min(maxLimit, raw))
    }

    public static func clip(_ value: String?, _ max: Int) -> String {
        guard let value else { return "" }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > max ? String(trimmed.prefix(max)) : trimmed
    }

    public static func normalize(_ text: String) -> String {
        text.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    public static func tokenize(_ text: String) -> [String] {
        normalize(text)
            .split(separator: " ")
            .map(String.init)
            .filter { $0.count > 2 && !stopWords.contains($0) }
    }

    /// `scoreRow(query, queryTokens, row)` parity.
    public static func scoreRow(query: String, queryTokens: [String], row: CorpusRow) -> Double {
        let normalizedText = normalize("\(row.title)\n\(row.detail)\n\(row.text)")
        let normalizedTitle = normalize(row.title)
        let rowTokens = Set(tokenize(normalizedText))
        var score = 0.0
        let normalizedQuery = normalize(query)
        if !normalizedQuery.isEmpty && normalizedText.contains(normalizedQuery) { score += 8 }
        for token in queryTokens {
            if rowTokens.contains(token) {
                score += normalizedTitle.contains(token) ? 3 : 2
                continue
            }
            if token.count >= 5 && normalizedText.contains(token) { score += 0.75 }
        }
        if row.type == .recipe && queryTokens.contains("recipe") { score += 1 }
        if (row.type == .beoLineItem || row.type == .beoPrepTask) && queryTokens.contains("wedding") {
            score += 0.5
        }
        return score
    }

    /// `rankCorpus(query, rows, limit)` parity — including the empty-token
    /// fallback (short shorthand like "GF" ranks by whole-normalized-query).
    public static func rankCorpus(query: String, rows: [CorpusRow], limit: Int) -> [Hit] {
        let queryTokens = tokenize(query)
        let normalizedQuery = normalize(query)
        if queryTokens.isEmpty && normalizedQuery.isEmpty { return [] }
        let excerptTokens = queryTokens.isEmpty ? [normalizedQuery] : queryTokens
        var out: [Hit] = []
        for row in rows {
            let score = scoreRow(query: query, queryTokens: queryTokens, row: row)
            if score <= 0 { continue }
            out.append(Hit(
                type: row.type,
                score: score,
                title: row.title,
                detail: row.detail,
                excerpt: excerpt(text: row.text, queryTokens: excerptTokens),
                id: row.id,
                source: row.source
            ))
        }
        return Array(sortHits(out).prefix(limit))
    }

    /// Shared sort: score DESC, then type ASC, then title ASC.
    public static func sortHits(_ hits: [Hit]) -> [Hit] {
        hits.sorted { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.type.rawValue != b.type.rawValue { return a.type.rawValue < b.type.rawValue }
            return a.title < b.title
        }
    }

    /// Merge local + reference hits: dedupe by id (first wins), re-sort, cap.
    public static func mergeHits(_ lists: [[Hit]], limit: Int) -> [Hit] {
        var byId: [String: Hit] = [:]
        var order: [String] = []
        for list in lists {
            for hit in list where byId[hit.id] == nil {
                byId[hit.id] = hit
                order.append(hit.id)
            }
        }
        return Array(sortHits(order.compactMap { byId[$0] }).prefix(limit))
    }

    /// `excerpt(text, queryTokens)` — anchors on the normalized-index map so
    /// punctuation-heavy text still centers the window on the match.
    public static func excerpt(text: String, queryTokens: [String]) -> String {
        let compact = text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if compact.isEmpty { return "" }
        let (normalized, indexMap) = normalizeWithIndexMap(compact)
        var bestIdx = -1
        for token in queryTokens {
            if let range = normalized.range(of: token) {
                let idx = normalized.distance(from: normalized.startIndex, to: range.lowerBound)
                if bestIdx < 0 || idx < bestIdx { bestIdx = idx }
            }
        }
        let compactChars = Array(compact)
        let compactIdx = bestIdx >= 0 && bestIdx < indexMap.count ? indexMap[bestIdx] : 0
        let start = compactIdx > 60 ? compactIdx - 60 : 0
        let slice = String(compactChars[start...])
        return clip(slice, 220)
    }

    static func normalizeWithIndexMap(_ text: String) -> (normalized: String, indexMap: [Int]) {
        var chars: [Character] = []
        var indexMap: [Int] = []
        var pendingSpace = -1
        let source = Array(text)

        for i in 0..<source.count {
            let lower = String(source[i]).lowercased()
            let ch = lower.count == 1 ? Character(lower) : source[i]
            if ch.isASCII && (ch.isLowercase || ch.isNumber) {
                if pendingSpace >= 0 && !chars.isEmpty {
                    chars.append(" ")
                    indexMap.append(pendingSpace)
                }
                pendingSpace = -1
                chars.append(ch)
                indexMap.append(i)
                continue
            }
            if !chars.isEmpty && pendingSpace < 0 { pendingSpace = i }
        }
        return (String(chars), indexMap)
    }

    /// `payloadText(raw)` — flatten a JSON payload to searchable primitives.
    public static func payloadText(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "" }
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else {
            return clip(raw, maxText)
        }
        var out: [String] = []
        collectPrimitives(AssistantJSONValue.from(any: parsed), &out)
        return out.joined(separator: " ")
    }

    static func collectPrimitives(_ value: AssistantJSONValue, _ out: inout [String]) {
        if out.joined(separator: " ").count > maxText { return }
        switch value {
        case .null:
            return
        case .string(let s): out.append(s)
        case .number(let n): out.append(JsValueFormat.numberString(n))
        case .bool(let b): out.append(b ? "true" : "false")
        case .array(let a):
            for item in a { collectPrimitives(item, &out) }
        case .object(let o):
            // JS Object.entries order is insertion order; JSONSerialization
            // loses it — sort keys for determinism (search-text only).
            for (key, nested) in o.sorted(by: { $0.key < $1.key }) {
                out.append(key.replacingOccurrences(of: "_", with: " "))
                collectPrimitives(nested, &out)
            }
        }
    }

    /// `labelEntity(entity)`
    public static func labelEntity(_ entity: String) -> String {
        entity.replacingOccurrences(of: "_", with: " ")
    }

    /// `formatSemanticKitchenSearchForPrompt(result)` parity.
    public static func formatForPrompt(_ result: SearchResult) -> String {
        let query = result.query.isEmpty ? "blank query" : result.query
        if result.hits.isEmpty {
            return "No semantic search matches for \"\(query)\"."
        }
        var lines = ["Semantic search for \"\(query)\" - \(result.hits.count) hit(s):"]
        for (idx, hit) in result.hits.enumerated() {
            let source = hit.source.map { " (\($0))" } ?? ""
            let excerpt = hit.excerpt.isEmpty ? "" : " - \(hit.excerpt)"
            lines.append("\(idx + 1). [\(hit.type.label)\(source)] \(hit.title) - \(hit.detail)\(excerpt)")
        }
        return lines.joined(separator: "\n")
    }
}
