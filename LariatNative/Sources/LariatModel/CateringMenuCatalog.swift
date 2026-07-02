import Foundation

/// One catering-menu pick (`CateringMenuItem` in lib/data.ts).
public struct CateringMenuItem: Codable, Sendable, Equatable, Identifiable {
    public var id: String { "\(category)|\(name)" }
    public let category: String
    public let name: String
    public let cost: Double

    public init(category: String, name: String, cost: Double) {
        self.category = category
        self.name = name
        self.cost = cost
    }
}

/// Loads the catering menu from `data/cache/catering_menu.json` — the same
/// source the web's `getCateringMenu()` reads (BeoBoard's right-rail picker).
/// Follows the `StationCatalog.load()` precedent; NOT in `Compute/` because
/// it performs file I/O. Web parity: missing/malformed cache → `[]`.
public enum CateringMenuCatalog {
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) -> [CateringMenuItem] {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let path = (cacheDir as NSString).appendingPathComponent("catering_menu.json")
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let items = try? JSONDecoder().decode([CateringMenuItem].self, from: data)
        else { return [] }
        return items
    }
}
