// Shared helpers for entity backfill modules. Pure-string utilities only;
// no DB or fs. Tested via the modules that consume them.

const VENDOR_NORMALIZE_DROP = /[^a-z0-9]+/g;

/**
 * Vendor names land in vendor_prices/bom_lines/invoices as free-text:
 * "Shamrock", "shamrock", "SHAMROCK FOODS, INC.", "Shamrock Foods" all
 * mean the same thing. We pick a canonical external_id by lower-casing,
 * stripping non-alphanum, and collapsing internal whitespace to '_'.
 *   "Shamrock Foods, Inc." → "shamrock_foods_inc"
 *   "SYSCO  " → "sysco"
 *   "" / null → "" (caller should skip)
 */
export function vendorExternalId(raw) {
  if (raw == null) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(VENDOR_NORMALIZE_DROP, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Decide which `source_system` enum to tag a vendor row with based on its
 * normalized name. Known invoice-issuing vendors get their own source so
 * downstream readers can filter "Shamrock-only spend" without joining
 * against entities_vendors. Everything else → 'manual'.
 */
export function vendorSourceSystem(externalId) {
  if (!externalId) return 'manual';
  if (externalId.startsWith('shamrock')) return 'shamrock';
  if (externalId.startsWith('sysco')) return 'sysco';
  if (externalId.startsWith('webstaurant')) return 'webstaurant';
  return 'manual';
}

/**
 * Build a stable external_id for a Toast-labor employee row. Toast doesn't
 * give us a stable per-employee ID across periods — only chosen_name,
 * first_name, last_name, job_title fields. We compose them in priority
 * order: chosen_name, else "first|last", else "first|last|job_title".
 *
 * Same person + new job title → distinct rows in toast_labor_by_job →
 * we pick the first; entity-resolution to merge them is a Phase-3 task.
 */
export function toastLaborExternalId({ chosen_name, first_name, last_name, job_title }) {
  const cn = (chosen_name ?? '').trim();
  if (cn) return `chosen:${cn.toLowerCase()}`;
  const fn = (first_name ?? '').trim();
  const ln = (last_name ?? '').trim();
  if (fn || ln) {
    const jt = (job_title ?? '').trim();
    const tail = jt ? `|${jt.toLowerCase()}` : '';
    return `name:${fn.toLowerCase()}|${ln.toLowerCase()}${tail}`;
  }
  return '';
}

/** Tally helper for backfill modules. Returns the running totals object. */
export function makeTally() {
  return { created: 0, reused: 0, skipped: 0, errors: 0 };
}

export function bumpTally(tally, result) {
  if (result === 'created') tally.created++;
  else if (result === 'reused') tally.reused++;
  else if (result === 'skipped') tally.skipped++;
  else if (result === 'error') tally.errors++;
}
