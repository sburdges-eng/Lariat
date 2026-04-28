// scripts/toast_weekly/router.mjs
//
// Pure file-classifier for the toast-weekly drop folder. No I/O; given
// a filename, returns the ingest "kind" plus any structured metadata
// (period_start, period_end) parsed from the filename.
//
// Centralized here so the orchestrator stays a thin shell and the
// classification rules can be unit-tested without spawning ingest
// scripts or touching the filesystem.
//
// Recognized filename shapes:
//
//   sales-by-date-<anything>.csv     → kind: 'timeseries'  (Toast POS daily)
//   sales-by-day-<anything>.csv      → kind: 'timeseries'  (Toast POS day-of-week)
//   sales-by-time-<anything>.csv     → kind: 'timeseries'  (Toast POS time-of-day)
//   SalesSummary_<start>_<end>.zip   → kind: 'sales_summary' (multi-CSV bundle)
//   LaborBreakDown_<start>_<end>.zip → kind: 'labor'        (summary + by-job)
//
// Anything else                      → kind: 'unknown'

const TIMESERIES_PREFIXES = ['sales-by-date-', 'sales-by-day-', 'sales-by-time-'];

const SALES_SUMMARY_RE = /^SalesSummary_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.zip$/i;
const LABOR_BREAKDOWN_RE = /^LaborBreakDown_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.zip$/i;

/**
 * Classify a single filename. Pure: no fs, no spawn.
 * Returns:
 *   { kind: 'timeseries' | 'sales_summary' | 'labor' | 'unknown',
 *     periodStart?: 'YYYY-MM-DD', periodEnd?: 'YYYY-MM-DD' }
 */
export function classify(filename) {
  if (typeof filename !== 'string' || !filename) {
    return { kind: 'unknown' };
  }
  // Strip any directory component — this stays a pure-string operation.
  const name = filename.replace(/^.*[\\/]/, '');

  for (const prefix of TIMESERIES_PREFIXES) {
    if (name.startsWith(prefix) && name.toLowerCase().endsWith('.csv')) {
      return { kind: 'timeseries' };
    }
  }

  const ssMatch = SALES_SUMMARY_RE.exec(name);
  if (ssMatch) {
    return {
      kind: 'sales_summary',
      periodStart: ssMatch[1],
      periodEnd: ssMatch[2],
    };
  }

  const lbMatch = LABOR_BREAKDOWN_RE.exec(name);
  if (lbMatch) {
    return {
      kind: 'labor',
      periodStart: lbMatch[1],
      periodEnd: lbMatch[2],
    };
  }

  return { kind: 'unknown' };
}

/**
 * Group a list of filenames into the buckets each ingest script needs.
 * Pure. The orchestrator passes this to the runner step.
 *
 * Returns:
 *   { timeseries: string[],            ← .csv filenames (the existing script
 *                                        consumes a directory and picks the
 *                                        newest of each prefix)
 *     salesSummaryZips: string[],      ← one ingest invocation per zip
 *     laborZips: string[],             ← one ingest invocation per zip
 *     unknown: string[] }              ← left in place, logged by the runner
 */
export function group(filenames) {
  const out = {
    timeseries: [],
    salesSummaryZips: [],
    laborZips: [],
    unknown: [],
  };
  for (const f of filenames || []) {
    const cls = classify(f);
    if (cls.kind === 'timeseries') out.timeseries.push(f);
    else if (cls.kind === 'sales_summary') out.salesSummaryZips.push(f);
    else if (cls.kind === 'labor') out.laborZips.push(f);
    else out.unknown.push(f);
  }
  return out;
}
