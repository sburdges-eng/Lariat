import Foundation

/// Persists cook attribution — parity with web `localStorage.lariat_cook`.
@Observable @MainActor
final class CookIdentityStore {
    static let shared = CookIdentityStore()
    static let storageKey = "lariat_cook"

    var cookId: String? {
        didSet { UserDefaults.standard.set(cookId, forKey: Self.storageKey) }
    }

    private init() {
        cookId = UserDefaults.standard.string(forKey: Self.storageKey)
    }

    func setCookId(_ id: String?) {
        let trimmed = id?.trimmingCharacters(in: .whitespacesAndNewlines)
        cookId = (trimmed?.isEmpty == false) ? trimmed : nil
    }
}
