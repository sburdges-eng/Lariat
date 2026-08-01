#!/usr/bin/env python3
"""Surface the unmapped-ingredient queue as a reviewable worklist.

157 UNMAPPED + 28 NULL `bom_lines` carry no vendor link, so invoice cost never
reaches recipe cost for 37% of lines. `bom_lines.map_status` has recorded this
since the mapping engine landed but was never surfaced as a queue
(MAPPING_ENGINE_GAPS B2).

This writes that queue to CSV with a *proposal* per row. It never applies one.

Why proposals are deliberately timid
------------------------------------
A similarity-scored matcher was measured against the real catalog first. At a
0.55 Jaccard/difflib threshold roughly half its confident proposals were wrong,
because such scoring rewards the modifier rather than the head noun:

    pepper jack         -> PEPPER, JALP MINI PK          (cheese -> chilies)
    colby jack shredded -> Carrots Matchstick Shredded
    scallion whites     -> Corn White Fresh
    tomato sauce        -> Tomatillo Crushed

Accepting any of those puts a wrong unit cost into every dish containing the
ingredient — the failure mode CLAUDE.md §7 warns about, and worse than leaving
the line unmapped, because an unmapped line is visibly incomplete while a
wrongly-mapped one is silently incorrect.

So the rule is **containment, not similarity**: propose only when every
meaningful token of the recipe ingredient appears in the vendor description.
`old bay seasoning` ⊆ `SEASONING, OLD BAY` proposes; `pepper jack` finds no
vendor description containing both "pepper" and "jack" and stays silent. That
gives up recall, but the recall it gives up is guesswork, and a reviewer
reading a blank proposal loses nothing a wrong one would not have cost more.

Why some rows can never be mapped
---------------------------------
The queue is not one problem. Water is not purchased. Alcohol is not in the
Sysco/Shamrock catalog. Leaving those as UNMAPPED forever buries the lines that
genuinely need work, so they carry a terminal reason instead.

Usage
-----
    python scripts/build_mapping_worklist.py [--db data/lariat.db]
                                             [--out data/seeds/ingredient_map_worklist.csv]

Fill the `accept` column with the vendor description to use (or `none` to
confirm a terminal reason). Applying accepted rows is a separate step.
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'data' / 'lariat.db'
OUT = ROOT / 'data' / 'seeds' / 'ingredient_map_worklist.csv'

# Tokens shorter than this are joining words ('in', 'of') that carry no
# matching signal. 'bay', 'old' and 'oil' are three characters and must survive.
MIN_TOKEN = 3

# Matched as whole words, never as substrings. A naive `'gin' in name` check
# classified 'mozzarella ciliegine', 'extra-virgin olive oil' and (via 'rum')
# 'panko bread crumbs' as alcohol.
ALCOHOL_WORDS = frozenset({
    'guinness', 'beer', 'ale', 'lager', 'stout', 'wine', 'vodka', 'gin', 'rum',
    'whiskey', 'whisky', 'bourbon', 'tequila', 'mezcal', 'liqueur', 'sherry',
    'vermouth', 'brandy', 'cognac', 'champagne', 'prosecco', 'sake',
})

# Not purchased at all — these are utilities, not products. A zero-cost line is
# correct here; a vendor map never will be.
NOT_PURCHASABLE = frozenset({'water', 'ice', 'hot water', 'cold water', 'ice water'})

REASON_NOT_PURCHASABLE = 'not_purchasable'
REASON_OTHER_VENDOR = 'other_vendor'
REASON_NEEDS_MAP = 'needs_map'

FIELDNAMES = (
    'ingredient',
    'recipe_count',
    'line_count',
    'units',
    'reason',
    'proposed_vendor_ingredient',
    'alternates',
    'accept',
)


def normalize(text: str | None) -> str:
    """Lowercase, strip punctuation to spaces, collapse whitespace.

    Hyphens become spaces so 'extra-virgin' tokenizes as two words — needed for
    both matching and for the whole-word alcohol check.
    """
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', (text or '').lower())).strip()


def tokens(text: str | None) -> set[str]:
    return {t for t in normalize(text).split() if len(t) >= MIN_TOKEN}


def classify(ingredient: str) -> tuple[str, str]:
    """-> (reason, note). Terminal reasons never receive a proposal."""
    normalized = normalize(ingredient)
    if normalized in NOT_PURCHASABLE:
        return REASON_NOT_PURCHASABLE, 'not a purchased product'
    word_set = set(normalized.split())
    hits = word_set & ALCOHOL_WORDS
    if hits:
        return REASON_OTHER_VENDOR, f'beverage vendor ({", ".join(sorted(hits))})'
    return REASON_NEEDS_MAP, ''


def propose(ingredient: str, catalog: list[str]) -> list[tuple[str, float]]:
    """Vendor descriptions containing every meaningful ingredient token.

    Returns [] rather than a nearest guess. Ranked by how little extra the
    vendor description carries, so the tightest match sorts first: for
    'pork belly', `Pork Belly Skin On` beats a description with five more words.
    """
    wanted = tokens(ingredient)
    if not wanted:
        return []

    scored: list[tuple[str, float]] = []
    for description in catalog:
        available = tokens(description)
        if not available or not wanted <= available:
            continue
        # 1.0 when the vendor description says exactly what the recipe said.
        scored.append((description, round(len(wanted) / len(available), 3)))

    scored.sort(key=lambda row: (-row[1], row[0]))
    return scored


def build_rows(db_path: Path) -> list[dict]:
    con = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
    con.row_factory = sqlite3.Row
    try:
        # Leaf lines only. A sub-recipe line's cost comes from its own recipe,
        # so asking a vendor to price it would double-count.
        unmapped = con.execute(
            """SELECT ingredient, recipe_id, COALESCE(unit, '') AS unit
                 FROM bom_lines
                WHERE COALESCE(vendor_ingredient, '') = ''
                  AND COALESCE(sub_recipe, '') = ''
                  AND ingredient IS NOT NULL
                  AND TRIM(ingredient) <> ''""",
        ).fetchall()
        catalog = [
            row[0] for row in con.execute(
                'SELECT DISTINCT ingredient FROM vendor_prices WHERE ingredient IS NOT NULL',
            ).fetchall()
        ]
    finally:
        con.close()

    grouped: dict[str, dict] = defaultdict(
        lambda: {'recipes': set(), 'lines': 0, 'units': set(), 'label': ''},
    )
    for row in unmapped:
        entry = grouped[normalize(row['ingredient'])]
        entry['label'] = entry['label'] or row['ingredient']
        entry['recipes'].add(row['recipe_id'])
        entry['lines'] += 1
        if row['unit']:
            entry['units'].add(row['unit'])

    rows: list[dict] = []
    for key in sorted(grouped):
        entry = grouped[key]
        reason, _note = classify(entry['label'])
        proposals = propose(entry['label'], catalog) if reason == REASON_NEEDS_MAP else []
        rows.append({
            'ingredient': entry['label'],
            'recipe_count': len(entry['recipes']),
            'line_count': entry['lines'],
            'units': '|'.join(sorted(entry['units'])),
            'reason': reason,
            'proposed_vendor_ingredient': proposals[0][0] if proposals else '',
            'alternates': '|'.join(name for name, _ in proposals[1:4]),
            'accept': '',
        })
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--db', default=str(DB))
    parser.add_argument('--out', default=str(OUT))
    args = parser.parse_args(argv)

    db_path = Path(args.db)
    if not db_path.exists():
        # An empty worklist reads as "nothing left to map". Fail loudly.
        print(f'error: {db_path} does not exist', file=sys.stderr)
        return 1

    rows = build_rows(db_path)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, 'w', newline='', encoding='utf-8') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(FIELDNAMES))
        writer.writeheader()
        writer.writerows(rows)

    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        counts[row['reason']] += 1
    proposed = sum(1 for row in rows if row['proposed_vendor_ingredient'])
    needs = counts[REASON_NEEDS_MAP]

    print(f'{len(rows)} unmapped ingredient(s) -> {out_path}')
    print(f'  needs a map      : {needs}  ({proposed} with a proposal to review)')
    print(f'  not purchasable  : {counts[REASON_NOT_PURCHASABLE]}')
    print(f'  other vendor     : {counts[REASON_OTHER_VENDOR]}')
    if needs - proposed:
        print(f'  {needs - proposed} need a human — no vendor description contains every token')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
