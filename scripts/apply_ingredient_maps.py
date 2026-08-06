#!/usr/bin/env python3
"""Apply reviewed ingredient maps from the worklist into `ingredient_maps`.

The write half of the MAPPING_ENGINE_GAPS B2 queue.
`build_mapping_worklist.py` proposes and never applies; this reads the `accept`
column a human filled in and writes the maps.
`scripts/enrich-bom-vendor-columns.mjs` then propagates them onto `bom_lines`.

A proposal is not a decision
----------------------------
Only `accept` is ever read. `proposed_vendor_ingredient` is ignored entirely,
so a row the reviewer skipped stays unmapped rather than silently taking the
machine's guess. That separation is the point of the two-step design, and it is
not a formality: the proposal for `vanilla` was `Cookie Vanilla Wafer` — wafer
cookies, not extract — and it took a human reading it to catch that.

`none` is a decision too. It records "reviewed, deliberately not mapped" and
writes nothing, so a genuinely unbuyable ingredient stops reappearing in the
queue as unreviewed work.

Bad accepts fail the batch, not the row
---------------------------------------
An `accept` naming a vendor description absent from `vendor_prices` is a typo,
not a new product. Writing it would create a map that can never resolve to a
price — indistinguishable from a working map until someone reads the resulting
cost and finds it silently low. The whole batch aborts so a partial application
never leaves the operator guessing what landed.

Usage
-----
    python scripts/apply_ingredient_maps.py --worklist data/seeds/ingredient_map_worklist.csv
    python scripts/apply_ingredient_maps.py --worklist ... --dry-run

Then re-run the enricher to push the maps onto bom_lines:

    node --experimental-strip-types scripts/enrich-bom-vendor-columns.mjs
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'data' / 'lariat.db'
WORKLIST = ROOT / 'data' / 'seeds' / 'ingredient_map_worklist.csv'

# Written on every map this script creates, so an operator-reviewed map is
# distinguishable from one the sync path inferred.
STATUS_REVIEWED = 'mapped'

NO_MAP = {'none', 'no', 'skip', 'n/a'}


def normalize(text: str | None) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', (text or '').lower())).strip()


def read_decisions(worklist_path: Path) -> list[dict]:
    """-> rows whose `accept` names a product. Blank and `none` are dropped."""
    with open(worklist_path, newline='', encoding='utf-8-sig') as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames or []
        if 'accept' not in columns:
            raise ValueError(
                f'{worklist_path.name} has no `accept` column — is this a worklist?')
        if 'ingredient' not in columns:
            raise ValueError(f'{worklist_path.name} has no `ingredient` column')
        decisions = []
        for row in reader:
            accepted = (row.get('accept') or '').strip()
            ingredient = (row.get('ingredient') or '').strip()
            if not ingredient or not accepted or accepted.lower() in NO_MAP:
                continue
            decisions.append({'ingredient': ingredient, 'accept': accepted})
        return decisions


def validate(decisions: list[dict], catalog: list[str]) -> list[str]:
    """-> error strings. An accept must name a real vendor_prices description."""
    known = {normalize(c): c for c in catalog}
    errors = []
    for decision in decisions:
        if normalize(decision['accept']) not in known:
            errors.append(
                f"{decision['ingredient']!r}: accepted {decision['accept']!r}, "
                'which is not a description in vendor_prices'
            )
    return errors


def apply_maps(db_path: Path, decisions: list[dict], location_id: str = 'default') -> dict:
    con = sqlite3.connect(str(db_path))
    summary = {'written': 0, 'updated': 0}
    try:
        con.execute('BEGIN')
        for decision in decisions:
            existing = con.execute(
                'SELECT vendor_ingredient FROM ingredient_maps'
                ' WHERE recipe_ingredient = ? AND location_id = ?',
                (decision['ingredient'], location_id),
            ).fetchone()
            if existing is None:
                con.execute(
                    'INSERT INTO ingredient_maps'
                    ' (recipe_ingredient, vendor_ingredient, status, location_id)'
                    ' VALUES (?, ?, ?, ?)',
                    (decision['ingredient'], decision['accept'], STATUS_REVIEWED, location_id),
                )
                summary['written'] += 1
            elif existing[0] != decision['accept']:
                # A corrected decision must replace the old one — that is how a
                # reviewer fixes a map they got wrong the first time.
                con.execute(
                    'UPDATE ingredient_maps SET vendor_ingredient = ?, status = ?'
                    ' WHERE recipe_ingredient = ? AND location_id = ?',
                    (decision['accept'], STATUS_REVIEWED,
                     decision['ingredient'], location_id),
                )
                summary['updated'] += 1
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--worklist', default=str(WORKLIST))
    parser.add_argument('--db', default=str(DB))
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args(argv)

    worklist_path, db_path = Path(args.worklist), Path(args.db)
    for path, label in ((worklist_path, 'worklist'), (db_path, 'db')):
        if not path.exists():
            print(f'error: {label} {path} does not exist', file=sys.stderr)
            return 1

    decisions = read_decisions(worklist_path)
    if not decisions:
        print(f'{worklist_path.name}: no accepted rows — nothing to apply')
        return 0

    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    try:
        catalog = [r[0] for r in con.execute(
            'SELECT DISTINCT ingredient FROM vendor_prices WHERE ingredient IS NOT NULL')]
    finally:
        con.close()

    errors = validate(decisions, catalog)
    if errors:
        print(f'error: {len(errors)} accepted row(s) name a product that does not exist:',
              file=sys.stderr)
        for message in errors:
            print(f'  {message}', file=sys.stderr)
        print('  nothing applied — fix the worklist and re-run', file=sys.stderr)
        return 1

    print(f'{worklist_path.name}: {len(decisions)} accepted map(s)')
    if args.dry_run:
        for decision in decisions:
            print(f"  {decision['ingredient']} -> {decision['accept']}")
        print('  dry run — nothing written')
        return 0

    summary = apply_maps(db_path, decisions)
    print(f"  wrote {summary['written']}, updated {summary['updated']}")
    print('  next: node --experimental-strip-types scripts/enrich-bom-vendor-columns.mjs')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
