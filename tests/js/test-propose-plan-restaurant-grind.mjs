// Unit tests for matchRawCutForGrind in lib/bomVendorProposals.ts.
//
// Pure module under test — no DB, no filesystem. Tests construct
// fixture vendor candidate arrays and exercise the raw-cut / bulk-form
// / finished-form scoring paths described in the PR spec.
//
// Fixtures cover:
//   - Exact raw-cut match: vendor has a whole/peppercorn form → high
//   - Vague match: vendor carries only bulk/cracked/coarse → medium
//   - Zero-match: no vendor row contains the bom token → manual + note

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { matchRawCutForGrind } = await import('../../lib/bomVendorProposals.ts');

// ── Fixtures ───────────────────────────────────────────────────────

function bomRow(id, ingredient, qty = 1, unit = 'tbsp', recipe_id = 'test_recipe') {
  return { bom_line_id: id, recipe_id, ingredient, qty, unit };
}

function vp(name, vendor, pack_unit, unit_price) {
  return { source: 'vendor_prices', name, vendor, pack_unit, unit_price };
}

// ── Exact raw-cut match ────────────────────────────────────────────

describe('matchRawCutForGrind — exact raw-cut match', () => {
  it('returns high-confidence candidate when a whole/peppercorn variant exists', () => {
    const vendors = [
      vp('SPICE, PEPPERCORN BLK WHL BULK', 'shamrock', 'lb', 12.5),
      vp('SPICE, PEPPER BLK CRSE GRND BULK', 'shamrock', 'lb', 16.02),
      vp('SPICE, PEPPER BLK SHAKER GRIND PCH', 'shamrock', 'lb', 15.99),
    ];
    const row = bomRow(300, 'pepper', 3, 'tbsp');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'matched');
    assert.ok(result.candidates.length >= 1);
    const top = result.candidates[0];
    assert.equal(top.confidence, 'high');
    assert.ok(
      /PEPPERCORN BLK WHL/i.test(top.name),
      `expected peppercorn-whole candidate, got "${top.name}"`,
    );
    assert.match(top.reason, /raw-cut match/);
    assert.match(result.note, /whole\/raw form available/);
  });

  it('picks high over medium when both exist and sorts by price', () => {
    const vendors = [
      vp('SPICE, PEPPER BLK WHOLE BULK', 'shamrock', 'lb', 13.5),
      vp('Peppercorn Black Whole', 'sysco', 'lb', 11.99),
      vp('SPICE, PEPPER BLK CRSE GRND BULK', 'shamrock', 'lb', 16.02),
    ];
    const row = bomRow(300, 'pepper', 1, 'tsp');
    const result = matchRawCutForGrind(row, vendors);

    const highs = result.candidates.filter((c) => c.confidence === 'high');
    assert.ok(highs.length >= 2, 'expected ≥2 high-confidence candidates');
    // Cheaper first.
    assert.ok(highs[0].unit_price <= highs[1].unit_price);
  });
});

// ── Vague (bulk-form) match ────────────────────────────────────────

describe('matchRawCutForGrind — vague bulk-form match', () => {
  it('returns medium-confidence when only bulk/coarse/cracked variants exist', () => {
    const vendors = [
      vp('SPICE, PEPPER BLK CRSE GRND BULK', 'shamrock', 'lb', 16.02),
      vp('SPICE, PEPPER BLK CRACKED BULK', 'shamrock', 'lb', 15.39),
      vp('SPICE, PEPPER BLK SHAKER GRIND PCH', 'shamrock', 'lb', 15.99),
    ];
    const row = bomRow(174, 'pepper', 0.25, 'cup');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'matched');
    const top = result.candidates[0];
    assert.equal(top.confidence, 'medium');
    assert.match(top.reason, /bulk-form match/);
    assert.match(result.note, /no whole form in catalog/);
  });

  it('cracks/coarse/bulk are all recognized as bulk-form keywords', () => {
    // Each variant in isolation must promote past "low".
    const bulkVariants = [
      'SPICE, PEPPER BLK CRSE GRND BULK',
      'SPICE, PEPPER BLK CRACKED BULK',
      'SPICE, PEPPER BLK COARSE',
    ];
    for (const name of bulkVariants) {
      const result = matchRawCutForGrind(bomRow(1, 'pepper'), [
        vp(name, 'shamrock', 'lb', 15),
      ]);
      assert.equal(
        result.candidates[0].confidence,
        'medium',
        `${name} should score medium (bulk-form), got ${result.candidates[0].confidence}`,
      );
    }
  });
});

// ── Finished-form fallback ─────────────────────────────────────────

describe('matchRawCutForGrind — finished-form fallback', () => {
  it('returns low when vendor carries only pre-ground finished forms', () => {
    const vendors = [
      vp('SPICE, PEPPER BLK SHAKER GRIND PCH', 'shamrock', 'lb', 15.99),
    ];
    const row = bomRow(208, 'pepper', 0, 'nan');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'matched');
    const top = result.candidates[0];
    assert.equal(top.confidence, 'low');
    assert.match(top.reason, /finished-form match/);
    assert.match(result.note, /vendor carries no raw input/);
  });
});

// ── Zero-match ─────────────────────────────────────────────────────

describe('matchRawCutForGrind — zero match', () => {
  it('emits a manual sentinel when no vendor row contains the bom token', () => {
    const vendors = [
      vp('CHEESE, CHEDDAR SHRD', 'shamrock', 'lb', 4.2),
      vp('Produce Lettuce Romaine', 'sysco', 'ea', 1.3),
    ];
    const row = bomRow(900, 'pepper', 1, 'tbsp');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'manual');
    assert.equal(result.candidates.length, 1);
    const c = result.candidates[0];
    assert.equal(c.confidence, 'none');
    assert.equal(c.source, 'none');
    assert.match(c.reason, /no vendor row contains token/);
  });

  it('emits manual sentinel when ingredient tokenizes to nothing usable', () => {
    // "ground" is in RAW_CUT_NOISE_TOKENS; with nothing else, the token
    // list ends up empty.
    const row = bomRow(901, 'ground', 1, 'tbsp');
    const result = matchRawCutForGrind(row, []);
    assert.equal(result.classification, 'manual');
    assert.match(result.candidates[0].reason, /no usable tokens/);
  });
});

// ── Ingredient with extra noise tokens ─────────────────────────────

describe('matchRawCutForGrind — noise-token handling', () => {
  it('drops "ground" from a bom token list so anchor matching targets the real ingredient', () => {
    // bom "ground beef" → anchor token "beef" (not "ground").
    const vendors = [
      vp('BEEF CHUCK ROAST WHOLE', 'sysco', 'lb', 6.5),
      vp('GROUND BEEF 80/20', 'sysco', 'lb', 5.8),
    ];
    const row = bomRow(501, 'ground beef', 2, 'lb');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'matched');
    // Both candidates contain "beef"; the WHOLE variant should score high.
    const top = result.candidates[0];
    assert.equal(top.confidence, 'high');
    assert.match(top.name, /WHOLE/i);
  });
});

// ── Variety-discriminator penalty (the real pepper-vs-red-pepper trap) ─

describe('matchRawCutForGrind — variety-discriminator penalty', () => {
  it('demotes a whole-red-pepper candidate below a bulk-black-pepper candidate for bom "pepper"', () => {
    // This is the live-data failure mode that motivated the penalty:
    // "PEPPER, RED WHL FIRE RSTD" is a cheap VEGETABLE, not a precursor
    // to black pepper grind. The real target is "SPICE, PEPPER BLK *".
    const vendors = [
      vp('PEPPER, RED WHL FIRE RSTD IMP', 'shamrock', 'oz', 0.1125),
      vp('SPICE, PEPPER BLK CRACKED BULK', 'shamrock', 'lb', 15.39),
      vp('SPICE, PEPPER BLK CRSE GRND BULK', 'shamrock', 'lb', 16.02),
      vp('PEPPER, JALP WHL REFRIG FRSH', 'shamrock', 'lb', 1.6),
    ];
    const row = bomRow(174, 'pepper', 0.25, 'cup');
    const result = matchRawCutForGrind(row, vendors);

    assert.equal(result.classification, 'matched');
    // Top should be a bulk-form SPICE, PEPPER BLK row — NOT the red
    // whole fire-roasted pepper, even though the red is cheaper.
    const top = result.candidates[0];
    assert.match(
      top.name,
      /SPICE, PEPPER BLK/,
      `top candidate should be bulk black pepper, got "${top.name}"`,
    );
    // The red whole pepper should appear LATER and carry a
    // variety-discriminator penalty note.
    const redRow = result.candidates.find((c) =>
      /PEPPER, RED WHL/.test(c.name),
    );
    assert.ok(redRow, 'red whole pepper should still appear (operator-visibility)');
    assert.match(redRow.reason, /variety-discriminator penalty/);
  });

  it('does NOT penalize on tokens that are shared between bom and candidate', () => {
    // bom "red pepper" + candidate "PEPPER, RED WHL" → both carry
    // "red", so "red" alone would NOT trigger a penalty. The penalty
    // only fires when the candidate has a variety-discriminator the
    // bom lacks.
    const vendors = [
      // Plain "red" + "whl" — no additional variety tokens beyond red.
      vp('PEPPER, RED WHOLE', 'shamrock', 'lb', 3.5),
    ];
    const row = bomRow(175, 'red pepper', 1, 'tbsp');
    const result = matchRawCutForGrind(row, vendors);

    const top = result.candidates[0];
    // Raw-cut keyword matched, no discriminator left uncarried → high,
    // clean reason (no penalty text).
    assert.equal(top.confidence, 'high');
    assert.ok(
      !/variety-discriminator/.test(top.reason),
      `expected no penalty, got reason: ${top.reason}`,
    );
  });
});
