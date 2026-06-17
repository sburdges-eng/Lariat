import Foundation

/// Perform a source-row write AND its audit-event in one transaction (both roll back together).
public protocol AuditedWrite {
    associatedtype Result
    func performAudited() throws -> Result
}

/// The HACCP needs_corrective_action 422 contract: reject a write that violates a binding rule.
public protocol RuleGate {
    func validate() throws
}

/// Manager-PIN gate for protected writes.
public protocol PinGate {
    func requirePin() throws
}
