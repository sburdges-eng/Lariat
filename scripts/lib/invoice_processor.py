"""
Lariat Invoice Processor Logic.
Maps vendor invoice items to internal ingredient IDs and reconciles units.
"""

import difflib
from typing import Any


class InvoiceProcessor:
    def __init__(
        self,
        master_catalog: list[dict[str, Any]],
        purchase_history: list[dict[str, Any]],
    ):
        """
        master_catalog: List of dicts with 'ingredient_id', 'description', 'vendor_sku'
        purchase_history: List of dicts with 'vendor_sku', 'unit_cost', 'unit'
        """
        self.catalog = master_catalog
        self.history = purchase_history

    def find_id_by_sku(self, vendor_sku: str) -> str | None:
        for item in self.catalog:
            if str(item.get("vendor_sku")) == str(vendor_sku):
                val = item.get("ingredient_id")
                return str(val) if val is not None else None
        return None

    def fuzzy_match_description(self, vendor_desc: str, threshold: float = 0.6) -> str | None:
        descriptions = [item["description"].upper() for item in self.catalog]
        matches = difflib.get_close_matches(
            vendor_desc.upper(), descriptions, n=1, cutoff=threshold
        )
        if matches:
            for item in self.catalog:
                if item["description"].upper() == matches[0]:
                    return str(item["ingredient_id"])
        return None

    def reconcile_unit_cost(
        self,
        ingredient_id: str,
        invoice_qty: float,
        invoice_unit: str,
        invoice_total: float,
    ) -> dict[str, Any]:
        """
        Reconciles invoice units with catalog units.
        Returns true unit cost and any price drift flags.
        """
        # Logic to be expanded based on pack_size reconciliation (libs/units.py)
        unit_cost = invoice_total / invoice_qty if invoice_qty > 0 else 0

        # Check against last purchase history for drift
        prev_prices = [h["unit_cost"] for h in self.history if h.get("vendor_sku") == ingredient_id]
        drift_flag = False
        if prev_prices:
            last_price = prev_prices[-1]
            if last_price > 0 and (unit_cost / last_price) > 1.05:
                drift_flag = True

        return {
            "ingredient_id": ingredient_id,
            "reconciled_unit_cost": unit_cost,
            "invoice_unit": invoice_unit,
            "price_drift_alert": drift_flag,
        }
