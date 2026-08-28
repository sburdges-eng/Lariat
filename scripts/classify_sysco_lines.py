#!/usr/bin/env python3
"""Classify Sysco line items as food, beverage, or non-food.

Why this exists
---------------
The food cost numerator is not "everything Sysco billed". Sysco delivers three
different kinds of thing on one invoice:

- **food** — the numerator for food cost
- **beverage** — non-alcoholic beverage, which most operators cost on its own
  line, not inside food
- **non-food** — paper, disposables, cleaning chemicals, smallwares. Not COGS at
  all.

An earlier estimate treated nearly all Sysco spend as food and produced a
15–46% range that was simply wrong. This script exists so that never has to be
guessed again.

How it avoids the obvious trap
------------------------------
Keyword classifiers on product descriptions fail on collisions. "Onions White
Jumbo Bag" contains *bag*; "Cleaner Grill And Panini" contains *panini*; "Pan
Foil Steam Table" contains *pan*. A first-match-wins rule list quietly resolves
these in whatever order the author happened to write, and the error is invisible
in the total.

So this does not resolve collisions silently. Every description is tested
against **all** rule sets. A description matching more than one bucket is
reported as a CONFLICT and must be resolved by an explicit override in
`OVERRIDES` before it counts. A description matching none is reported as
UNCLASSIFIED. Neither is silently folded into food — food is the numerator, and
quietly defaulting to it inflates the number being measured.

Beverage is reported separately rather than merged, because the denominator
convention is not yet known: Toast may or may not book non-alcoholic beverage
inside food sales. Both a strict food figure and a food+beverage figure are
printed so the numerator can be matched to whatever the sales export turns out
to use.

Usage
-----
    python scripts/classify_sysco_lines.py data/costing/sysco/backfill_lines.csv \
        -o data/costing/sysco/backfill_classified.csv
"""

from __future__ import annotations

import argparse
import collections
import csv
import sys
from pathlib import Path

# Specific enough not to collide with food. Deliberately avoids bare 'bag',
# 'pan', 'cup', 'box' and 'wrap', all of which appear inside food descriptions.
NON_FOOD = (
    'liner trash', 'can liner', 'trash liner', 'liner 39', 'liner high',
    'cleaner', 'degreaser', 'sanitizer', 'detergent', 'soap', 'bleach',
    'delimer', 'scour', 'sponge', 'grill brick', 'brick grill', 'polish',
    'napkin', 'glove', 'towel', 'tissue', 'doily', 'cutlery', 'straw',
    'apron', 'mitt', 'broom', 'mop ', 'brush', 'squeegee', 'dust pan',
    'container', 'pan foil', 'foil steam', 'foil roll', 'film plastic',
    # 'foil aluminum' and 'film pvc' are separate entries because the real
    # descriptions read "Foil Aluminum Roll ..." and "Film Pvc 18 Inch ...",
    # so 'foil roll' never matches contiguously and 'roll' hits bread roll
    # instead. Caught by the Sysco-taxonomy cross-check, not by the rules.
    'foil aluminum', 'film pvc', 'pvc',
    'plastic film', 'wrap plastic', 'plastic wrap', 'portion cup',
    'souffle cup', 'cup plastic', 'cup paper', 'cup hot', 'cup cold',
    'lid dome', 'lid flat', 'lid portion', 'clamshell', 'ticket', 'label',
    'filter coffee', 'bag ziploc', 'bag poly', 'bag can', 'guest check',
    'sleeve', 'stir stick', 'toothpick', 'skewer bamboo', 'butcher paper',
    'parchment', 'pan liner', 'deodorizer', 'air freshener', 'urinal',
    'toilet', 'chafing fuel', 'sterno',
)

# Non-alcoholic beverage. Sysco delivers no liquor, so this is soda, juice,
# energy drink, coffee and tea — plus the nectars and 100% juices that are in
# practice bar mixers here.
BEVERAGE = (
    'drink energy', 'red bull', 'soda', 'cola', 'lemonade', 'tonic',
    'ginger beer', 'juice', 'nectar', 'coffee', 'tea ', ' tea', 'espresso',
    'water bottle', 'bottled water', 'sparkling water', 'club soda',
    'energy drink', 'beverage',
)

# Positive food signals. Not exhaustive on its own — anything unmatched is
# reported rather than assumed.
FOOD = (
    # protein
    'beef', 'pork', 'bacon', 'ham ', 'sausage', 'brisket', 'chorizo', 'patty',
    'salami', 'prosciutto', 'lamb', 'veal', 'shank', 'chicken', 'turkey',
    'poultry', 'duck', 'fish', 'shrimp', 'salmon', 'trout', 'crab',
    'pangasius', 'basa', 'cod', 'catfish', 'tilapia', 'scallop', 'oyster',
    'anchovy', 'calamari', 'elk', 'bison',
    # dairy / egg
    'cheese', 'milk', 'cream', 'butter', 'yogurt', 'queso', 'egg',
    'half and half',
    # produce
    'lettuce', 'tomato', 'tomatillo', 'onion', 'shallot', 'avocado',
    'cilantro', 'chive', 'parsley', 'basil', 'rosemary', 'thyme', 'tarragon',
    'oregano', 'mint', 'herb', 'lime', 'lemon', 'jalapeno', 'poblano',
    'chile', 'pepper', 'potato', 'cucumber', 'garlic', 'ginger', 'celery',
    'carrot', 'asparagus', 'cabbage', 'spinach', 'kale', 'mushroom',
    'broccoli', 'squash', 'melon', 'berry', 'berries', 'apple', 'orange',
    'banana', 'produce', 'salad', 'spring mix', 'greens', 'peach', 'pear',
    'grape', 'vegetable', 'corn', 'pea ', 'bean', 'radish', 'beet',
    'cauliflower', 'zucchini', 'arugula', 'sprout', 'jicama', 'plantain',
    # bakery / dry / pantry
    'flour', 'sugar', 'rice', 'spice', 'oil', 'shortening', 'vinegar',
    'sauce', 'mayonnaise', 'mayo', 'mustard', 'ketchup', 'dressing', 'syrup',
    'honey', 'seasoning', 'pasta', 'noodle', 'cavatappi', 'bread', 'bun',
    'tortilla', 'chip', 'pretzel', 'cracker', 'cake', 'churro', 'pudding',
    'cookie', 'batter', 'broth', 'stock', 'salt', 'roll', 'bagel', 'muffin',
    'brownie', 'pie ', 'dough', 'yeast', 'baking', 'cornbread', 'crouton',
    'granola', 'oat', 'cereal', 'nut', 'almond', 'pecan', 'walnut', 'seed',
    'olive', 'pickle', 'relish', 'salsa', 'guacamole', 'hummus', 'jam',
    'jelly', 'preserve', 'chocolate', 'vanilla', 'cinnamon', 'cumin',
    'paprika', 'garni', 'base', 'mix', 'blend', 'fry', 'fries', 'tender',
    'wing', 'cheek', 'cutlet', 'fillet', 'loin', 'rib', 'roast',
)

# Explicit human decisions. A description listed here is classified as stated
# and never re-derived. This is the only sanctioned way to resolve a CONFLICT —
# so the reasoning is recorded in the repo rather than buried in rule ordering.
OVERRIDES = {
    # --- product name reads like the wrong thing -------------------------------
    # Frying oil is a cooking ingredient and belongs in food cost, not supplies,
    # despite the chemical-sounding name and having no edible identity alone.
    'Fry On Shortening Frying Liquid': 'food',
    # A cleaning chemical; 'panini' is incidental to the product name.
    'Cleaner Grill And Panini High Temperature': 'non_food',
    # Disposable foil pans — not cookware, not food.
    'Pan Foil Steam Table 2.56 Inch Deep': 'non_food',
    # A lobby dustpan. 'Pan Dust' reads like a bakery release agent.
    'Pan Dust With Handle Lobby Plastic 13"l': 'non_food',

    # --- substring collisions the detector caught ------------------------------
    # 'choCOLAte' contains 'cola'. The single largest misclassification risk in
    # the set at over $1k — it would have been filed as beverage.
    'Cake Chocolate Fudge 10 Inch': 'food',
    # 'toilet' contains 'oil'.
    'Tissue Toilet 3.8 Inch X 4 Inch Wrapped 2 Ply': 'non_food',
    # Same product from a marketplace seller, whose descriptions are shouted
    # and shaped differently from Sysco's own — so the override has to be
    # written again rather than reused. 'toilet' contains 'oil'; '20 ROLLS'
    # contains 'roll'.
    'TISSUE TOILET TOILET PAPER - 20 ROLLS': 'non_food',
    # 'bleached' flour contains 'bleach'.
    'Flour All Purpose Hotel & Restaurant Bleached': 'food',
    # 'fryer' contains 'fry'.
    'Cleaner Fryer Boil Out Ready To Use': 'non_food',
    # 'roll' of labels/towels/wrap is not a bread roll. The film and foil rolls
    # were found by cross-checking against Sysco's own category taxonomy, not by
    # the rules — they were silently counted as food until then.
    'Film Pvc 18 Inchx2000 Feet Roll': 'non_food',
    'Film Pvc Chloride Roll 12 X 2000 Feet': 'non_food',
    'Foil Aluminum Roll Standard Weight 1000 Feet': 'non_food',
    'Foil Aluminum Roll Standard Weight 500 Feet': 'non_food',
    'Label Roll Shelf Life Dissolvable 2" X 3"': 'non_food',
    'Label Roll Universal Plastic 2 Inch X 2 Inch': 'non_food',
    'Towel Roll Complete 360 Natural 8': 'non_food',
    # Canned tomatoes packed 'in juice' are food, not beverage.
    'Tomato Diced Fire Roasted 3/4" In Juice': 'food',
    # 'baking soda' contains 'soda'.
    'Baking Soda': 'food',
    # A cutlery kit that happens to name salt and pepper packets.
    'Kit Cutlery Fork, Knife, Spoon/salt And Pepper': 'non_food',
    # Kids' crayons, bought through the marketplace on a Sysco order. Matches
    # no rule at all, which is the right outcome for a product the keyword
    # lists have never seen — it surfaced instead of defaulting into food.
    'Crayon Assorted Round Box': 'non_food',

    # --- genuine beverage ------------------------------------------------------
    'Coffee Ground House Blend Bulk': 'beverage',
    # Bar mixer in practice. Also used in the kitchen, so this one is a judgment
    # call rather than a fact — at $54 across six months it moves nothing.
    'Juice Lime Lightly Pasteurized': 'beverage',
    # GOYA peach nectar in 33.8oz bottles — a bar mixer here rather than a
    # kitchen ingredient. Judgment, not fact; $111.50 across six months.
    'Nectar Peach': 'beverage',

    # --- food the keyword list simply did not name -----------------------------
    'Lard Cube Deodorized': 'food',
    'Achiote Paste': 'food',
    'Capers Nonpareil Imported': 'food',
    'Clam Whole In Shell Vacuum Packed 17-22 Per #': 'food',

    # --- smallwares and equipment parts ----------------------------------------
    # These appear only in the 2025 orders, when the kitchen was still being
    # outfitted. Equipment, not food and not consumable supply — but they sit in
    # the same non-food bucket because neither belongs in a food-cost numerator.
    'Blade For #r2 - S Blade': 'non_food',
    'Container Blender For Extra Large Model': 'non_food',
    'Scraper Grill Replacement Blade Stainless 6" Length': 'non_food',
    'Pan Food Clear Polycarbonate 1/6 Size Rectangular 2.4 Quart': 'non_food',

    # --- more consumable supply the keyword list did not name ------------------
    'Filter Grease Cone 10 Inch': 'non_food',
    'Liner Basket News Paper Print 12x12': 'non_food',
    'Tape Paper Regular Thermal 3-1/8 Inch': 'non_food',
    'Napkin Beverage 9.5 Inch X 9.5 Inch 2-ply Blac': 'non_food',
    'Bag Vacuum Plastic Clear 12" Length': 'non_food',

    # --- citrus juice, treated consistently with the lime juice above ----------
    'Juice Lemon Pasteurized Ultra Premium': 'beverage',
    'Juice Lime Pasteurized Ultra Premium': 'beverage',

    # --- disposables the keyword list did not name -----------------------------
    'Lid To Go Plastic White For 8/12/16': 'non_food',
    'Lid Plastic Clear For 1.5-2.5 Ounce Portion': 'non_food',
    'Pad Scrub Stainless Steel 35 Gram 1.25 Ounce': 'non_food',
    'Trigger Sprayer Plastic Red/white 12" Height': 'non_food',
    'Bag Plastic T Shirt 13x8x23 Total Take Out': 'non_food',
    'Bag Plastic T Shirt 11.5x6.5x21 Thank You': 'non_food',
}


def normalize(desc: str) -> str:
    """Collapse HTML whitespace so a description matches what a human typed.

    Sysco's markup emits `&nbsp;` inside some product names, which arrives as
    U+00A0. That is not the space in an OVERRIDES key, so an exact-match
    override silently misses and the line falls through to the keyword rules —
    which is how `Film Pvc Chloride Roll 12 X 2000 Feet` stayed
    unresolved after its override was written. It also defeats the
    space-delimited keywords (`'pea '`, `'pie '`).
    """
    return ' '.join((desc or '').split())


def classify(desc: str) -> tuple[str, list[str]]:
    """Return (bucket, matched_buckets). bucket is '' when unresolved."""
    desc = normalize(desc)
    if desc in OVERRIDES:
        return OVERRIDES[desc], [OVERRIDES[desc]]
    text = ' ' + desc.lower() + ' '
    hits = []
    if any(k in text for k in NON_FOOD):
        hits.append('non_food')
    if any(k in text for k in BEVERAGE):
        hits.append('beverage')
    if any(k in text for k in FOOD):
        hits.append('food')
    if len(hits) == 1:
        return hits[0], hits
    return '', hits  # zero matches -> unclassified; several -> conflict


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('lines', type=Path, nargs='+',
                    help='one or more line-item CSVs; all are pooled')
    ap.add_argument('-o', '--out', type=Path)
    args = ap.parse_args()

    rows = []
    for p in args.lines:
        rows.extend(csv.DictReader(p.open()))
    priced = [r for r in rows if r['extended_price'] not in ('', '0.0', '0.00')]

    by_month = collections.defaultdict(lambda: collections.defaultdict(float))
    problems = collections.defaultdict(lambda: [0.0, 0, []])
    for r in priced:
        bucket, hits = classify(r['description'])
        amt = float(r['extended_price'])
        month = r['order_date'][6:10] + '-' + r['order_date'][0:2]
        key = bucket or ('CONFLICT' if hits else 'UNCLASSIFIED')
        by_month[month][key] += amt
        r['bucket'] = key
        if not bucket:
            p = problems[r['description']]
            p[0] += amt
            p[1] += 1
            p[2] = hits

    if args.out:
        fields = list(rows[0].keys()) + ['bucket']
        with args.out.open('w', newline='') as fh:
            w = csv.DictWriter(fh, fieldnames=fields, extrasaction='ignore')
            w.writeheader()
            for r in priced:
                w.writerow(r)

    months = sorted(by_month)
    print(f"{'month':>9} {'food':>11} {'beverage':>10} {'non-food':>10} "
          f"{'unresolved':>11} {'food %':>7}")
    tot = collections.defaultdict(float)
    for m in months:
        b = by_month[m]
        unres = b['CONFLICT'] + b['UNCLASSIFIED']
        total = sum(b.values())
        for k, v in b.items():
            tot[k] += v
        print(f"{m:>9} ${b['food']:>10,.2f} ${b['beverage']:>9,.2f} "
              f"${b['non_food']:>9,.2f} ${unres:>10,.2f} "
              f"{100 * b['food'] / total:>6.1f}%")
    grand = sum(tot.values())
    unres = tot['CONFLICT'] + tot['UNCLASSIFIED']
    print(f"{'TOTAL':>9} ${tot['food']:>10,.2f} ${tot['beverage']:>9,.2f} "
          f"${tot['non_food']:>9,.2f} ${unres:>10,.2f} "
          f"{100 * tot['food'] / grand:>6.1f}%")
    print(f"\ngrand total            ${grand:,.2f}")
    print(f"food share             {100 * tot['food'] / grand:.1f}%")
    print(f"food + beverage share  {100 * (tot['food'] + tot['beverage']) / grand:.1f}%")

    if problems:
        print(f"\n!! {len(problems)} description(s) unresolved — "
              f"${unres:,.2f} ({100 * unres / grand:.1f}% of spend). "
              f"Resolve in OVERRIDES before quoting a food cost:", file=sys.stderr)
        for d, (amt, n, hits) in sorted(problems.items(), key=lambda x: -x[1][0]):
            tag = '/'.join(hits) if hits else 'no match'
            print(f"   ${amt:>9,.2f} x{n:<3} [{tag}] {d}", file=sys.stderr)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
