"""
Lariat Invoice Processor Logic.
Maps vendor invoice items to internal ingredient IDs and reconciles units.
"""

import difflib
from typing import Any

CATCH_WEIGHT_THRESHOLD = 0.02  # 2% — deviation above this triggers reconciliation


def reconcile_catch_weight(
    catalog_wt_lb: float,
    actual_received_lb: float,
    invoice_total: float,
    *,
    threshold: float = CATCH_WEIGHT_THRESHOLD,
    tare_lb: float | None = None,
) -> dict[str, Any]:
    """Catch-weight reconciliation. When a vendor ships a pack whose actual
    weight differs from the catalog weight by more than ``threshold``, the
    invoiced dollars should be divided by the *actual* delivered weight
    rather than the catalog assumption. Example: a "10 lb case" of ribeye
    invoiced at $150 but weighed 10.4 lb at receiving gives a real unit
    price of $14.42/lb, not the naive $15.00/lb the catalog implies.

    Parameters
    ----------
    catalog_wt_lb : float
        Reference weight per pack from ``vendor_catch_weights`` (> 0).
    actual_received_lb : float
        Delivered weight per pack from the invoice (> 0).
    invoice_total : float
        Dollar amount invoiced for this pack (> 0).
    threshold : float, optional
        Fractional deviation above which ``reconciled=True``.
        Defaults to 2% (``CATCH_WEIGHT_THRESHOLD``).
    tare_lb : float | None, optional
        If provided and > 0, subtracted from ``actual_received_lb`` to
        compute net weight. Mirrors the ``tare_lb`` column on
        ``vendor_catch_weights``.

    Returns
    -------
    dict with keys:
        net_received_lb       -- actual_received_lb − (tare_lb or 0)
        deviation_pct         -- (net_received − catalog) / catalog
        unit_price_catalog    -- invoice_total / catalog_wt_lb
        unit_price_actual     -- invoice_total / net_received_lb
        reconciled_unit_price -- unit_price_actual when |deviation_pct|
                                  > threshold, else unit_price_catalog
                                  (this is what belongs in vendor_prices.
                                  reconciled_unit_price)
        reconciled            -- bool — did the actual deviate beyond
                                  threshold?

    Raises
    ------
    ValueError if any numeric input is non-positive or net_received_lb
    would be ≤ 0 after tare subtraction.
    """
    if not (isinstance(catalog_wt_lb, (int, float)) and catalog_wt_lb > 0):
        raise ValueError(f"catalog_wt_lb must be > 0, got {catalog_wt_lb!r}")
    if not (isinstance(actual_received_lb, (int, float)) and actual_received_lb > 0):
        raise ValueError(f"actual_received_lb must be > 0, got {actual_received_lb!r}")
    if not (isinstance(invoice_total, (int, float)) and invoice_total > 0):
        raise ValueError(f"invoice_total must be > 0, got {invoice_total!r}")
    if not (isinstance(threshold, (int, float)) and 0 <= threshold < 1):
        raise ValueError(f"threshold must be in [0, 1), got {threshold!r}")

    tare = float(tare_lb) if tare_lb else 0.0
    if tare < 0:
        raise ValueError(f"tare_lb must be >= 0 when set, got {tare_lb!r}")
    net_received_lb = float(actual_received_lb) - tare
    if net_received_lb <= 0:
        raise ValueError(
            f"net weight non-positive after tare subtraction: "
            f"actual={actual_received_lb} tare={tare}"
        )

    deviation_pct = (net_received_lb - catalog_wt_lb) / catalog_wt_lb
    unit_price_catalog = invoice_total / catalog_wt_lb
    unit_price_actual = invoice_total / net_received_lb
    reconciled = abs(deviation_pct) > threshold
    reconciled_unit_price = unit_price_actual if reconciled else unit_price_catalog

    return {
        "net_received_lb": net_received_lb,
        "deviation_pct": deviation_pct,
        "unit_price_catalog": unit_price_catalog,
        "unit_price_actual": unit_price_actual,
        "reconciled_unit_price": reconciled_unit_price,
        "reconciled": reconciled,
    }


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
        """Per-quantity unit cost + naive price-drift flag based on purchase
        history. Kept as-is for backwards compatibility with callers that
        want a simple total/qty with a 5% history-drift alert.

        Catch-weight reconciliation (invoice-weight vs catalog-weight) is a
        separate concern handled by the module-level ``reconcile_catch_weight``
        function, which takes per-pack delivered weight rather than
        aggregate invoice_qty. T5b will compose both when wiring into the
        real invoice ingest path.
        """
        unit_cost = invoice_total / invoice_qty if invoice_qty > 0 else 0

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
