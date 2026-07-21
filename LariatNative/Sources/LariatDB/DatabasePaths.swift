import Foundation
import LariatModel

/// Mirrors lib/dataDir.ts via `resolveDataDirectory`. The DB file is `<dataDir>/lariat.db`.
public func resolveDatabasePath(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath,
    fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
) -> String {
    let dataDir = resolveDataDirectory(env: env, cwd: cwd, fileExists: fileExists)
    return (dataDir as NSString).appendingPathComponent("lariat.db")
}
