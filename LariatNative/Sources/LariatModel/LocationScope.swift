import Foundation

public enum LocationScope {
    public static func resolve(env: [String: String] = ProcessInfo.processInfo.environment) -> String {
        let v = env["LARIAT_LOCATION_ID"]
        return (v?.isEmpty == false) ? v! : "default"
    }
}
