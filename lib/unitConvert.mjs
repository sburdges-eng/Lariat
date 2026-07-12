// @ts-check
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
/** @type {Record<string, number>} */
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

/** @type {Record<string, number>} */
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
/** @type {Record<string, number>} */
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
  cn: 1.0,
  jar: 1.0,
  bunch: 1.0,
  box: 1.0,
  slice: 1.0,
  sprig: 1.0,
  clove: 1.0,
  doz: 12.0,
  dozen: 12.0,
};

// Synonym → canonical. Byte-exact mirror of scripts/lib/units.py:_SYNONYMS.
/** @type {Record<string, string>} */
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
  c: 'cup', // bom_expand / recipe shorthand
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
  '#10 can': 'can',
  '#10_can': 'can',
  '#': 'lb', // bom_expand weight shorthand
  jars: 'jar',
  bunches: 'bunch',
  boxes: 'box',
  slices: 'slice',
  sprigs: 'sprig',
  cloves: 'clove',
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
  if (Object.prototype.hasOwnProperty.call(SYNONYMS, s)) return SYNONYMS[s] ?? s;
  return s;
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
 * @param {string | null | undefined} fromUnit raw or canonical unit string
 * @param {string | null | undefined} toUnit   raw or canonical unit string
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
      if (fromG === undefined || toG === undefined || !(fromG > 0) || !(toG > 0)) return null;
      return (qty * fromG) / toG;
    }
    // volume
    const fromMl = VOLUME_TO_ML[from];
    const toMl = VOLUME_TO_ML[to];
    if (fromMl === undefined || toMl === undefined || !(fromMl > 0) || !(toMl > 0)) return null;
    return (qty * fromMl) / toMl;
  }

  // Cross-dim: requires density.
  if (gPerMl == null || typeof gPerMl !== 'number' || !Number.isFinite(gPerMl) || !(gPerMl > 0)) {
    return null;
  }

  if (fromDim === 'volume' && toDim === 'weight') {
    // qty(vol) → ml → g → to-unit
    const fromMl = VOLUME_TO_ML[from];
    if (fromMl === undefined) return null;
    const ml = qty * fromMl;
    const g = ml * gPerMl;
    const toG = WEIGHT_TO_G[to];
    if (toG === undefined || !(toG > 0)) return null;
    return g / toG;
  }

  if (fromDim === 'weight' && toDim === 'volume') {
    // qty(wt) → g → ml → to-unit
    const fromG = WEIGHT_TO_G[from];
    if (fromG === undefined) return null;
    const g = qty * fromG;
    const ml = g / gPerMl;
    const toMl = VOLUME_TO_ML[to];
    if (toMl === undefined || !(toMl > 0)) return null;
    return ml / toMl;
  }

  return null;
}

/**
 * T4.1 count-bridge. Converts a quantity of a count unit (ea / bunch / can /
 * …) into a weight or volume unit using a per-ingredient grams-per-unit
 * lookup as the anchor. Returns `null` on any failure path so the caller can
 * fall back to `convertQty` or flag the row.
 *
 *   count → weight:  qty × g_per_unit = g  →  g / WEIGHT_TO_G[to]
 *   count → volume:  qty × g_per_unit = g  →  (g / density) / VOLUME_TO_ML[to]
 *   weight → count:  qty × WEIGHT_TO_G[from] = g  →  g / g_per_unit[to]
 *   volume → count:  qty × VOLUME_TO_ML[from] × density = g  →  g / g_per_unit[to]
 *   count → count:   different units bridged via grams.
 *
 * Assumes `fromCanon` / `toCanon` are already normalized by `normalizeUnit`.
 * `unitWeights` is a Map<string,number> keyed on canonical count unit →
 * grams-per-one, scoped to the specific ingredient (typically
 * `unitWeightByKey.get(normalizeIngredientKey(ingredient))`). May be
 * undefined — treated as empty.
 *
 * (Moved here from scripts/ingest-costing.mjs so lib-level pricing code can
 * share it; the script re-exports for backward compatibility.)
 *
 * @param {number} qty
 * @param {string} fromCanon
 * @param {string} toCanon
 * @param {number | null | undefined} density g/ml
 * @param {Map<string,number> | undefined} unitWeights
 * @returns {number | null}
 */
export function bridgeCount(qty, fromCanon, toCanon, density, unitWeights) {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) return null;
  if (!fromCanon || !toCanon) return null;
  if (fromCanon === toCanon) return qty;

  const fromDim = unitDimension(fromCanon);
  const toDim = unitDimension(toCanon);
  if (!fromDim || !toDim) return null;
  if (fromDim !== 'count' && toDim !== 'count') return null; // nothing to bridge

  /**
   * @param {number} q
   * @param {string} canon
   * @returns {number | null}
   */
  const gramsFromCount = (q, canon) => {
    const g = unitWeights?.get(canon);
    return g != null && g > 0 && Number.isFinite(g) ? q * g : null;
  };
  /**
   * @param {number} g
   * @param {string} canon
   * @returns {number | null}
   */
  const countFromGrams = (g, canon) => {
    const w = unitWeights?.get(canon);
    return w != null && w > 0 && Number.isFinite(w) ? g / w : null;
  };

  let grams;
  if (fromDim === 'count') {
    grams = gramsFromCount(qty, fromCanon);
  } else if (fromDim === 'weight') {
    const f = WEIGHT_TO_G[fromCanon];
    if (f === undefined || !(f > 0)) return null;
    grams = qty * f;
  } else {
    // volume → grams requires density.
    if (density == null || !Number.isFinite(density) || !(density > 0)) return null;
    const f = VOLUME_TO_ML[fromCanon];
    if (f === undefined || !(f > 0)) return null;
    grams = qty * f * density;
  }
  if (grams == null || !Number.isFinite(grams) || grams < 0) return null;

  if (toDim === 'count') return countFromGrams(grams, toCanon);
  if (toDim === 'weight') {
    const t = WEIGHT_TO_G[toCanon];
    if (t === undefined || !(t > 0)) return null;
    return grams / t;
  }
  // volume
  if (density == null || !Number.isFinite(density) || !(density > 0)) return null;
  const t = VOLUME_TO_ML[toCanon];
  if (t === undefined || !(t > 0)) return null;
  return (grams / density) / t;
}

/**
 * T4 leaf-pricing conversion, shared by every path that prices a BOM line
 * against a vendor_prices pack (ingest yield-delta post-pass, sub-recipe
 * rollup `_priceLeafLine`, and `computeCostVariance`). Converts `packSize`
 * (denominated in `packUnit`) into the BOM line's `lineUnit` so
 * `qty × pack_price / pack_size` compares like with like.
 *
 * Semantics (mirrors the ingest T4 block exactly):
 *   - `packUnit` empty/unknown → identity fallback: treat pack_size as
 *     already being in the line's unit (legacy T3 assumption — workbooks
 *     without vendor sheets keep computing).
 *   - `lineUnit` empty/unknown while packUnit is known → can't interpret
 *     the ratio: `{ value: null, flag: true }` (caller flags NEEDS_DENSITY).
 *   - same canonical unit → identity (byte-exact same-unit path).
 *   - otherwise count-bridge first (convertQty never handles count), then
 *     convertQty with density; failure → `{ value: null, flag: true }`.
 *
 * @param {number} packSize
 * @param {string | null | undefined} packUnit
 * @param {string | null | undefined} lineUnit
 * @param {number | null | undefined} density g/ml for cross-dim
 * @param {Map<string,number> | undefined} unitWeights canonical count unit → g
 * @returns {{ value: number | null, flag: boolean }}
 */
export function convertPackSizeToLineUnit(packSize, packUnit, lineUnit, density, unitWeights) {
  const packCanon = normalizeUnit(packUnit);
  const lineCanon = normalizeUnit(lineUnit);
  if (!packCanon) return { value: packSize, flag: false };
  if (!lineCanon) return { value: null, flag: true };
  if (packCanon === lineCanon) return { value: packSize, flag: false };

  const bridged = bridgeCount(packSize, packCanon, lineCanon, density, unitWeights);
  const converted = bridged !== null ? bridged : convertQty(packSize, packUnit, lineUnit, density);
  if (converted === null || !(converted > 0) || !Number.isFinite(converted)) {
    return { value: null, flag: true };
  }
  return { value: converted, flag: false };
}

/**
 * Resolve a usable pack price for costing math. Vendor ingest often stores
 * `unit_price` + `pack_size` with `pack_price` null; implied pack =
 * unit_price × pack_size.
 *
 * @param {{ pack_price?: number | null, unit_price?: number | null, pack_size?: number | null }} row
 * @returns {number | null}
 */
export function effectivePackPrice(row) {
  if (row == null) return null;
  const pp = row.pack_price;
  if (typeof pp === 'number' && Number.isFinite(pp) && pp > 0) return pp;
  const up = row.unit_price;
  const ps = row.pack_size;
  if (
    typeof up === 'number' && Number.isFinite(up) && up > 0 &&
    typeof ps === 'number' && Number.isFinite(ps) && ps > 0
  ) {
    return up * ps;
  }
  return null;
}
