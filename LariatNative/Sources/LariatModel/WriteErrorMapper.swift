import Foundation

/// Line-cook friendly messages for native write failures.
public enum WriteErrorMapper {
    public static func message(for error: Error) -> String {
        if let gate = error as? PinGateError {
            return gate.localizedDescription ?? "PIN check failed"
        }
        if let mgmt = error as? ManagementWriteError {
            return mgmt.localizedDescription ?? "PIN required"
        }
        if let e86 = error as? EightySixWriteError {
            return e86.localizedDescription ?? "Could not save 86"
        }
        let text = String(describing: error).lowercased()
        if text.contains("busy") || text.contains("locked") || text.contains("sqlite_busy") {
            return "Database busy — try again in a moment"
        }
        return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
