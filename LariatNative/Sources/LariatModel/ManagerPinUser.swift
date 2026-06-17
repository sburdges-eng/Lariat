import Foundation

public struct ManagerPinUser: Codable, Sendable, Equatable {
    public let id: Int64
    public let locationId: String
    public let name: String
    public let role: String

    public init(id: Int64, locationId: String, name: String, role: String) {
        self.id = id
        self.locationId = locationId
        self.name = name
        self.role = role
    }
}
