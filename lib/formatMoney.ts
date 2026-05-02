// Canonical money formatter.
//
// Closes §7 P2 from the 2026-05-02 breaker audit
// (docs/agentic/findings/2026-05-02-no-canonical-money-formatter.md).
// Pre-fix every dollar-displaying surface rolled its own
// `$${Number(n).toFixed(2)}` pattern with three flavors of drift:
//   - 2 vs 4 decimals (manager saw same vendor priced differently)
//   - $-12.34 instead of -$12.34 on negatives
//   - missing Number() coerce → .toFixed crash on string input
//   - inconsistent null fallback ('—' / '-' / blank)
//
// Contract:
//   - INTEGER cents in, formatted string out (no float drift in math).
//   - null / undefined → `opts.nullDisplay` (default '—').
//   - Negative: `-$12.34` (sign BEFORE currency symbol).
//   - Thousands separator on the dollar component: `$1,234.56`.
//   - decimals: 2 by default; 4 for vendor unit-price surfaces.
//
// Companion `formatDollars(dollars, opts)` keeps existing call sites
// clean — every page in the audit was passing dollar floats from the
// API. We round-then-format internally, keeping the cents-truth
// invariant.

const NULL_DISPLAY_DEFAULT = '—'; // em dash

export interface FormatMoneyOpts {
  /** 2 (default) for kitchen/manager UI, 4 for vendor unit-price tables. */
  decimals?: 2 | 4;
  /** What to render when the input is null / undefined. Default '—'. */
  nullDisplay?: string;
}

/**
 * Format INTEGER cents as a money string. NaN / non-finite inputs
 * are treated as null.
 *
 *   formatMoney(1234)       → '$12.34'
 *   formatMoney(-1234)      → '-$12.34'
 *   formatMoney(1234567)    → '$12,345.67'
 *   formatMoney(null)       → '—'
 *   formatMoney(0)          → '$0.00'
 *   formatMoney(1234, { decimals: 4 }) → '$12.3400'
 */
export function formatMoney(
  cents: number | null | undefined,
  opts: FormatMoneyOpts = {},
): string {
  const nullDisplay = opts.nullDisplay ?? NULL_DISPLAY_DEFAULT;
  if (cents == null) return nullDisplay;
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return nullDisplay;

  const decimals = opts.decimals ?? 2;
  const negative = cents < 0;
  const abs = Math.abs(cents);

  // For 2-decimal output, INTEGER cents → divide by 100 and toFixed(2).
  // For 4-decimal output, INTEGER cents → divide by 100, toFixed(4) gives
  // two trailing zeros (12.3400) which is the canonical "cents-aware
  // sub-cent" rendering. The vendor-prices surfaces want sub-cent
  // precision; the underlying value is still INTEGER cents at the call
  // site (no float-drift in storage / math).
  const dollars = abs / 100;
  const [intPart, fracPart = ''] = dollars.toFixed(decimals).split('.');
  // Thousands separator on the integer side only.
  const intWithSep = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const formatted = `$${intWithSep}.${fracPart!.padEnd(decimals, '0')}`;
  return negative ? `-${formatted}` : formatted;
}

/**
 * Format a dollar float as money. Convenience wrapper for callers
 * that hold dollars instead of cents (most existing UI surfaces).
 *
 *   formatDollars(12.34)     → '$12.34'
 *   formatDollars(-12.34)    → '-$12.34'
 *   formatDollars('12.34')   → '$12.34'  (string-coerced via Number)
 *   formatDollars(null)      → '—'
 *
 * Uses Math.round on the cents to match the existing
 * `Number(n).toFixed(2)` convention without introducing a new
 * rounding bias.
 */
export function formatDollars(
  dollars: number | string | null | undefined,
  opts: FormatMoneyOpts = {},
): string {
  const nullDisplay = opts.nullDisplay ?? NULL_DISPLAY_DEFAULT;
  if (dollars == null || dollars === '') return nullDisplay;
  const n = typeof dollars === 'number' ? dollars : Number(dollars);
  if (!Number.isFinite(n)) return nullDisplay;

  const decimals = opts.decimals ?? 2;
  // Internal: convert to cents at the precision the caller requested.
  // For 2-decimal output we round to whole cents. For 4-decimal output
  // we keep the sub-cent resolution by scaling by 10000 first.
  const scale = decimals === 4 ? 10000 : 100;
  const scaled = Math.round(n * scale);
  // Re-render via formatMoney so sign/separator/null logic stays in
  // one place. For 4-decimal we pass scaled-cents and request 4
  // decimals; helper treats that as cents-with-trailing-zeros, which
  // doesn't fit perfectly. Simpler: inline render here at 4-dec.
  if (decimals === 4) {
    const negative = scaled < 0;
    const abs = Math.abs(scaled);
    // abs is in 1/100-cent units; divide by 10000 to get dollars.
    const dollarsAbs = abs / 10000;
    const [intPart, fracPart = ''] = dollarsAbs.toFixed(4).split('.');
    const intWithSep = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const out = `$${intWithSep}.${fracPart!.padEnd(4, '0')}`;
    return negative ? `-${out}` : out;
  }
  return formatMoney(scaled, opts);
}
