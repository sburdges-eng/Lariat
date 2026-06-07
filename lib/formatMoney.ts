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
  decimals?: 0 | 1 | 2 | 3 | 4;
  /** What to render when the input is null / undefined. Default '—'. */
  nullDisplay?: string;
}

export interface FormatCompactDollarsOpts {
  /** What to render when the input is null / undefined. Default '—'. */
  nullDisplay?: string;
}

function renderFiniteDollars(dollars: number, decimals: 0 | 1 | 2 | 3 | 4): string {
  const negative = dollars < 0;
  const scale = 10 ** decimals;
  const rounded = Math.round(Math.abs(dollars) * scale) / scale;
  const [intPart, fracPart = ''] = rounded.toFixed(decimals).split('.');
  const intWithSep = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = decimals === 0 ? '' : `.${fracPart!.padEnd(decimals, '0')}`;
  const formatted = `$${intWithSep}${cents}`;
  return negative ? `-${formatted}` : formatted;
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
  return renderFiniteDollars(cents / 100, decimals);
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
  return renderFiniteDollars(n, decimals);
}

/**
 * Compact chart-label formatter for dollar values.
 *
 *   formatCompactDollars(1250000)  → '$1.3M'
 *   formatCompactDollars(-1234)    → '-$1k'
 *   formatCompactDollars(null)     → '—'
 */
export function formatCompactDollars(
  dollars: number | string | null | undefined,
  opts: FormatCompactDollarsOpts = {},
): string {
  const nullDisplay = opts.nullDisplay ?? NULL_DISPLAY_DEFAULT;
  if (dollars == null || dollars === '') return nullDisplay;
  const n = typeof dollars === 'number' ? dollars : Number(dollars);
  if (!Number.isFinite(n)) return nullDisplay;

  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${formatDollars(n / 1_000_000, { decimals: 1 })}M`;
  if (abs >= 1_000) return `${formatDollars(n / 1_000, { decimals: 0 })}k`;
  return formatDollars(n, { decimals: 0 });
}
