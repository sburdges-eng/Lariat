import Foundation
import GRDB

/// Mirrors `IngredientMasterRow` in `lib/ingredientMastersRepo.ts` — one row of the
/// `ingredient_masters` table joined with vendor_prices/bom_lines counts. Masters
/// are GLOBAL (no `location_id` column on `ingredient_masters` — db.ts:1445-1453);
/// the audit row for a write carries `location_id` from the write context instead.
public struct IngredientMasterRow: Decodable, FetchableRecord, Sendable, Identifiable, Equatable {
    public var id: String { masterId }
    public let masterId: String            // master_id  (TEXT PK)
    public let canonicalName: String       // canonical_name (NOT NULL)
    public let category: String?           // category
    public let preferredVendor: String?    // preferred_vendor
    public let qualityLocked: Int          // quality_locked (INTEGER NOT NULL DEFAULT 0)
    public let qualityLockReason: String?  // quality_lock_reason
    public let lastReviewed: String?       // last_reviewed
    public let vendorPriceCount: Int       // COALESCE(vp.cnt,0)
    public let bomLineCount: Int           // COALESCE(bl.cnt,0)

    enum CodingKeys: String, CodingKey {
        case masterId = "master_id", canonicalName = "canonical_name",
             category, preferredVendor = "preferred_vendor",
             qualityLocked = "quality_locked", qualityLockReason = "quality_lock_reason",
             lastReviewed = "last_reviewed",
             vendorPriceCount = "vendor_price_count", bomLineCount = "bom_line_count"
    }

    public init(
        masterId: String, canonicalName: String, category: String?, preferredVendor: String?,
        qualityLocked: Int, qualityLockReason: String?, lastReviewed: String?,
        vendorPriceCount: Int, bomLineCount: Int
    ) {
        self.masterId = masterId
        self.canonicalName = canonicalName
        self.category = category
        self.preferredVendor = preferredVendor
        self.qualityLocked = qualityLocked
        self.qualityLockReason = qualityLockReason
        self.lastReviewed = lastReviewed
        self.vendorPriceCount = vendorPriceCount
        self.bomLineCount = bomLineCount
    }
}

/// Mirrors `ListMastersOpts.filter` in `lib/ingredientMastersRepo.ts`. Repo/API
/// default is `.all` (route.js GET default `filter='all'`); the View overrides
/// its own default to `.needsReview` (page.jsx L49-53) — both defaults are
/// asserted separately (repository test vs VM/View default).
public enum IngredientMasterFilter: String, Sendable, CaseIterable {
    case all, needsReview = "needs_review", reviewed
}

/// One field-set partial update. `.absent` means "not present in updates"
/// (skipped — mirrors JS `Object.prototype.hasOwnProperty.call`); distinguished
/// from `.set(nil)` which clears the column.
public enum FieldChange<T: Sendable>: Sendable {
    case absent
    case set(T)

    var isPresent: Bool {
        if case .absent = self { return false }
        return true
    }
}

/// Mirrors `MasterUpdates` in `lib/ingredientMastersRepo.ts`.
public struct IngredientMasterUpdates: Sendable {
    public var canonicalName: FieldChange<String> = .absent        // non-empty when present
    public var category: FieldChange<String?> = .absent
    public var preferredVendor: FieldChange<String?> = .absent
    public var qualityLocked: FieldChange<Bool> = .absent
    public var qualityLockReason: FieldChange<String?> = .absent
    public var lastReviewed: FieldChange<LastReviewedChange> = .absent

    public var isEmpty: Bool {
        !canonicalName.isPresent && !category.isPresent && !preferredVendor.isPresent
            && !qualityLocked.isPresent && !qualityLockReason.isPresent && !lastReviewed.isPresent
    }

    public init() {}
}

/// Mirrors the `'now' | string | null` union of `MasterUpdates.last_reviewed`.
public enum LastReviewedChange: Sendable {
    case now
    case iso(String)
    case clear
}

/// Mirrors `MasterUpdateRejectedError` (web 422) plus the native write-path
/// failure modes. `.notFound` exists for symmetry with the web shape but is
/// never thrown by `updateMaster` — a missing master returns
/// `UpdateMasterResult(found: false, ...)` instead (repo L229-232), matching
/// `updateMaster`'s own return-not-throw contract.
public enum IngredientMasterWriteError: Error, LocalizedError, Sendable, Equatable {
    case rejected(String)          // validateMasterUpdates rule failures (web 422 / MasterUpdateRejectedError)
    case notFound                  // symmetry only — see doc comment above
    case persistenceFailed

    public var errorDescription: String? {
        switch self {
        case .rejected(let message): return message
        case .notFound: return "Ingredient master not found"
        case .persistenceFailed: return "Could not save ingredient master"
        }
    }
}
