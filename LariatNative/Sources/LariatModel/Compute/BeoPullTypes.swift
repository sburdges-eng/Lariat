// BeoPullTypes — data model for the in-process BEO order-pull (Native 0.2 L1
// Wave B), a Swift port of `scripts/lib/beo_pull.py`.
//
// Output rows reuse the existing public Cascade* types from BeoCascadeClient
// (same shapes as the Python dicts): CascadeOrderGuideRow == OrderLine,
// CascadeUnmappedRow == Unmapped. Only the pull-specific inputs live here.

import Foundation

/// One BEO invoice line: a menu item and a count. `unit` is used only in
/// `qtyInYieldUnits` mode (mirrors Python `InvoiceRow.unit`, default "").
public struct InvoiceRow: Equatable, Sendable {
    public let menuItem: String
    public let qty: Double
    public let unit: String

    public init(menuItem: String, qty: Double, unit: String = "") {
        self.menuItem = menuItem
        self.qty = qty
        self.unit = unit
    }
}

/// Key for the per-mapping scale (`per_count`) table: (normalized menu item, slug).
public struct BeoScaleKey: Hashable, Sendable {
    public let nameKey: String
    public let slug: String

    public init(nameKey: String, slug: String) {
        self.nameKey = nameKey
        self.slug = slug
    }
}
