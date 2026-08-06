/**
 * Derive a unit price for vendor_prices rows that have none.
 *
 * 334 rows carry a name and a SKU and no price. Two sources each hold half of
 * what is needed and neither holds both:
 *
 *   the Master Product Catalog   → how big a case is      (`1/15#/LB` → 15 lb)
 *   sysco / shamrock / photo invoices → what was paid for one ($74.95)
 *
 * `unit_price` is the quotient. The interesting part of this module is not the
 * division; it is the set of situations in which it refuses to divide. Once a
 * derived number is in the table it looks exactly like a vendor-quoted one, so
 * every refusal here is a wrong price that never happened.
 *
 * Nothing is written to the database. The output is a CSV for
 * `scripts/import-vendor-prices.mjs`, which already validates each row and
 * already snapshots vendor_prices_history. A second writer into vendor_prices
 * is what produced the 2026-08-01 breakage in the first place; this does not
 * become one.
 */

/** An item with no price, needing one. */
export interface PricelessItem {
  ingredient: string;
  vendor: string;
  sku: string;
}

/**
 * What an invoice says was paid for one case.
 *
 * `confidence` distinguishes a machine-read PDF/XLS line from OCR of a phone
 * photo of a paper invoice. Photos are the broadest and most recent source the
 * restaurant has, and the worst arithmetic; only the high-confidence ones are
 * divided.
 */
export interface InvoiceQuote {
  pack_price: number;
  source: string;
  date: string;
  confidence: 'invoice' | 'photo-high' | 'photo-low';
}

/** What the catalog says one case holds. */
export interface PackSpec {
  pack_size: number;
  pack_unit: string;
}

export interface DerivedPrice {
  ingredient: string;
  vendor: string;
  sku: string;
  pack_size: number;
  pack_unit: string;
  pack_price: number;
  unit_price: number;
  notes: string;
}

export interface UnresolvedItem {
  ingredient: string;
  sku: string;
  reason: string;
}

export interface DeriveResult {
  derived: DerivedPrice[];
  unresolved: UnresolvedItem[];
}

export type QuoteLookup = (sku: string) => InvoiceQuote | null;
export type PackLookup = (sku: string) => PackSpec | null;

export function derivePrices(
  items: readonly PricelessItem[],
  quoteFor: QuoteLookup,
  packFor: PackLookup,
): DeriveResult {
  const derived: DerivedPrice[] = [];
  const unresolved: UnresolvedItem[] = [];

  for (const item of items) {
    const give = (reason: string): void => {
      unresolved.push({ ingredient: item.ingredient, sku: item.sku, reason });
    };

    const quote = quoteFor(item.sku);
    if (!quote) {
      give('no invoice line for this sku');
      continue;
    }
    if (quote.confidence === 'photo-low') {
      give('only a low-confidence photo line — needs a human to read it');
      continue;
    }
    if (!Number.isFinite(quote.pack_price) || quote.pack_price <= 0) {
      give(`invoice price is not a positive number (${quote.pack_price})`);
      continue;
    }

    const pack = packFor(item.sku);
    if (!pack) {
      give('no case size in the catalog');
      continue;
    }
    if (!Number.isFinite(pack.pack_size) || pack.pack_size <= 0) {
      give(`case size is not a positive number (${pack.pack_size})`);
      continue;
    }

    derived.push({
      ingredient: item.ingredient,
      vendor: item.vendor,
      sku: item.sku,
      pack_size: pack.pack_size,
      pack_unit: pack.pack_unit,
      pack_price: quote.pack_price,
      unit_price: quote.pack_price / pack.pack_size,
      // Provenance is not decoration. A price that came from dividing an OCR'd
      // photo by a catalog pack size must be legible as such later, by someone
      // who was not here.
      notes:
        `derived: ${quote.source} ${quote.date}, ` +
        `$${quote.pack_price} / ${pack.pack_size} ${pack.pack_unit}`,
    });
  }

  return { derived, unresolved };
}

const CSV_COLUMNS = [
  'vendor',
  'vendor_sku',
  'ingredient_name',
  'pack_size',
  'pack_unit',
  'pack_price',
  'unit_price',
  'imported_at',
  'notes',
] as const;

/** RFC-4180 field: quote when it contains a comma, quote, CR or LF. */
function field(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Render derived rows as a CSV `scripts/import-vendor-prices.mjs` accepts.
 *
 * `importedAt` is a parameter rather than `new Date()` so a caller can stamp
 * every row of one run identically and so the output is reproducible in tests.
 */
export function toImporterCsv(
  rows: readonly DerivedPrice[],
  importedAt = '',
): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        field(r.vendor),
        field(r.sku),
        field(r.ingredient),
        field(r.pack_size),
        field(r.pack_unit),
        field(r.pack_price),
        field(r.unit_price),
        field(importedAt),
        field(r.notes),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
