import Foundation

/// Pure half of `lib/complianceSearch.ts` — token sanitation for the FTS MATCH
/// expression and the CONTEXT block renderer. The BM25 query itself lives in
/// LariatDB.ComplianceSearchRepository (read-only over data/cache/compliance.db).
///
/// Deferral (Phase B plan): the BGE semantic/hybrid channel is deferred —
/// lexical BM25 only, which is exactly how the web behaves when the vectors
/// sidecar is absent.
public enum ComplianceSearchCompute {
    public static let stopWords: Set<String> = [
        "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "with",
        "is", "are", "was", "were", "be", "been", "being",
        "do", "does", "did", "done",
        "how", "what", "when", "where", "why", "who", "which",
        "i", "we", "you", "they", "them", "us", "our", "your",
        "this", "that", "these", "those", "it", "its",
        "as", "if", "than", "then", "so",
    ]

    /// Sanitize + tokenize → FTS5 `token* OR token*` MATCH expression.
    /// Returns nil when no searchable tokens remain (web returns []).
    public static func matchExpression(_ query: String) -> String? {
        let sanitized = query
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9 ]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        if sanitized.isEmpty { return nil }
        let tokens = sanitized.split(separator: " ")
            .map(String.init)
            .filter { $0.count > 1 && !stopWords.contains($0) }
        if tokens.isEmpty { return nil }
        return tokens.map { "\($0)*" }.joined(separator: " OR ")
    }

    /// `ComplianceRulePayload` — decoded from compliance_rules.payload JSON.
    public struct RulePayload: Codable, Sendable, Equatable {
        public struct Escalation: Codable, Sendable, Equatable {
            public let managerRequired: Bool?
            public let policeRequired: Bool?
            public let emsRequired: Bool?

            enum CodingKeys: String, CodingKey {
                case managerRequired = "manager_required"
                case policeRequired = "police_required"
                case emsRequired = "ems_required"
            }

            public init(managerRequired: Bool?, policeRequired: Bool?, emsRequired: Bool?) {
                self.managerRequired = managerRequired
                self.policeRequired = policeRequired
                self.emsRequired = emsRequired
            }
        }

        public struct Source: Codable, Sendable, Equatable {
            public let title: String?

            public init(title: String?) {
                self.title = title
            }
        }

        public let topic: String?
        public let domain: String?
        public let plainLanguageSummary: String?
        public let requiredActions: [String]?
        public let prohibitedActions: [String]?
        public let escalation: Escalation?
        public let source: Source?

        enum CodingKeys: String, CodingKey {
            case topic, domain, escalation, source
            case plainLanguageSummary = "plain_language_summary"
            case requiredActions = "required_actions"
            case prohibitedActions = "prohibited_actions"
        }

        public init(
            topic: String?, domain: String?, plainLanguageSummary: String?,
            requiredActions: [String]?, prohibitedActions: [String]?,
            escalation: Escalation?, source: Source?
        ) {
            self.topic = topic
            self.domain = domain
            self.plainLanguageSummary = plainLanguageSummary
            self.requiredActions = requiredActions
            self.prohibitedActions = prohibitedActions
            self.escalation = escalation
            self.source = source
        }
    }

    public struct SearchHit: Sendable, Equatable {
        public let id: String
        public let verificationStatus: String
        public let rule: RulePayload

        public init(id: String, verificationStatus: String, rule: RulePayload) {
            self.id = id
            self.verificationStatus = verificationStatus
            self.rule = rule
        }
    }

    /// `renderCompliance(question)` block body given the FTS hits.
    public static func renderCompliance(_ hits: [SearchHit]) -> AssistantContextCompute.Section {
        if hits.isEmpty { return .empty }

        var text = "\nCOLORADO COMPLIANCE (verify before acting):\n"
        for h in hits {
            let r = h.rule
            text += "  - [\(h.id)] \(r.topic ?? "") (\(r.domain ?? ""))\n"
            text += "    summary: \(r.plainLanguageSummary ?? "")\n"
            let required = r.requiredActions ?? []
            if !required.isEmpty {
                text += "    required: \(required.prefix(3).joined(separator: "; "))\n"
            }
            let prohibited = r.prohibitedActions ?? []
            if !prohibited.isEmpty {
                text += "    prohibited: \(prohibited.prefix(3).joined(separator: "; "))\n"
            }
            if r.escalation?.managerRequired == true { text += "    escalation: manager required\n" }
            if r.escalation?.policeRequired == true { text += "    escalation: police required\n" }
            if r.escalation?.emsRequired == true { text += "    escalation: EMS required\n" }
            text += "    source: \(r.source?.title ?? "")\n"
            text += "    verification: \(h.verificationStatus)\n"
        }
        text += "  NOTE: rows tagged \"unverified\" or \"internal_house_policy_draft\" are reference only - verify with counsel before treating as authoritative.\n"

        return AssistantContextCompute.Section(
            text: text,
            source: AssistantContextSource(type: "compliance", detail: "\(hits.count) CO compliance rule(s)")
        )
    }
}
