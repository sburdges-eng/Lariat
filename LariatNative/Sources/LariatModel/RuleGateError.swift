import Foundation

/// HACCP rule gate failures — mirror web 422 `needs_corrective_action` contract.
public enum RuleGateError: Error, LocalizedError, Equatable {
    case needsCorrectiveAction(pointId: String, reason: String)
    case validationFailed(String)
    case correctiveNoteTooLong(length: Int)

    public var errorDescription: String? {
        switch self {
        case .needsCorrectiveAction(_, let reason):
            return reason
        case .validationFailed(let msg):
            return msg
        case .correctiveNoteTooLong:
            return "Note is too long (max 500 characters)"
        }
    }

    public var needsCorrectiveAction: Bool {
        if case .needsCorrectiveAction = self { return true }
        return false
    }
}
