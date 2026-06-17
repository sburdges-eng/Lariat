import Foundation

/// Staff row from `data/cache/staff.json`.
public struct StaffMember: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let first: String?
    public let last: String?
    public let role: String?
    public let active: Bool?
    public let jobTitle: String?

    public var displayName: String {
        StaffCatalog.formatDisplayName(first: first, last: last)
    }

    enum CodingKeys: String, CodingKey {
        case id, first, last, role, active
        case jobTitle = "job_title"
    }
}

/// Loads and filters staff for cook identity picker — parity with `lib/staffDisplay.ts`.
public enum StaffCatalog {
    private static let junkIDs: Set<String> = ["non_usable_employee"]
    private static let junkNamePattern = try! NSRegularExpression(
        pattern: #"\b(non\s*usable|test|placeholder|total)\b"#,
        options: [.caseInsensitive]
    )

    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) throws -> [StaffMember] {
        let path = (resolveCacheDirectory(env: env, cwd: cwd) as NSString).appendingPathComponent("staff.json")
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let rows = try JSONDecoder().decode([StaffMember].self, from: data)
        return rows.filter(isDisplayable).sorted { $0.displayName < $1.displayName }
    }

    public static func isDisplayable(_ staff: StaffMember) -> Bool {
        if staff.active == false { return false }
        let id = staff.id.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if junkIDs.contains(id) { return false }
        let name = formatDisplayName(first: staff.first, last: staff.last)
        if name.isEmpty { return false }
        let range = NSRange(name.startIndex..., in: name)
        return junkNamePattern.firstMatch(in: name, range: range) == nil
    }

    public static func formatDisplayName(first: String?, last: String?) -> String {
        [titlePart(first), titlePart(last)].filter { !$0.isEmpty }.joined(separator: " ")
    }

    private static func titlePart(_ value: String?) -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return trimmed
            .split(whereSeparator: \.isWhitespace)
            .map { part in
                let lower = part.lowercased()
                return lower.prefix(1).uppercased() + lower.dropFirst()
            }
            .joined(separator: " ")
    }
}
