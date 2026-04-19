"""Persist interactive checklist state (line checks, setup/teardown) to working CSVs.

State files live in workbook/working/{checklist_type}_{date}.csv.
Each row tracks one item's checked status, who checked it, and KM approval.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import pandas as pd

# Check if csv_file_lock exists for safe concurrent writes
try:
    from scripts.lib.csv_file_lock import csv_update_lock
except ImportError:
    from contextlib import nullcontext as csv_update_lock  # fallback: no locking


_STATE_COLUMNS = [
    "date", "station_id", "item", "check_type",
    "checked", "checked_by", "checked_at",
    "km_approved", "km_approved_by", "km_approved_at",
]


def _state_path(root: Path, checklist_type: str, date_str: str) -> Path:
    """Build the path for a checklist state file."""
    return root / "workbook" / "working" / f"{checklist_type}_{date_str}.csv"


def load_checklist(root: Path, checklist_type: str, date_str: str) -> pd.DataFrame:
    """Load checklist state from working CSV. Returns empty DataFrame if none exists."""
    p = _state_path(root, checklist_type, date_str)
    if p.exists():
        return pd.read_csv(p)
    return pd.DataFrame(columns=_STATE_COLUMNS)


def save_checklist(
    root: Path,
    checklist_type: str,
    date_str: str,
    items: list[dict],
    checked_by: str = "unknown",
) -> None:
    """Save checklist state. items is a list of dicts with station_id, item, check_type, checked (bool)."""
    p = _state_path(root, checklist_type, date_str)
    p.parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now().isoformat(timespec="seconds")
    rows = []
    for it in items:
        rows.append({
            "date": date_str,
            "station_id": it.get("station_id", ""),
            "item": it.get("item", ""),
            "check_type": it.get("check_type", ""),
            "checked": it.get("checked", False),
            "checked_by": checked_by if it.get("checked") else "",
            "checked_at": now if it.get("checked") else "",
            "km_approved": False,
            "km_approved_by": "",
            "km_approved_at": "",
        })

    df = pd.DataFrame(rows, columns=_STATE_COLUMNS)
    df.to_csv(p, index=False)


def approve_station(
    root: Path,
    checklist_type: str,
    date_str: str,
    station_id: str,
    approved_by: str,
) -> None:
    """KM approves all items for a station."""
    p = _state_path(root, checklist_type, date_str)
    if not p.exists():
        return
    df = pd.read_csv(p)
    now = datetime.now().isoformat(timespec="seconds")
    mask = df["station_id"] == station_id
    df.loc[mask, "km_approved"] = True
    df.loc[mask, "km_approved_by"] = approved_by
    df.loc[mask, "km_approved_at"] = now
    df.to_csv(p, index=False)


def station_summary(root: Path, checklist_type: str, date_str: str) -> list[dict]:
    """Return per-station summary: total items, checked count, approved status."""
    df = load_checklist(root, checklist_type, date_str)
    if df.empty:
        return []

    summaries = []
    for station, group in df.groupby("station_id"):
        total = len(group)
        checked = int(group["checked"].astype(bool).sum())
        approved = bool(group["km_approved"].astype(bool).all())
        approved_by = group["km_approved_by"].dropna().iloc[0] if approved and not group["km_approved_by"].dropna().empty else ""
        checked_by_list = group[group["checked"].astype(bool)]["checked_by"].dropna().unique().tolist()
        summaries.append({
            "station_id": station,
            "total": total,
            "checked": checked,
            "approved": approved,
            "approved_by": approved_by,
            "checked_by": ", ".join(checked_by_list),
        })
    return summaries
