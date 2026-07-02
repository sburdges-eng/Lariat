import Foundation

/// Pure rule/shape port of `lib/ingredientMastersRepo.ts` (`validateMasterUpdates`
/// L196-220) plus the field-clip helpers from
/// `app/api/costing/ingredient-masters/route.js` (`clipOrNull` L38-44,
/// `canonical_name` non-empty gate L104-107). No I/O.
public enum IngredientMastersCompute {
    public static let staleAfterDays = 90

    /// Mirror `lib/ingredientMastersRepo.ts:196-220` `validateMasterUpdates`.
    /// Throws `.rejected` BEFORE any write — callers MUST run this before
    /// touching the database (audited-write ordering contract).
    public static func validateMasterUpdates(before: IngredientMasterRow, updates: IngredientMasterUpdates) throws {
        // asBoolFlag(updates.quality_locked): .absent -> nil, .set(b) -> b.
        let nextLocked: Bool?
        if case .set(let b) = updates.qualityLocked { nextLocked = b } else { nextLocked = nil }
        let lockedNow = before.qualityLocked != 0
        let willBeLocked = nextLocked ?? lockedNow

        // vendor "present" == updates.preferredVendor != .absent; value via .set.
        var vendorPresent = false
        var vendorValue: String?
        if case .set(let v) = updates.preferredVendor { vendorPresent = true; vendorValue = v }

        // repo L204: nextLocked===true && preferred_vendor undefined && !before.preferred_vendor
        // JS `!before.preferred_vendor` is falsy on both nil AND "" — map with isEmpty ?? true.
        if nextLocked == true, !vendorPresent, (before.preferredVendor?.isEmpty ?? true) {
            throw IngredientMasterWriteError.rejected("Pick a vendor before locking for quality.")
        }
        // repo L208-215: lockedNow && vendor present && vendor != before && !(nextLocked===false)
        if lockedNow, vendorPresent, vendorValue != before.preferredVendor, nextLocked != false {
            throw IngredientMasterWriteError.rejected("Quality lock is on — unlock before changing vendor.")
        }
        // repo L217-219: willBeLocked && updates.preferred_vendor === null
        if willBeLocked, vendorPresent, vendorValue == nil {
            throw IngredientMasterWriteError.rejected("Cannot clear preferred vendor while quality lock is on.")
        }
    }

    /// Mirror `clipOrNull` (route.js L38-44): nil passes through as nil;
    /// non-empty-after-trim strings clip to `max`; whitespace-only strings
    /// become nil (matches JS `if (!t) return null`).
    public static func clipOrNull(_ value: String?, max: Int) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(max))
    }

    /// Mirror the `canonical_name` gate (route.js L104-107): non-empty string,
    /// clip to 200. Empty-after-trim -> `.rejected("canonical_name cannot be empty")`.
    public static func validateCanonicalName(_ value: String, max: Int = 200) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw IngredientMasterWriteError.rejected("canonical_name cannot be empty")
        }
        return String(trimmed.prefix(max))
    }
}
