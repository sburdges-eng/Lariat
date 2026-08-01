"""The unmapped-ingredient queue, and the matcher that is allowed to propose for it.

157 UNMAPPED + 28 NULL bom_lines carry no vendor link, so invoice cost never
reaches recipe cost for 37% of lines (MAPPING_ENGINE_GAPS B2, still open).

A similarity-scored matcher cannot close them. Measured against the real
catalog at a 0.55 Jaccard/ratio threshold, about half its confident proposals
were wrong, and wrong in the worst way — it scores on the modifier rather than
the head noun, so `pepper jack` matched `PEPPER, JALP MINI PK` and
`colby jack shredded` matched `Carrots Matchstick Shredded`. Accepting either
puts a wrong unit cost into every dish containing that ingredient.

So the rule here is containment, not similarity: propose only when every
meaningful token of the recipe ingredient appears in the vendor description.
Lower recall, and the recall it gives up is guesswork. The false positives
above are pinned as tests so a future "improvement" to the scorer has to keep
rejecting them.

The queue is also not one problem. Some lines can never carry a vendor map at
all — water is not purchased, alcohol is not in the Sysco/Shamrock catalog —
and leaving those as UNMAPPED forever hides the lines that genuinely need work.
They get an explicit terminal reason instead.
"""

import csv
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.build_mapping_worklist import (  # noqa: E402
    classify,
    main,
    propose,
)

# Real catalog descriptions, both vendor house styles: Sysco writes
# "CATEGORY, DESCRIPTOR", Shamrock writes "Title Case Words".
CATALOG = [
    'SEASONING, OLD BAY',
    'PEPPER, JALP MINI PK',
    'PEPPER, CHIPOTLE IN ADOBO SCE',
    'CINNAMON, GRND',
    'Basil Fresh Herb',
    'Carrots Matchstick Shredded',
    'Corn White Fresh',
    'Tomatillo Crushed',
    'SAUCE, CHILI SWEET',
    'Pork Belly Skin On',
    'CHEESE, MONTEREY JACK SHRD',
]


class TestProposeAcceptsRealMatches:
    """Every one of these is a true match a reviewer should see."""

    @pytest.mark.parametrize('ingredient,expected', [
        ('old bay seasoning', 'SEASONING, OLD BAY'),
        ('cinnamon', 'CINNAMON, GRND'),
        ('basil fresh', 'Basil Fresh Herb'),
        ('chipotle in adobo', 'PEPPER, CHIPOTLE IN ADOBO SCE'),
        ('pork belly', 'Pork Belly Skin On'),
    ])
    def test_proposes_the_right_product(self, ingredient, expected):
        got = propose(ingredient, CATALOG)
        assert got, f'{ingredient!r} should have produced a proposal'
        assert got[0][0] == expected


class TestProposeRejectsTheFalsePositives:
    """The naive scorer's confident errors. Each would corrupt a dish cost."""

    @pytest.mark.parametrize('ingredient,must_not_propose', [
        ('pepper jack', 'PEPPER, JALP MINI PK'),           # cheese -> chilies
        ('colby jack shredded', 'Carrots Matchstick Shredded'),
        ('scallion whites', 'Corn White Fresh'),
        ('tomato sauce', 'Tomatillo Crushed'),
    ])
    def test_does_not_propose_the_wrong_product(self, ingredient, must_not_propose):
        proposed = [name for name, _ in propose(ingredient, CATALOG)]
        assert must_not_propose not in proposed, (
            f'{ingredient!r} must not be matched to {must_not_propose!r}'
        )

    def test_silence_is_the_correct_answer(self):
        """No plausible match must yield no proposal, not the nearest thing."""
        assert propose('furikake seasoning', CATALOG) == []


class TestClassify:
    """Lines that can never carry a vendor map get a terminal reason."""

    @pytest.mark.parametrize('ingredient,reason', [
        ('water', 'not_purchasable'),
        ('guinness', 'other_vendor'),
        ('vodka', 'other_vendor'),
        ('dry white wine', 'other_vendor'),
    ])
    def test_terminal_reasons(self, ingredient, reason):
        assert classify(ingredient)[0] == reason

    @pytest.mark.parametrize('ingredient', [
        'panko bread crumbs',      # 'rum' inside 'crumbs'
        'mozzarella ciliegine',    # 'gin' inside 'ciliegine'
        'extra-virgin olive oil',  # 'gin' inside 'virgin'
    ])
    def test_substring_matching_does_not_create_false_alcohol(self, ingredient):
        """The bug this classifier was written to avoid: naive `in` checks
        called three ordinary groceries alcohol."""
        assert classify(ingredient)[0] == 'needs_map'

    def test_ordinary_groceries_need_a_map(self):
        for ing in ('capers', 'soy sauce', 'lemons', 'white onion'):
            assert classify(ing)[0] == 'needs_map'


class TestWorklistOutput:
    @pytest.fixture
    def db(self, tmp_path):
        path = tmp_path / 'lariat.db'
        con = sqlite3.connect(str(path))
        con.executescript("""
            CREATE TABLE bom_lines (
              id INTEGER PRIMARY KEY, recipe_id TEXT, ingredient TEXT, qty REAL,
              unit TEXT, sub_recipe TEXT, vendor_ingredient TEXT,
              map_status TEXT, location_id TEXT DEFAULT 'default');
            CREATE TABLE vendor_prices (
              id INTEGER PRIMARY KEY, ingredient TEXT, vendor TEXT,
              pack_price REAL, location_id TEXT DEFAULT 'default');
        """)
        con.executemany(
            "INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe,"
            " vendor_ingredient, map_status) VALUES (?,?,?,?,?,?,?)",
            [
                ('r1', 'old bay seasoning', 2, 'tbsp', '', '', 'UNMAPPED'),
                ('r1', 'water', 1, 'qt', '', '', 'UNMAPPED'),
                ('r2', 'guinness', 1, 'cup', '', '', None),
                ('r2', 'pepper jack', 4, 'oz', '', '', 'UNMAPPED'),
                # already mapped — must not appear in the worklist
                ('r3', 'cinnamon', 1, 'tsp', '', 'CINNAMON, GRND', 'mapped'),
                # a sub-recipe line is not a vendor-map question
                ('r3', 'blackened salsa', 1, 'cup', 'blackened-salsa', '', 'UNMAPPED'),
            ],
        )
        con.executemany(
            "INSERT INTO vendor_prices (ingredient, vendor, pack_price) VALUES (?,?,?)",
            [(name, 'sysco', 10.0) for name in CATALOG],
        )
        con.commit()
        con.close()
        return path

    def test_writes_one_row_per_unmapped_leaf_ingredient(self, db, tmp_path):
        out = tmp_path / 'worklist.csv'
        assert main(['--db', str(db), '--out', str(out)]) == 0
        rows = list(csv.DictReader(open(out, encoding='utf-8')))
        ingredients = {r['ingredient'] for r in rows}
        assert ingredients == {'old bay seasoning', 'water', 'guinness', 'pepper jack'}, (
            'mapped lines and sub-recipe lines must be excluded'
        )

    def test_carries_the_proposal_and_leaves_the_decision_blank(self, db, tmp_path):
        out = tmp_path / 'worklist.csv'
        main(['--db', str(db), '--out', str(out)])
        by = {r['ingredient']: r for r in csv.DictReader(open(out, encoding='utf-8'))}
        assert by['old bay seasoning']['proposed_vendor_ingredient'] == 'SEASONING, OLD BAY'
        # A proposal is never a decision. The reviewer fills this in.
        assert by['old bay seasoning']['accept'] == ''

    def test_terminal_rows_carry_no_proposal(self, db, tmp_path):
        out = tmp_path / 'worklist.csv'
        main(['--db', str(db), '--out', str(out)])
        by = {r['ingredient']: r for r in csv.DictReader(open(out, encoding='utf-8'))}
        assert by['water']['reason'] == 'not_purchasable'
        assert by['water']['proposed_vendor_ingredient'] == ''
        assert by['guinness']['reason'] == 'other_vendor'

    def test_pepper_jack_reaches_the_reviewer_with_no_proposal(self, db, tmp_path):
        """The whole point: it is queued for a human, not silently guessed."""
        out = tmp_path / 'worklist.csv'
        main(['--db', str(db), '--out', str(out)])
        by = {r['ingredient']: r for r in csv.DictReader(open(out, encoding='utf-8'))}
        assert by['pepper jack']['reason'] == 'needs_map'
        assert by['pepper jack']['proposed_vendor_ingredient'] == ''

    def test_rerun_is_stable(self, db, tmp_path):
        out = tmp_path / 'worklist.csv'
        main(['--db', str(db), '--out', str(out)])
        first = out.read_text(encoding='utf-8')
        main(['--db', str(db), '--out', str(out)])
        assert out.read_text(encoding='utf-8') == first

    def test_absent_db_is_an_error_not_an_empty_worklist(self, tmp_path):
        """An empty worklist would read as 'nothing left to map'."""
        assert main(['--db', str(tmp_path / 'nope.db'),
                     '--out', str(tmp_path / 'w.csv')]) == 1
