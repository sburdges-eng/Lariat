// Tests for scripts/extract-drink-skus.mjs — the pure classifier +
// CSV builder. DB integration is deliberately not covered here; the
// important invariants are in the classifier taxonomy and the CSV
// shape. The importer side (vendor_prices) has its own test file.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const extract = await import('../../scripts/extract-drink-skus.mjs');
const {
  classifyMenuItem,
  suggestPackDefaults,
  buildDrinkReport,
  renderDrinkReportCsv,
  DRINK_KEYWORDS,
  LARIAT_DRINK_KEYWORDS,
} = extract;

describe('classifyMenuItem', () => {
  it('recognizes beers from the spec keyword list', () => {
    for (const name of [
      'Coors',
      'Coors light',
      'Corona Btl',
      'Modelo Especial',
      'Heineken',
      'Dos Equis Amber',
      'Budweiser',
      'PBR Tallboy',
      'IPA of the Day',
    ]) {
      assert.equal(
        classifyMenuItem(name, null),
        'beer',
        `expected "${name}" to classify as beer`,
      );
    }
  });

  it('recognizes liquor and cocktails', () => {
    assert.equal(classifyMenuItem('Tequila (Well) Lunazul', null), 'liquor');
    assert.equal(classifyMenuItem('Vodka Breck Well', null), 'liquor');
    assert.equal(classifyMenuItem('Bourbon (well) Evan Williams', null), 'liquor');
    assert.equal(classifyMenuItem('Espresso Martini', null), 'cocktail');
    assert.equal(classifyMenuItem('Margarita', null), 'cocktail');
    assert.equal(classifyMenuItem('Spicy Paloma', null), 'cocktail');
    assert.equal(classifyMenuItem('Green Tea Shot', null), 'liquor');
  });

  it('recognizes seltzers', () => {
    assert.equal(classifyMenuItem('High Noon Pineapple', null), 'seltzer');
    assert.equal(classifyMenuItem('White Claw Mango', null), 'seltzer');
    assert.equal(classifyMenuItem('Truly Berry', null), 'seltzer');
  });

  it('recognizes Lariat-specific brand names', () => {
    assert.equal(classifyMenuItem('SOULCRAFT SKYFIRE', null), 'beer');
    assert.equal(classifyMenuItem('ELEVATION FIRSTCAST', null), 'beer');
    assert.equal(classifyMenuItem('Elevation kolsch', null), 'beer');
    assert.equal(classifyMenuItem('Guinness', null), 'beer');
    assert.equal(classifyMenuItem('Tito', null), 'liquor');
    assert.equal(classifyMenuItem('Jack Daniels', null), 'liquor');
    assert.equal(classifyMenuItem('PEAR Mule', null), 'cocktail');
  });

  it('rejects food dishes', () => {
    for (const name of [
      'ROPE BURGER',
      'FISH AND CHIPS',
      'NASHVILLE CHICKEN SANDWICH',
      'CLASSIC BLT',
      'Quesa Birria Tacos',
      'BAJA FISH TACOS',
      'Chicken Wings',
      'Rope Salad',
      'Mountain Mac And Cheese',
      'Jalapeno Cheddar Cornbread',
      '1-2LB BRISKET',
      'The Trio',
      'Green Chili',
      'Pig Wings',
      'EL JEFE BURGER',
      'ROASTED TROUT',
    ]) {
      assert.equal(
        classifyMenuItem(name, null),
        null,
        `expected "${name}" NOT to classify as a drink`,
      );
    }
  });

  it('rejects aggregate rows', () => {
    assert.equal(classifyMenuItem('TOTAL', null), null);
    assert.equal(classifyMenuItem('TOTALS', null), null);
    assert.equal(classifyMenuItem('', null), null);
    assert.equal(classifyMenuItem('  ', null), null);
    assert.equal(classifyMenuItem(null, null), null);
    assert.equal(classifyMenuItem(undefined, null), null);
  });

  it('trusts explicit beverage categories when provided', () => {
    assert.equal(classifyMenuItem('Mystery Drink', 'Beer'), 'beer');
    assert.equal(classifyMenuItem('Mystery Drink', 'Liquor'), 'liquor');
    assert.equal(classifyMenuItem('Mystery Drink', 'Cocktails'), 'cocktail');
    assert.equal(classifyMenuItem('Mystery Drink', 'Wine'), 'wine');
    assert.equal(classifyMenuItem('Mystery Drink', 'Hard Seltzer'), 'seltzer');
  });

  it('trusts food categories to suppress name-based drink matches', () => {
    // "Burger and Beer $20" would hit the "beer" keyword, but if the POS
    // category says "Food Combo", we trust the category and reject.
    assert.equal(
      classifyMenuItem('Burger and Beer $20', 'Food Combo'),
      null,
      'explicit food category should override name match',
    );
  });

  it('handles word boundaries so "ale" does not match "salad"', () => {
    // Critical: "Rope Salad" must NOT classify as beer via the "ale" kw.
    assert.equal(classifyMenuItem('Rope Salad', null), null);
    assert.equal(classifyMenuItem('Baja Fish Tacos', null), null);
  });
});

describe('suggestPackDefaults', () => {
  it('returns bottle defaults for beer / wine / seltzer', () => {
    assert.equal(suggestPackDefaults('beer').pack_unit, 'bottle');
    assert.equal(suggestPackDefaults('wine').pack_unit, 'bottle');
    assert.equal(suggestPackDefaults('seltzer').pack_unit, 'bottle');
  });
  it('returns ml for liquor (so unit_price can be per-ml)', () => {
    assert.equal(suggestPackDefaults('liquor').pack_unit, 'ml');
  });
  it('returns each for cocktail (built drinks have no single pack unit)', () => {
    assert.equal(suggestPackDefaults('cocktail').pack_unit, 'each');
  });
  it('returns empty defaults for unknown kind', () => {
    const s = suggestPackDefaults('bogus');
    assert.equal(s.pack_unit, '');
    assert.equal(s.pour_size, '');
  });
});

describe('buildDrinkReport', () => {
  it('sorts retained drink rows in the input order (expected to be revenue DESC)', () => {
    const rows = [
      { item_name: 'Tequila Well', total_revenue: 2246, total_qty: 248 },
      { item_name: 'ROPE BURGER',  total_revenue: 2449, total_qty: 159 },
      { item_name: 'Coors',        total_revenue: 1788, total_qty: 421 },
      { item_name: 'FISH AND CHIPS', total_revenue: 1606, total_qty: 94 },
      { item_name: 'Vodka Breck Well', total_revenue: 1502, total_qty: 162 },
      { item_name: 'TOTAL', total_revenue: 69732, total_qty: 7406 },
    ];
    const { drinkRows, totalRevenue, drinkRevenue } = buildDrinkReport(rows);
    // Food rows + TOTAL dropped, drinks retained in input order.
    const names = drinkRows.map((r) => r.menu_item_name);
    assert.deepEqual(names, ['Tequila Well', 'Coors', 'Vodka Breck Well']);
    assert.equal(drinkRows[0].inferred_kind, 'liquor');
    assert.equal(drinkRows[1].inferred_kind, 'beer');
    assert.equal(drinkRows[2].inferred_kind, 'liquor');
    // TOTAL row is excluded from totalRevenue because classify returns null
    // AFTER the totalRevenue tally — but wait: buildDrinkReport sums BEFORE
    // classify. The TOTAL row is included in totalRevenue because it's
    // present in the input. That's intentional — the % share is based on
    // "what the caller fed us" and the SQL strips TOTAL before feeding.
    const expectedTotal = 2246 + 2449 + 1788 + 1606 + 1502 + 69732;
    assert.equal(totalRevenue, expectedTotal);
    assert.equal(drinkRevenue, 2246 + 1788 + 1502);
  });

  it('produces deterministic CSV with header', () => {
    const rows = [
      { item_name: 'Coors', total_revenue: 100, total_qty: 10 },
      { item_name: 'Tequila (Well) Lunazul', total_revenue: 80, total_qty: 8 },
      { item_name: 'BURGER', total_revenue: 500, total_qty: 50 },
    ];
    const { drinkRows } = buildDrinkReport(rows);
    const csv = renderDrinkReportCsv(drinkRows);
    const lines = csv.split('\n');
    assert.equal(
      lines[0],
      'menu_item_name,total_revenue,total_qty,category,inferred_kind,' +
        'suggested_pack_unit,suggested_pour_size,notes',
    );
    assert.match(lines[1], /^Coors,100\.00,10,,beer,bottle,/);
    assert.match(lines[2], /^Tequila \(Well\) Lunazul,80\.00,8,,liquor,ml,/);
    assert.equal(lines[3], ''); // trailing newline
    assert.equal(lines.length, 4);
  });

  it('quotes CSV fields containing commas', () => {
    const rows = [
      { item_name: 'Coors, Light Draft', total_revenue: 100, total_qty: 10 },
    ];
    const { drinkRows } = buildDrinkReport(rows);
    const csv = renderDrinkReportCsv(drinkRows);
    assert.ok(csv.includes('"Coors, Light Draft"'), 'comma must be quoted');
  });
});

describe('DRINK_KEYWORDS / LARIAT_DRINK_KEYWORDS', () => {
  it('DRINK_KEYWORDS covers the spec kinds', () => {
    for (const k of ['seltzer', 'beer', 'wine', 'cocktail', 'liquor']) {
      assert.ok(Array.isArray(DRINK_KEYWORDS[k]), `${k} missing`);
      assert.ok(DRINK_KEYWORDS[k].length > 0, `${k} empty`);
    }
  });
  it('LARIAT_DRINK_KEYWORDS adds local brand tokens', () => {
    assert.ok(LARIAT_DRINK_KEYWORDS.beer.includes('soulcraft'));
    assert.ok(LARIAT_DRINK_KEYWORDS.beer.includes('elevation'));
    assert.ok(LARIAT_DRINK_KEYWORDS.liquor.includes('tito'));
  });
});
