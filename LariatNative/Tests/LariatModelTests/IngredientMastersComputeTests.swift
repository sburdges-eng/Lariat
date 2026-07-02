import XCTest
@testable import LariatModel

/// Behavior-parity port of `lib/ingredientMastersRepo.ts:196-220` (`validateMasterUpdates`)
/// plus the field-validation matrix in `app/api/costing/ingredient-masters/route.js:84-144`.
/// Native has no HTTP layer, so the route's 400/422 field checks are folded into
/// `IngredientMastersCompute` as pure functions the repository write path calls
/// before touching the database (mirrors the web ordering: route validates/clips
/// BEFORE calling `updateMaster`, which then runs `validateMasterUpdates` on the
/// already-clipped values).
final class IngredientMastersComputeTests: XCTestCase {
    private func row(vendor: String? = nil, locked: Int = 0) -> IngredientMasterRow {
        IngredientMasterRow(
            masterId: "a", canonicalName: "Chicken Breast", category: nil,
            preferredVendor: vendor, qualityLocked: locked, qualityLockReason: nil,
            lastReviewed: nil, vendorPriceCount: 0, bomLineCount: 0
        )
    }

    // ── validateMasterUpdates: the three quality-lock rules (repo L200-219) ──

    // repo L204: lock true, no vendor present, before has no vendor → reject
    func testCannotLockWithoutVendor() {
        var u = IngredientMasterUpdates(); u.qualityLocked = .set(true)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: nil), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "Pick a vendor before locking for quality.")
        }
    }

    // api test L239-251: lock+vendor in one request → allowed
    func testLockWithVendorInOneRequestAllowed() throws {
        var u = IngredientMasterUpdates()
        u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(true); u.qualityLockReason = .set("quality")
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: nil), updates: u))
    }

    // repo L208-215 / api test L253-258: change vendor while locked (not unlocking) → reject
    func testCannotChangeVendorWhileLocked() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock")
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "Quality lock is on — unlock before changing vendor.")
        }
    }

    // repo L208-215: changing vendor WHILE ALSO unlocking (quality_locked:false) → allowed
    func testChangeVendorWhileUnlockingAllowed() throws {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("shamrock"); u.qualityLocked = .set(false)
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u))
    }

    // repo L217-219: clear vendor while locking-in-this-request (not yet locked
    // before, but quality_locked:true is also being set) → reject with the
    // "clear" message. Verified against the JS reference implementation:
    // when `before.preferred_vendor` is non-nil AND already locked, rule 2
    // ("change vendor while locked") fires first because `null !== before`
    // — the "clear" message (rule 3) only surfaces when rule 2 does NOT
    // apply (not-yet-locked, or before.preferred_vendor already nil).
    func testCannotClearVendorWhileLockingInSameRequest() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set(nil); u.qualityLocked = .set(true)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 0), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "Cannot clear preferred vendor while quality lock is on.")
        }
    }

    // repo L208-215: clearing the vendor on an ALREADY-locked master (not
    // also unlocking) hits rule 2 first, since `null !== before.preferred_vendor`
    // — verified against the JS reference implementation.
    func testClearVendorOnAlreadyLockedMasterHitsChangeVendorRule() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set(nil)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "Quality lock is on — unlock before changing vendor.")
        }
    }

    // setting the SAME vendor while locked is not a change → allowed
    func testSameVendorWhileLockedAllowed() throws {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set("sysco")
        XCTAssertNoThrow(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: "sysco", locked: 1), updates: u))
    }

    // Gap-fix edge case: clearing an ALREADY-nil vendor while locked is still
    // rejected — web `willBeLocked && updates.preferred_vendor === null` (repo L217)
    // fires regardless of whether the clear is a no-op.
    func testClearAlreadyNilVendorWhileLockedStillRejected() {
        var u = IngredientMasterUpdates(); u.preferredVendor = .set(nil)
        XCTAssertThrowsError(try IngredientMastersCompute.validateMasterUpdates(before: row(vendor: nil, locked: 1), updates: u)) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "Cannot clear preferred vendor while quality lock is on.")
        }
    }

    // ── field-validation matrix (route.js L84-144) — gap-fix ──

    func testClipOrNullEmptyStringBecomesNil() {
        XCTAssertNil(IngredientMastersCompute.clipOrNull("   ", max: 80))
        XCTAssertNil(IngredientMastersCompute.clipOrNull("", max: 80))
    }

    func testClipOrNullTrimsAndClipsLength() {
        XCTAssertEqual(IngredientMastersCompute.clipOrNull("  sysco  ", max: 80), "sysco")
        XCTAssertEqual(IngredientMastersCompute.clipOrNull(String(repeating: "x", count: 90), max: 80)?.count, 80)
    }

    func testClipOrNullNilPassesThrough() {
        XCTAssertNil(IngredientMastersCompute.clipOrNull(nil, max: 80))
    }

    func testCanonicalNameEmptyAfterTrimRejected() {
        // route.js L106: canonical_name cannot be empty after clipOrNull.
        XCTAssertThrowsError(try IngredientMastersCompute.validateCanonicalName("   ")) {
            guard case IngredientMasterWriteError.rejected(let m) = $0 else { return XCTFail("wrong error: \($0)") }
            XCTAssertEqual(m, "canonical_name cannot be empty")
        }
    }

    func testCanonicalNameNonEmptyClipsTo200() throws {
        let clipped = try IngredientMastersCompute.validateCanonicalName(String(repeating: "y", count: 250))
        XCTAssertEqual(clipped.count, 200)
    }
}
