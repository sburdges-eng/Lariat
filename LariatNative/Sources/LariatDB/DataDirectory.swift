import Foundation
import LariatModel

/// Mirrors `lib/dataDir.ts` — data root from `LARIAT_DATA_DIR` or `<cwd>/data`.
public func resolveDataDirectory(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    LariatModel.resolveDataDirectory(env: env, cwd: cwd)
}

/// Mirrors `lib/auditLog.mjs` default path; honors `LARIAT_AUDIT_PATH` override.
public func resolveManagementAuditPath(
    env: [String: String] = ProcessInfo.processInfo.environment,
    cwd: String = FileManager.default.currentDirectoryPath
) -> String {
    if let override = env["LARIAT_AUDIT_PATH"], !override.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return override
    }
    let auditDir = (resolveDataDirectory(env: env, cwd: cwd) as NSString).appendingPathComponent("audit")
    return (auditDir as NSString).appendingPathComponent("management-actions.jsonl")
}
