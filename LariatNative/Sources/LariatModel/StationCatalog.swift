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

/// Why a `StationCatalog.load()` failed, pinned to the specific cache file so the
/// shell can tell the operator exactly what to regenerate (a bare `try?` used to
/// swallow this and the 86/Stations boards blamed the write DB instead).
public enum StationCatalogError: LocalizedError, Equatable {
    /// The file could not be read (missing, permissions, etc.).
    case unreadable(file: String, reason: String)
    /// The file was read but is not valid JSON of the expected shape.
    case undecodable(file: String, reason: String)

    public var errorDescription: String? {
        switch self {
        case let .unreadable(file, reason):
            return "Station catalog file \(file) could not be read: \(reason)"
        case let .undecodable(file, reason):
            return "Station catalog file \(file) is malformed: \(reason)"
        }
    }

    /// The cache file at fault (e.g. `"recipes.json"`).
    public var file: String {
        switch self {
        case let .unreadable(file, _), let .undecodable(file, _):
            return file
        }
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
    /// Throws `StationCatalogError` naming the exact file that failed, so callers
    /// can show an actionable message instead of a generic degrade tile.
    public static func load(
        env: [String: String] = ProcessInfo.processInfo.environment,
        cwd: String = FileManager.default.currentDirectoryPath
    ) throws -> StationCatalog {
        let cacheDir = resolveCacheDirectory(env: env, cwd: cwd)
        let decoder = JSONDecoder()
        let stations: [KitchenStation] = try decodeCatalogFile("stations.json", in: cacheDir, decoder: decoder)
        let lineChecks: [String: [String]] = try decodeCatalogFile("line_checks.json", in: cacheDir, decoder: decoder)
        let recipes: [RecipeCatalogEntry] = try decodeCatalogFile("recipes.json", in: cacheDir, decoder: decoder)
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


public func resolveDataDirectory(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    if let raw = env["LARIAT_DATA_DIR"], !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return (raw as NSString).isAbsolutePath ? raw : (cwd as NSString).appendingPathComponent(raw)
    }
    return (cwd as NSString).appendingPathComponent("data")
}

private func decodeCatalogFile<T: Decodable>(
    _ name: String,
    in directory: String,
    decoder: JSONDecoder
) throws -> T {
    let path = (directory as NSString).appendingPathComponent(name)
    let data: Data
    do {
        data = try Data(contentsOf: URL(fileURLWithPath: path))
    } catch {
        throw StationCatalogError.unreadable(file: name, reason: error.localizedDescription)
    }
    do {
        return try decoder.decode(T.self, from: data)
    } catch let error as DecodingError {
        throw StationCatalogError.undecodable(file: name, reason: decodingReason(error))
    } catch {
        throw StationCatalogError.undecodable(file: name, reason: error.localizedDescription)
    }
}

/// The human-readable core of a `DecodingError` (its context `debugDescription`),
/// without the noisy enum-case dump of `String(describing:)`.
private func decodingReason(_ error: DecodingError) -> String {
    switch error {
    case let .dataCorrupted(context),
         let .keyNotFound(_, context),
         let .typeMismatch(_, context),
         let .valueNotFound(_, context):
        return context.debugDescription
    @unknown default:
        return String(describing: error)
    }
}
