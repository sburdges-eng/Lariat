// RecipeManifestCache — process-wide in-memory manifest cache (D1-B / kickoff
// §7.2). The in-process BOM/cascade path would otherwise re-parse every recipe
// CSV on each assistant/cascade call; this recomputes only when the CSVs change.
//
// Invalidation key: mtime(recipe_index.csv) + max mtime across normalized/*.csv.
// So operators can rsync updated CSVs into the data root and the next call
// reloads without an app restart (the "recipe updates without rebuild" promise).

import Foundation

public final class RecipeManifestCache: @unchecked Sendable {
    public static let shared = RecipeManifestCache()

    private let lock = NSLock()
    private var cachedKey: String?
    private var cachedSignature: [TimeInterval]?
    private var cachedManifest: [String: RecipeManifest]?
    /// Test instrumentation: number of actual (uncached) loads performed.
    public private(set) var loadCount = 0

    public init() {}

    /// Return the cached manifest when the CSVs are unchanged; otherwise load,
    /// cache, and return. Load errors propagate (no stale-serve on failure).
    public func manifest(recipeIndex: URL, normalizedDir: URL) throws -> [String: RecipeManifest] {
        let signature = Self.signature(recipeIndex: recipeIndex, normalizedDir: normalizedDir)
        lock.lock()
        defer { lock.unlock() }
        if cachedKey == recipeIndex.path, cachedSignature == signature, let cachedManifest {
            return cachedManifest
        }
        let manifest = try RecipeManifestLoader.loadManifest(recipeIndex: recipeIndex, normalizedDir: normalizedDir)
        loadCount += 1
        cachedKey = recipeIndex.path
        cachedSignature = signature
        cachedManifest = manifest
        return manifest
    }

    public func invalidate() {
        lock.lock()
        defer { lock.unlock() }
        cachedKey = nil
        cachedSignature = nil
        cachedManifest = nil
    }

    static func signature(recipeIndex: URL, normalizedDir: URL) -> [TimeInterval] {
        let fm = FileManager.default
        func mtime(_ path: String) -> TimeInterval {
            guard let attrs = try? fm.attributesOfItem(atPath: path),
                  let date = attrs[.modificationDate] as? Date else { return 0 }
            return date.timeIntervalSince1970
        }
        var maxNormalized: TimeInterval = 0
        var normalizedCount = 0
        if let files = try? fm.contentsOfDirectory(at: normalizedDir, includingPropertiesForKeys: nil) {
            for file in files where file.pathExtension == "csv" {
                maxNormalized = max(maxNormalized, mtime(file.path))
                normalizedCount += 1
            }
        }
        // Count included so an added/deleted normalized CSV invalidates even if
        // no surviving file's mtime advanced.
        return [mtime(recipeIndex.path), maxNormalized, Double(normalizedCount)]
    }
}
