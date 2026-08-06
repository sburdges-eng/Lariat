/**
 * Parser for the "Master Product Catalog" export (Sysco + Shamrock merged).
 *
 * Two things about this file break naive readers, and both did real damage on
 * 2026-08-01 — see tests/js/test-master-catalog-parse.mjs for the incident.
 *
 *  1. Line 1 is `0,1,2,...,9`. The real header is on line 2. Read line 1 as the
 *     header and every column is named "0".."9", so there is no `Price` column
 *     to find and every row imports price-less.
 *  2. `Pack Size` holds the case breakdown — `1/15/LB`, `4/1 GAL/GAL`,
 *     `6/#10/CT` — on 730 of 752 rows. That is the only record anywhere of how
 *     big a case is, and it is what unit_price has to be derived from.
 *
 * The governing rule here is that a wrong number is worse than a missing one.
 * A price-less row in vendor_prices reads as "we don't know what this costs"
 * and silently shadows a correctly-priced row for the same item; a guessed
 * pack size produces a confident, wrong cost. So anything this parser cannot
 * read exactly, it refuses by name, and the caller reports it.
 *
 * `scripts/import-vendor-prices.mjs` is the importer for a real price list.
 * This is a different file with a different shape; both funnel through
 * `validateVendorPriceRow` in lib/vendorPricesRepo.ts before anything is
 * written.
 */

import { normalizeUnit, unitDimension } from './unitConvert.mjs';

/** Vendor unit abbreviations that lib/unitConvert.mjs does not itself know. */
const UNIT_ALIASES: Record<string, string> = {
  GL: 'gal',
  FOZ: 'floz',
  FO: 'floz',
  PCE: 'pc',
  DZ: 'doz',
  // "pound average" — a catch weight. The price is per pound either way, so
  // for costing this is a pound; the averaging lives on the invoice side.
  LBAV: 'lb',
  PAC: 'pk',
};

/** Units that describe a shape, not an amount. Nothing can be costed from these. */
const DIMENSIONAL = /^(IN|FT|")$/i;

export interface PackSizeOk {
  pack_size: number;
  pack_unit: string;
}
export interface PackSizeFail {
  pack_size: null;
  reason: string;
}
export type PackSizeResult = PackSizeOk | PackSizeFail;

function fail(reason: string): PackSizeFail {
  return { pack_size: null, reason };
}

/** Resolve a vendor unit token to one lib/unitConvert.mjs recognises. */
function resolveUnit(raw: string): string | null {
  const t = raw.trim().replace(/\.$/, '');
  if (!t) return null;
  if (DIMENSIONAL.test(t)) return null;
  const aliased = UNIT_ALIASES[t.toUpperCase()] ?? t;
  const canon = normalizeUnit(aliased);
  return unitDimension(canon) ? canon : null;
}

/**
 * Read one `Pack Size` cell into a total case size.
 *
 * The grammar is `COUNT / SIZE[UNIT] / OUTER_UNIT`, where the outer unit is
 * sometimes blank and the inner size sometimes carries its own unit:
 *
 *   1/15/LB      → 15 lb      (one 15 lb bag)
 *   2/5 LB/LB    → 10 lb      (two 5 lb bags)
 *   4/5LB/LB     → 20 lb      (no space before the inner unit)
 *   4/1 GAL/GL   → 4 gal      (GL is Sysco's spelling of gallon)
 *   10/12 OZ/    → 120 oz     (outer unit missing; inner one carries it)
 *   6/#10/CT     → 6 ct       (#10 is a can format, not ten of anything)
 *   1/EACH/EA    → 1 ea
 */
export function parsePackSize(raw: string | null | undefined): PackSizeResult {
  const text = (raw ?? '').trim();
  if (!text) return fail('pack size is blank');

  const parts = text.split('/');
  if (parts.length !== 3) {
    return fail(`pack size "${text}" is not COUNT/SIZE/UNIT`);
  }
  // Defaults keep noUncheckedIndexedAccess happy; length is already checked.
  const [countTok = '', sizeTok = '', outerTok = ''] = parts.map((p) => p.trim());

  // An average-weight range ("6-9#AV") is a catch weight. Picking a midpoint
  // would be inventing a number, so refuse and let a human decide.
  if (/\d\s*-\s*\d/.test(sizeTok) || /\bAV\b|#AV/i.test(sizeTok)) {
    return fail(`pack size "${text}" is an average-weight range`);
  }

  // Inches, feet, quote-marks: a dimension, not an amount. Paper goods and
  // pans land here and cannot be costed by weight or volume.
  if (DIMENSIONAL.test(outerTok) || /["']|\bIN\b|\bFT\b/i.test(sizeTok)) {
    return fail(`pack size "${text}" is a dimension, not a weight or volume`);
  }

  const count = Number(countTok);
  if (!Number.isFinite(count) || count <= 0) {
    return fail(`pack size "${text}" has no readable case count`);
  }

  // The inner size may be "15", "5 LB", "5LB", "15#", "#10" or "EACH".
  //
  // '#' means opposite things depending on which side of the number it sits.
  // Trailing ("15#") is the trade shorthand for pounds. Leading ("#10") is a
  // can format and names no weight at all — that one falls through to the
  // container branch below, where the case count is the pack size.
  const sizeMatch = /^([\d.]+)\s*(#|[A-Za-z]*)$/.exec(sizeTok);

  let total: number;
  let unitTok: string;

  if (sizeMatch) {
    const inner = Number(sizeMatch[1]);
    if (!Number.isFinite(inner) || inner <= 0) {
      return fail(`pack size "${text}" has no readable inner size`);
    }
    total = count * inner;
    // The inner unit wins when it has one, because it is the unit of the
    // number just multiplied. `6/100 OZ/CAN` is 600 ounces held in six cans;
    // taking the outer "CAN" would report 600 cans. The outer column names the
    // container, which is only the right unit when the inner size is bare
    // ("1/15/LB") or unreadable ("12/.5 PTS/PT").
    const innerRaw = sizeMatch[2] === '#' ? 'lb' : (sizeMatch[2] ?? '');
    unitTok = resolveUnit(innerRaw) ? innerRaw : outerTok || innerRaw;
  } else {
    // "#10", "EACH" — the inner token names a container, so the case count
    // IS the pack size and the unit has to come from the outer column.
    total = count;
    unitTok = outerTok || 'ea';
  }

  const unit = resolveUnit(unitTok);
  if (!unit) {
    return fail(`pack size "${text}" has no usable unit ("${unitTok}")`);
  }
  return { pack_size: Number(total.toFixed(6)), pack_unit: unit };
}

export interface CatalogRow {
  ingredient: string;
  vendor: string;
  sku: string;
  pack_size: number;
  pack_unit: string;
  pack_price: number;
  unit_price: number;
  category: string | null;
}

export interface SkippedRow {
  ingredient: string;
  line: number;
  reason: string;
  vendor: string;
  sku: string;
  /**
   * The case size, when it was readable — kept even though the row is not
   * importable. This file is the only place that records how big a case is;
   * invoices record what was paid FOR a case. Neither alone yields a cost per
   * pound, so a row skipped for a missing price must not take its pack size
   * down with it. Null when the pack itself was what failed.
   */
  pack_size: number | null;
  pack_unit: string | null;
}

export interface CatalogParseResult {
  rows: CatalogRow[];
  skipped: SkippedRow[];
  /** Data rows seen, excluding the junk line, the header and blank lines. */
  total: number;
}

/** RFC-4180-ish tokeniser. Returns raw rows so the caller picks the header. */
function splitCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: string[] = [];
    for (;;) {
      let field = '';
      if (text[i] === '"') {
        i++;
        while (i < text.length) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            i++;
            break;
          }
          field += text[i++];
        }
      } else {
        while (i < text.length && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
      }
      row.push(field);
      if (text[i] === ',') {
        i++;
        continue;
      }
      break;
    }
    while (text[i] === '\r' || text[i] === '\n') i++;
    rows.push(row);
  }
  return rows;
}

const REQUIRED = ['Description', 'Pack Size', 'Price', 'Supplier'];

/**
 * Parse the whole catalog. Rows that cannot be costed exactly are returned in
 * `skipped` with a reason rather than imported half-formed.
 */
export function parseMasterCatalog(text: string): CatalogParseResult {
  const raw = splitCsvRows(text).filter(
    (r) => r.length > 1 || (r[0] ?? '').trim() !== '',
  );

  // Find the real header rather than assuming row 0 — the export's first line
  // is a positional index (`0,1,2,...`) that looks like a header and is not.
  const headerIdx = raw.findIndex((r) => {
    const cells = r.map((c) => c.trim());
    return REQUIRED.every((h) => cells.includes(h));
  });
  if (headerIdx === -1) {
    throw new Error(
      `master catalog: no header row found (need ${REQUIRED.join(', ')}). ` +
        'The first line of this export is a positional index, not a header.',
    );
  }

  const header = raw[headerIdx]!.map((c) => c.trim());
  const col = (r: string[], name: string): string =>
    (r[header.indexOf(name)] ?? '').trim();

  const rows: CatalogRow[] = [];
  const skipped: SkippedRow[] = [];
  let total = 0;

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i]!;
    const ingredient = col(r, 'Description');
    if (!ingredient) continue; // trailing blank / spacer line
    total++;
    const line = i + 1;

    // Parse the pack and identity FIRST, so a row that fails on price alone
    // still carries the case size out with it (see SkippedRow.pack_size).
    const pack = parsePackSize(col(r, 'Pack Size'));
    const vendor = col(r, 'Supplier').toLowerCase();
    const sku = col(r, 'Supplier Product #');
    const skip = (reason: string): void => {
      skipped.push({
        ingredient,
        line,
        reason,
        vendor,
        sku,
        pack_size: pack.pack_size === null ? null : pack.pack_size,
        pack_unit: pack.pack_size === null ? null : pack.pack_unit,
      });
    };

    const priceRaw = col(r, 'Price').replace(/[$,]/g, '');
    const price = Number(priceRaw);
    if (!priceRaw || !Number.isFinite(price) || price <= 0) {
      skip('no price in the catalog');
      continue;
    }

    if (pack.pack_size === null) {
      skip(pack.reason);
      continue;
    }

    if (!vendor) {
      skip('no supplier');
      continue;
    }

    rows.push({
      ingredient,
      vendor,
      sku,
      pack_size: pack.pack_size,
      pack_unit: pack.pack_unit,
      pack_price: price,
      unit_price: price / pack.pack_size,
      category: col(r, 'Category') || null,
    });
  }

  return { rows, skipped, total };
}
