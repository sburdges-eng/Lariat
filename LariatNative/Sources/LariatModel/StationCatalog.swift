import Foundation

/// Kitchen station from `data/cache/stations.json` (mirrors `lib/data.ts` `Station`).
public struct KitchenStation: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let line: String?
    public let lineCheckKey: String?

    enum CodingKeys: String, CodingKey {
        case id, name, line
        case lineCheckKey = "line_check_key"
    }
}

/// Recipe row subset for 86 cascade (mirrors `lib/data.ts` `Recipe`).
public struct RecipeCatalogEntry: Codable, Equatable, Sendable {
    public let slug: String
    public let name: String
    public let subRecipes: [String]?

    enum CodingKeys: String, CodingKey {
        case slug, name
        case subRecipes = "sub_recipes"
    }
}

/// Loads static station / line-check / recipe JSON from the web cache directory.
public struct StationCatalog: Sendable {
    public let stations: [KitchenStation]
    public let lineCheckTemplates: [String: [String]]
    public let recipes: [RecipeCatalogEntry]

    public init(
        stations: [KitchenStation],
        lineCheckTemplates: [String: [String]],
        recipes: [RecipeCatalogEntry]
    ) {
        self.stations = stations
        self.lineCheckTemplates = lineCheckTemplates
        self.recipes = recipes
    }

    public func lineCheckItems(for station: KitchenStation) -> [String] {
        guard let key = station.lineCheckKey, !key.isEmpty else { return [] }
        return lineCheckTemplates[key] ?? []
    }

    /// Mirrors `lib/data.ts` cache root: `<dataDir>/cache/*.json`.
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) throws -> StationCatalog {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let decoder = JSONDecoder()
        let stations: [KitchenStation] = try decodeJSONFile("stations.json", in: cacheDir, decoder: decoder)
        let lineChecks: [String: [String]] = try decodeJSONFile("line_checks.json", in: cacheDir, decoder: decoder)
        let recipes: [RecipeCatalogEntry] = try decodeJSONFile("recipes.json", in: cacheDir, decoder: decoder)
        return StationCatalog(stations: stations, lineCheckTemplates: lineChecks, recipes: recipes)
    }
}

public func resolveCacheDirectory(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    (resolveDataDirectory(env: env, cwd: cwd) as NSString).appendingPathComponent("cache")
}

/// UTC `yyyy-MM-dd` — mirrors `lib/db.ts` `todayISO()`.
public func todayISO(from date: Date = Date(), calendar: Calendar = {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    return cal
}()) -> String {
    let comps = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
}


private func resolveDataDirectory(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    if let raw = env["LARIAT_DATA_DIR"], !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return (raw as NSString).isAbsolutePath ? raw : (cwd as NSString).appendingPathComponent(raw)
    }
    return (cwd as NSString).appendingPathComponent("data")
}

private func decodeJSONFile<T: Decodable>(
    _ name: String,
    in directory: String,
    decoder: JSONDecoder
) throws -> T {
    let path = (directory as NSString).appendingPathComponent(name)
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return try decoder.decode(T.self, from: data)
}
