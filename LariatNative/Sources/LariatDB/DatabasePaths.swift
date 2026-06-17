import Foundation

/// Mirrors lib/dataDir.ts: data dir = LARIAT_DATA_DIR (absolute, or relative to cwd),
/// else <cwd>/data. The DB file is <dataDir>/lariat.db.
public func resolveDatabasePath(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    let dataDir: String
    if let raw = env["LARIAT_DATA_DIR"], !raw.trimmingCharacters(in: .whitespaces).isEmpty {
        dataDir = (raw as NSString).isAbsolutePath ? raw : (cwd as NSString).appendingPathComponent(raw)
    } else {
        dataDir = (cwd as NSString).appendingPathComponent("data")
    }
    return (dataDir as NSString).appendingPathComponent("lariat.db")
}
