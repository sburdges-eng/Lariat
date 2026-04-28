// Unit tests for lib/bomPlanActionItems.mjs.
//
// Pure module under test — no DB, no filesystem. Tests cover:
//   - plan_placeholder_verify_bid row: uses vendor_ingredient as target
//     SKU in the recommended action
//   - plan_replace_franks row WITH candidate replacements: enumerates
//     top candidates by price
//   - plan_replace_franks row with NO candidates: emits an explicit
//     "add a new vendor SKU" action

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findHotSauceCandidates,
  recommendedActionFor,
  actionNeededFor,
  notesFor,
  HOT_SAUCE_TOKENS,
  HOT_SAUCE_CANDIDATE_CAP,
} from '../../lib/bomPlanActionItems.mjs';

// ── Helpers ────────────────────────────────────────────────────────

function row(id, map_status, opts = {}) {
  return {
    bom_line_id: id,
    ingredient: opts.ingredient ?? 'whole cloves',
    qty: opts.qty ?? 0.25,
    unit: opts.unit ?? 'cup',
    map_status,
    vendor: opts.vendor ?? '',
    vendor_ingredient: opts.vendor_ingredient ?? '',
    pack_price: opts.pack_price ?? null,
  };
}

function vp(name, vendor, pack_unit, unit_price) {
  return { name, vendor, pack_unit, unit_price };
}

// ── findHotSauceCandidates ────────────────────────────────────────

describe('findHotSauceCandidates', () => {
  it('matches on "hot sauce", "cayenne sauce", "louisiana", "buffalo" tokens', () => {
    const vendors = [
      vp('Sauce Wing Buffalo', 'sysco', 'gal', 2.46),
      vp("Louisiana Hot Sauce", 'sysco', 'btl', 3.99),
      vp('Cayenne Sauce Tabasco', 'sysco', 'btl', 4.5),
      vp('SPICE, PEPPER CAYENNE BULK', 'shamrock', 'lb', 10.44),
      vp('BEEF CHUCK ROAST', 'sysco', 'lb', 5.99),
    ];
    const matches = findHotSauceCandidates(vendors);
    const names = matches.map((m) => m.name);
    assert.ok(names.includes('Sauce Wing Buffalo'), 'buffalo should match');
    assert.ok(names.some((n) => /Louisiana/.test(n)), 'louisiana should match');
    assert.ok(names.some((n) => /Cayenne Sauce/.test(n)), 'cayenne sauce should match');
    // Whole-cayenne-spice (no "sauce" attached) must NOT match.
    assert.ok(
      !names.includes('SPICE, PEPPER CAYENNE BULK'),
      'bare cayenne spice should not match hot-sauce tokens',
    );
    // Unrelated should not match.
    assert.ok(!names.includes('BEEF CHUCK ROAST'));
  });

  it('sorts by unit_price asc and caps length', () => {
    // Build > HOT_SAUCE_CANDIDATE_CAP rows to exercise the cap.
    const rows = Array.from({ length: HOT_SAUCE_CANDIDATE_CAP + 3 }, (_, i) =>
      vp(`Louisiana Hot Sauce ${i}`, 'sysco', 'btl', 10 - i),
    );
    const matches = findHotSauceCandidates(rows);
    assert.equal(matches.length, HOT_SAUCE_CANDIDATE_CAP);
    for (let i = 1; i < matches.length; i++) {
      assert.ok(
        (matches[i - 1].unit_price ?? Infinity) <=
          (matches[i].unit_price ?? Infinity),
        'candidates must be sorted cheapest-first',
      );
    }
  });

  it('tolerates null names and missing unit_price', () => {
    const vendors = [
      { name: null, vendor: 'x', pack_unit: 'ea', unit_price: 1 },
      vp('Louisiana Hot Sauce', 'sysco', 'btl', null),
      vp('Hot sauce, buffalo style', 'shamrock', 'btl', 2.5),
    ];
    const matches = findHotSauceCandidates(vendors);
    // null-name row is skipped, the other two match; null-price is
    // sorted to the back.
    assert.equal(matches.length, 2);
    assert.equal(matches[0].name, 'Hot sauce, buffalo style');
    assert.equal(matches[1].name, 'Louisiana Hot Sauce');
  });

  it('exposes HOT_SAUCE_TOKENS as the matching vocabulary', () => {
    assert.ok(Array.isArray(HOT_SAUCE_TOKENS) && HOT_SAUCE_TOKENS.length > 0);
    assert.ok(HOT_SAUCE_TOKENS.includes('louisiana'));
  });
});

// ── recommendedActionFor — plan_placeholder_verify_bid ────────────

describe('recommendedActionFor — plan_placeholder_verify_bid', () => {
  it('surfaces target SKU from vendor_ingredient when set', () => {
    const r = row(43, 'plan_placeholder_verify_bid', {
      ingredient: 'whole cloves',
      vendor: '',
      vendor_ingredient: 'SPICE, CLOVES WHL BULK',
    });
    const action = recommendedActionFor(r, []);
    assert.match(action, /confirm vendor bid/i);
    assert.match(action, /target SKU: "SPICE, CLOVES WHL BULK"/);
    assert.match(action, /map_status='mapped'/);
  });

  it('names an explicit vendor when bom_line already has one', () => {
    const r = row(44, 'plan_placeholder_verify_bid', {
      vendor: 'shamrock',
      vendor_ingredient: 'SPICE, CLOVES WHL BULK',
    });
    const action = recommendedActionFor(r, []);
    assert.match(action, /"shamrock"/);
  });

  it('falls back to "all candidate vendors" when vendor is blank', () => {
    const r = row(45, 'plan_placeholder_verify_bid', { vendor: '' });
    const action = recommendedActionFor(r, []);
    assert.match(action, /all candidate vendors/);
  });

  it('actionNeeded / notes are correct for verify_bid', () => {
    const r = row(43, 'plan_placeholder_verify_bid');
    assert.equal(actionNeededFor(r), 'verify vendor bid');
    assert.match(notesFor(r), /placeholder pricing/i);
  });
});

// ── recommendedActionFor — plan_replace_franks WITH candidates ────

describe('recommendedActionFor — plan_replace_franks with candidates', () => {
  it('enumerates candidate names, vendors, and prices in the action text', () => {
    const r = row(68, 'plan_replace_franks', {
      ingredient: "franks hot sauce",
      vendor: '',
      vendor_ingredient: 'Sweet Baby Rays Buffalo Wing Sauce',
    });
    const candidates = [
      vp('Sauce Wing Buffalo', 'sysco', 'gal', 2.460608),
      vp('Louisiana Hot Sauce', 'sysco', 'btl', 3.99),
    ];
    const action = recommendedActionFor(r, candidates);
    assert.match(action, /identify replacement SKU/i);
    assert.match(action, /Sauce Wing Buffalo \[sysco, \$2\.4606\/gal\]/);
    assert.match(action, /Louisiana Hot Sauce \[sysco, \$3\.9900\/btl\]/);
    assert.match(action, /set map_status='mapped'/);
  });
});

// ── recommendedActionFor — plan_replace_franks with NO candidates ─

describe('recommendedActionFor — plan_replace_franks with no candidates', () => {
  it('emits an explicit "add a new vendor SKU" action when vendor_prices has no hot-sauce row', () => {
    const r = row(68, 'plan_replace_franks', { ingredient: "franks red hot" });
    const action = recommendedActionFor(r, []);
    assert.match(action, /NO hot-sauce candidates found/);
    assert.match(action, /add a new vendor SKU/i);
    assert.match(action, /flag for drink\/spec sourcing/);
    assert.match(action, /set map_status='mapped'/);
  });

  it('treats null candidate list the same as empty', () => {
    const r = row(68, 'plan_replace_franks', { ingredient: "franks" });
    const action = recommendedActionFor(r, null);
    assert.match(action, /NO hot-sauce candidates found/);
  });

  it('actionNeeded / notes are correct for replace_franks', () => {
    const r = row(68, 'plan_replace_franks');
    assert.equal(actionNeededFor(r), 'replace frank-branded SKU');
    assert.match(notesFor(r), /Frank-branded/i);
  });
});

// ── Unknown status ────────────────────────────────────────────────

describe('recommendedActionFor — unknown status', () => {
  it('emits a manual-review string for any unrecognized status', () => {
    const r = row(1000, 'something_else');
    assert.equal(
      recommendedActionFor(r, []),
      'unknown map_status — manual review required',
    );
    assert.equal(actionNeededFor(r), 'manual review');
    assert.equal(notesFor(r), '');
  });
});
