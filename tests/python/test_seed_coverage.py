"""Live-BOM coverage check for the T2b yields seed CSV.

Asserts that every normalized ingredient key in the live ``bom_lines``
table has a row in ``data/seeds/ingredient_yields.csv`` — per
docs/MAPPING_ENGINE_GAPS.md this seed is claimed to be 100% complete.
T2c's JS acceptance test owns the looser >=50% gate for fresh DBs; this
test catches drift on the production checkout.

If the live DB isn't available (fresh clone, worktree on a different
host), the test skips — but prints the skip reason to stdout so it is
visible in default pytest output instead of silently looking like a pass.
"""
from __future__ import annotations

import csv
import sqlite3
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.lib.ingredient_key import normalize_one  # noqa: E402

# Live DB: per spec, always the main checkout, never the worktree copy.
LIVE_DB = Path("/Users/seanburdges/Dev/Lariat/data/lariat.db")
YIELDS_CSV = ROOT / "data" / "seeds" / "ingredient_yields.csv"


class SeedCoverageReporter(unittest.TestCase):
    def test_report_yield_coverage_over_bom(self) -> None:
        if not LIVE_DB.is_file():
            print(f"\nSKIP test_seed_coverage: live DB not found: {LIVE_DB}")
            self.skipTest(f"Live DB not found: {LIVE_DB}")

        # Read-only open — we never write to the live DB from tests.
        try:
            conn = sqlite3.connect(
                f"file:{LIVE_DB}?mode=ro", uri=True
            )
        except sqlite3.OperationalError as e:  # pragma: no cover
            print(f"\nSKIP test_seed_coverage: cannot open live DB: {e}")
            self.skipTest(f"Could not open live DB read-only: {e}")

        try:
            # Confirm the table exists (fresh DBs may be pre-schema).
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
            if "bom_lines" not in tables:
                self.skipTest("bom_lines table not present in live DB")

            raw_bom = conn.execute(
                "SELECT DISTINCT ingredient FROM bom_lines WHERE ingredient IS NOT NULL"
            ).fetchall()
        finally:
            conn.close()

        bom_keys = {normalize_one(row[0]) for row in raw_bom}
        bom_keys.discard("")

        if not YIELDS_CSV.is_file():
            self.skipTest(f"Yields CSV not present: {YIELDS_CSV}")

        yield_keys: set[str] = set()
        with YIELDS_CSV.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                key = normalize_one(row.get("ingredient_name", ""))
                if key:
                    yield_keys.add(key)

        covered = bom_keys & yield_keys
        n_bom = len(bom_keys)
        n_covered = len(covered)
        pct = (100.0 * n_covered / n_bom) if n_bom else 0.0

        missing_preview = sorted(bom_keys - yield_keys)[:20]

        print()
        print("=== T2b seed yield coverage over live BOM ===")
        print(f"live DB:       {LIVE_DB}")
        print(f"yields CSV:    {YIELDS_CSV}")
        print(f"unique BOM keys:       {n_bom}")
        print(f"covered by yield CSV:  {n_covered}")
        print(f"coverage %:            {pct:.1f}%")
        print(f"first 20 uncovered BOM keys: {missing_preview}")

        # Enforce the 100% claim in MAPPING_ENGINE_GAPS.md. A failure here
        # means a new BOM ingredient was added without a matching row in
        # data/seeds/ingredient_yields.csv — fix the seed or remove the
        # ingredient, don't weaken the assertion.
        self.assertEqual(
            n_covered, n_bom,
            msg=f"{n_bom - n_covered} uncovered BOM key(s); first missing: "
                f"{missing_preview}",
        )


if __name__ == "__main__":
    unittest.main()
