"""Gate test for scripts/audit_recipe_bom.py on the live recipe corpus."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.audit_recipe_bom import run_audit  # noqa: E402


class RecipeBomAudit(unittest.TestCase):
    def test_live_corpus_passes_audit(self) -> None:
        errors = run_audit()
        self.assertEqual(errors, [], "\n".join(errors))


if __name__ == "__main__":
    unittest.main()
