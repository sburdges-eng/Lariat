/**
 * Unit conversion for the costing pipeline — JS mirror of scripts/lib/units.py.
 *
 * Python is authoritative for the conversion tables and for `normalizeUnit`.
 * If Python drifts, update the tables here, regenerate the parity fixture
 * (scripts/lib/generate_unit_convert_fixture.py), and fix JS to match. Parity
 * is enforced by tests/js/test-unit-convert-parity.mjs.
 *
 * Scope
 *   - same-dim (weight↔weight, volume↔volume) via the WEIGHT_TO_G / VOLUME_TO_ML
 *     factor tables: qty_base = qty × factor(from), qty_to = qty_base / factor(to).
 *   - cross-dim (volume↔weight) via an ingredient density in g/ml. Density must
 *     be supplied by the caller; this module does not read the DB.
 *   - identity (from === to after normalization): returns qty verbatim.
 *
 * Not in scope
 *   - Count units (ea, case, bag, can, bottle, …). `unitDimension` returns
 *     'count' for them, but `convertQty` refuses any conversion that involves
 *     a count unit (count ↔ weight / volume needs per-item weight or case-size
 *     data — T5 territory with `vendor_pack_weights.csv`). Returns null.
 *   - Unknown units (raw strings that neither Python nor JS recognize).
 *     Returns null so the caller can flag the row.
 *
 * Contract
 *   - `convertQty` never throws. Every failure path is a `null` return.
 *   - `qty === 0` returns `0` (an exact zero is a valid conversion result).
 *   - `qty === NaN` or non-finite returns `null`.
 */

// Canonical conversion factors — byte-exact mirror of scripts/lib/units.py.
export const WEIGHT_TO_G = {
  mg: 0.001,
  g: 1.0,
  gram: 1.0,
  grams: 1.0,
  kg: 1000.0,
  oz: 28.3495231,
  lb: 453.59237,
  lbs: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

export const VOLUME_TO_ML = {
  ml: 1.0,
  l: 1000.0,
  liter: 1000.0,
  litre: 1000.0,
  tsp: 4.92892159,
  tbsp: 14.78676478,
  floz: 29.5735296,
  fl_oz: 29.5735296,
  'fl oz': 29.5735296,
  cup: 236.5882365,
  cups: 236.5882365,
  pt: 473.176473,
  pint: 473.176473,
  qt: 946.352946,
  quart: 946.352946,
  gal: 3785.411784,
  gallon: 3785.411784,
};

// Count units. Mirrors scripts/lib/units.py:COUNT_TO_EA.
export const COUNT_TO_EA = {
  ea: 1.0,
  each: 1.0,
  pc: 1.0,
  pcs: 1.0,
  ct: 1.0,
  count: 1.0,
  pk: 1.0,
  pack: 1.0,
  cs: 1.0,
  case: 1.0,
  bag: 1.0,
  bottle: 1.0,
  btl: 1.0,
  can: 1.0,
  jar: 1.0,
  doz: 12.0,
  dozen: 12.0,
};

// Synonym → canonical. Byte-exact mirror of scripts/lib/units.py:_SYNONYMS.
const SYNONYMS = {
  '': '',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  ounce: 'oz',
  ounces: 'oz',
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  milligram: 'mg',
  milligrams: 'mg',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  millilitre: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  fluid_ounce: 'floz',
  'fluid ounce': 'floz',
  fl_oz: 'floz',
  'fl oz': 'floz',
  cups: 'cup',
  pint: 'pt',
  pints: 'pt',
  quart: 'qt',
  quarts: 'qt',
  gallon: 'gal',
  gallons: 'gal',
  each: 'ea',
  pcs: 'pc',
  count: 'ct',
  pack: 'pk',
  packs: 'pk',
  case: 'cs',
  cases: 'cs',
  bags: 'bag',
  bottles: 'bottle',
  btl: 'bottle',
  cans: 'can',
  jars: 'jar',
  dozen: 'doz',
  dozens: 'doz',
};

/**
 * Byte-exact mirror of scripts/lib/units.py:normalize_unit.
 * Lower-case, strip, collapse synonyms. Returns canonical key or ''.
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeUnit(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim().toLowerCase();
  if (!s) return '';
  return Object.prototype.hasOwnProperty.call(SYNONYMS, s) ? SYNONYMS[s] : s;
}

/**
 * 'weight' | 'volume' | 'count' | null for a canonical unit string.
 * @param {string} canon
 * @returns {'weight' | 'volume' | 'count' | null}
 */
export function unitDimension(canon) {
  if (Object.prototype.hasOwnProperty.call(WEIGHT_TO_G, canon)) return 'weight';
  if (Object.prototype.hasOwnProperty.call(VOLUME_TO_ML, canon)) return 'volume';
  if (Object.prototype.hasOwnProperty.call(COUNT_TO_EA, canon)) return 'count';
  return null;
}

/**
 * Convert `qty` of `fromUnit` into `toUnit`.
 *
 *   - identity (normalized-equal units): returns qty (including 0).
 *   - same-dim weight↔weight or volume↔volume: via the factor tables.
 *   - cross-dim volume↔weight: requires a numeric g/ml density.
 *   - count involvement: returns null (out of scope — see module header).
 *   - unknown unit on either side: returns null.
 *   - non-finite qty: returns null.
 *
 * @param {number} qty
 * @param {string} fromUnit raw or canonical unit string
 * @param {string} toUnit   raw or canonical unit string
 * @param {number | null | undefined} gPerMl density (required only for cross-dim)
 * @returns {number | null}
 */
export function convertQty(qty, fromUnit, toUnit, gPerMl) {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return null;

  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) return null;

  // Identity — handle first so it never requires a density even if the unit
  // is a count unit ("5 ea" stays "5 ea").
  if (from === to) return qty;

  const fromDim = unitDimension(from);
  const toDim = unitDimension(to);
  if (!fromDim || !toDim) return null; // unknown on at least one side

  // Count units cannot participate in conversions beyond identity.
  if (fromDim === 'count' || toDim === 'count') return null;

  // Same-dimension path.
  if (fromDim === toDim) {
    if (fromDim === 'weight') {
      const fromG = WEIGHT_TO_G[from];
      const toG = WEIGHT_TO_G[to];
      if (!(fromG > 0) || !(toG > 0)) return null;
      return (qty * fromG) / toG;
    }
    // volume
    const fromMl = VOLUME_TO_ML[from];
    const toMl = VOLUME_TO_ML[to];
    if (!(fromMl > 0) || !(toMl > 0)) return null;
    return (qty * fromMl) / toMl;
  }

  // Cross-dim: requires density.
  if (gPerMl == null || typeof gPerMl !== 'number' || !Number.isFinite(gPerMl) || !(gPerMl > 0)) {
    return null;
  }

  if (fromDim === 'volume' && toDim === 'weight') {
    // qty(vol) → ml → g → to-unit
    const ml = qty * VOLUME_TO_ML[from];
    const g = ml * gPerMl;
    const toG = WEIGHT_TO_G[to];
    if (!(toG > 0)) return null;
    return g / toG;
  }

  if (fromDim === 'weight' && toDim === 'volume') {
    // qty(wt) → g → ml → to-unit
    const g = qty * WEIGHT_TO_G[from];
    const ml = g / gPerMl;
    const toMl = VOLUME_TO_ML[to];
    if (!(toMl > 0)) return null;
    return ml / toMl;
  }

  return null;
}
