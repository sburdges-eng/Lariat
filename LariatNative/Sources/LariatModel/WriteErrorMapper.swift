import Foundation

/// Line-cook friendly messages for native write failures.
public enum WriteErrorMapper {
    public static func message(for error: Error) -> String {
        if let rule = error as? RuleGateError {
            return rule.localizedDescription
        }
        if let temp = error as? TempLogWriteError {
            return temp.localizedDescription ?? "Could not save temp reading"
        }
        if let gate = error as? PinGateError {
            return gate.localizedDescription
        }
        if let mgmt = error as? ManagementWriteError {
            return mgmt.localizedDescription
        }
        if let e86 = error as? EightySixWriteError {
            return e86.localizedDescription
        }
        if let dm = error as? DateMarkWriteError {
            return dm.localizedDescription
        }
        if let cal = error as? CalibrationWriteError {
            return cal.localizedDescription
        }
        if let line = error as? LineCheckWriteError {
            return line.localizedDescription
        }
        let text = String(describing: error).lowercased()
        if text.contains("busy") || text.contains("locked") || text.contains("sqlite_busy") {
            return "Database busy — try again in a moment"
        }
        return (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
