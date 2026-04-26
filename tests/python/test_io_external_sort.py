"""Unit tests for ``scripts.datapack._io.external_sort_jsonl``.

Covers the cases the per-source normalizer tests don't reach directly
because the helper is now their shared backbone:

- multi-chunk merge produces a globally-sorted output
- dedup_by_key=True keeps the first occurrence per key (chunk-flush order)
- on_emit fires once per emitted row, never on a duplicate
- empty source still produces an empty atomic output and zero counts
- mixed key_types (str, int) sort lexicographically by component
- unsupported key types are rejected with a ValueError at call time
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.datapack._io import external_sort_jsonl  # noqa: E402


def _read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


class ExternalSortJsonlTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.out_dir = self.root / "out"
        self.out_dir.mkdir()
        self.tmp_dir = self.root / "tmp"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    # ------------------------------------------------------------------
    # 1. Multi-chunk merge produces a globally-sorted output
    # ------------------------------------------------------------------
    def test_multi_chunk_merge_produces_globally_sorted_output(self) -> None:
        # 7 rows with chunk_rows=2 → 4 chunks (2,2,2,1). Source order is
        # intentionally interleaved so each chunk is locally unsorted relative
        # to its neighbors; only a true cross-chunk merge produces ascending.
        source = [
            ((5,), json.dumps({"id": 5})),
            ((1,), json.dumps({"id": 1})),
            ((6,), json.dumps({"id": 6})),
            ((2,), json.dumps({"id": 2})),
            ((4,), json.dumps({"id": 4})),
            ((3,), json.dumps({"id": 3})),
            ((7,), json.dumps({"id": 7})),
        ]
        out_path = self.out_dir / "rows.jsonl"
        emitted, dup = external_sort_jsonl(
            iter(source),
            out_path,
            chunk_rows=2,
            tmp_dir=self.tmp_dir,
            key_types=(int,),
        )
        self.assertEqual(emitted, 7)
        self.assertEqual(dup, 0)
        ids = [json.loads(line)["id"] for line in _read_lines(out_path)]
        self.assertEqual(ids, [1, 2, 3, 4, 5, 6, 7])

    # ------------------------------------------------------------------
    # 2. dedup_by_key=True keeps first occurrence (chunk-flush order)
    # ------------------------------------------------------------------
    def test_dedup_by_key_keeps_first_occurrence_across_chunks(self) -> None:
        # Three rows with code "A": one in chunk 0, one in chunk 1, one in
        # chunk 2. The chunk_idx tie-break must pick chunk 0's row, which
        # contains label="first". Other codes scattered around to force a
        # real cross-chunk merge.
        source = [
            (("A",), json.dumps({"code": "A", "label": "first"})),
            (("B",), json.dumps({"code": "B", "label": "first"})),
            (("A",), json.dumps({"code": "A", "label": "second"})),
            (("C",), json.dumps({"code": "C", "label": "first"})),
            (("A",), json.dumps({"code": "A", "label": "third"})),
            (("B",), json.dumps({"code": "B", "label": "second"})),
        ]
        out_path = self.out_dir / "rows.jsonl"
        emitted, dup = external_sort_jsonl(
            iter(source),
            out_path,
            chunk_rows=2,
            tmp_dir=self.tmp_dir,
            key_types=(str,),
            dedup_by_key=True,
        )
        self.assertEqual(emitted, 3)
        # 6 input rows, 3 unique codes -> 3 emitted, 3 duplicates skipped.
        self.assertEqual(dup, 3)
        rows = [json.loads(line) for line in _read_lines(out_path)]
        # Sorted by code, first occurrence wins.
        self.assertEqual(
            rows,
            [
                {"code": "A", "label": "first"},
                {"code": "B", "label": "first"},
                {"code": "C", "label": "first"},
            ],
        )

    # ------------------------------------------------------------------
    # 3. on_emit callback fires per emitted row only
    # ------------------------------------------------------------------
    def test_on_emit_fires_per_emitted_row_and_not_for_duplicates(self) -> None:
        events: list[tuple[tuple, str]] = []

        def _hook(key: tuple, line: str) -> None:
            events.append((key, line))

        source = [
            ((1,), json.dumps({"id": 1, "n": "a"})),
            ((2,), json.dumps({"id": 2, "n": "a"})),
            ((1,), json.dumps({"id": 1, "n": "b"})),  # dup, should NOT fire
            ((3,), json.dumps({"id": 3, "n": "a"})),
            ((2,), json.dumps({"id": 2, "n": "b"})),  # dup, should NOT fire
        ]
        out_path = self.out_dir / "rows.jsonl"
        emitted, dup = external_sort_jsonl(
            iter(source),
            out_path,
            chunk_rows=2,
            tmp_dir=self.tmp_dir,
            key_types=(int,),
            dedup_by_key=True,
            on_emit=_hook,
        )
        self.assertEqual(emitted, 3)
        self.assertEqual(dup, 2)
        # Hook saw exactly the 3 emitted rows, in output (sorted) order, and
        # each line matches the row that was actually written.
        self.assertEqual(len(events), 3)
        keys_seen = [k for k, _ in events]
        self.assertEqual(keys_seen, [(1,), (2,), (3,)])
        # Each event's line is the first-occurrence line (n=="a").
        for _key, line in events:
            self.assertEqual(json.loads(line)["n"], "a")

    # ------------------------------------------------------------------
    # 4. Empty source still produces an empty atomic output
    # ------------------------------------------------------------------
    def test_empty_source_produces_empty_output(self) -> None:
        out_path = self.out_dir / "rows.jsonl"
        emitted, dup = external_sort_jsonl(
            iter([]),
            out_path,
            chunk_rows=10,
            tmp_dir=self.tmp_dir,
            key_types=(int,),
        )
        self.assertEqual(emitted, 0)
        self.assertEqual(dup, 0)
        self.assertTrue(out_path.exists())
        self.assertEqual(out_path.read_text(encoding="utf-8"), "")
        # The .tmp file should NOT linger after atomic_replace.
        self.assertFalse(
            out_path.with_suffix(out_path.suffix + ".tmp").exists()
        )

    # ------------------------------------------------------------------
    # 5. Mixed key types (str, int) sort lexicographically by component
    # ------------------------------------------------------------------
    def test_mixed_key_types_sort_by_tuple_components(self) -> None:
        source = [
            (("apple", 2), json.dumps({"f": "apple", "n": 2})),
            (("banana", 1), json.dumps({"f": "banana", "n": 1})),
            (("apple", 1), json.dumps({"f": "apple", "n": 1})),
            (("banana", 3), json.dumps({"f": "banana", "n": 3})),
            (("apple", 10), json.dumps({"f": "apple", "n": 10})),
        ]
        out_path = self.out_dir / "rows.jsonl"
        emitted, dup = external_sort_jsonl(
            iter(source),
            out_path,
            chunk_rows=2,
            tmp_dir=self.tmp_dir,
            key_types=(str, int),
        )
        self.assertEqual(emitted, 5)
        self.assertEqual(dup, 0)
        rows = [json.loads(line) for line in _read_lines(out_path)]
        self.assertEqual(
            rows,
            [
                # Ordered by str asc, then int asc — note 2 < 10 because the
                # second key is parsed back to int (not the lexicographic
                # "10" < "2" trap a string-typed key would fall into).
                {"f": "apple", "n": 1},
                {"f": "apple", "n": 2},
                {"f": "apple", "n": 10},
                {"f": "banana", "n": 1},
                {"f": "banana", "n": 3},
            ],
        )

    # ------------------------------------------------------------------
    # 6. Unsupported key types are rejected at call time
    # ------------------------------------------------------------------
    def test_unsupported_key_type_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            external_sort_jsonl(
                iter([]),
                self.out_dir / "rows.jsonl",
                chunk_rows=10,
                tmp_dir=self.tmp_dir,
                key_types=(float,),  # not in _SUPPORTED_KEY_PARSERS
            )


if __name__ == "__main__":
    unittest.main()
