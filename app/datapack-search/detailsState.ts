// Pure state-machine helper for DatapackSearchClient's per-row drill-in
// panel. Lives in its own module (rather than inline in the .jsx) so
// `node --test` can import it without dragging in React/JSX, and so
// the click handler can read+write `details` through a functional
// `setDetails((prev) => …)` updater without closing over state.
//
// Each row's state is keyed by `${source}:${id}` (see hitKey in the
// client component) and is one of:
//   undefined                   — never opened
//   { status: 'loading' }       — fetch in flight
//   { status: 'ok',    data }   — payload cached and panel open
//   { status: 'error', error }  — fetch failed; panel open showing err
//   { status: 'closed', data? } — panel collapsed; `data` preserved so
//                                 a future click re-opens without a
//                                 refetch
//
// The four actions returned correspond to the four user-visible
// transitions (plus the loading-noop guard):
//
//   'open-fresh'    — no cache; caller should kick off the fetch.
//                     `next[key]` is set to {status:'loading'}.
//   'reopen-cached' — closed-but-cached; flip back to {status:'ok'}.
//                     No fetch.
//   'collapse'      — currently open (loading/ok/error); flip to
//                     status:'closed', preserving any cached `data`.
//   'noop-loading'  — a fetch is already in flight; click is dropped.
//                     `next === prev`.
//
// The function MUST stay deterministic — no Date.now / Math.random —
// because React 18 may invoke the updater twice in StrictMode and
// both invocations need to converge on the same result.

export type DetailStatus = 'loading' | 'ok' | 'error' | 'closed';

export type DetailEntry =
  | { status: 'loading' }
  | { status: 'ok'; data: unknown }
  | { status: 'error'; error: string; data?: unknown }
  | { status: 'closed'; data?: unknown };

export type DetailsMap = Record<string, DetailEntry>;

export type ToggleAction =
  | 'open-fresh'
  | 'reopen-cached'
  | 'collapse'
  | 'noop-loading';

export interface NextDetailsResult {
  next: DetailsMap;
  action: ToggleAction;
}

export function nextDetails(
  prev: DetailsMap,
  key: string
): NextDetailsResult {
  const existing = prev?.[key];

  // Concurrent-click guard: if a fetch for this row is already in
  // flight, drop the click. The pending setDetails after the fetch
  // resolves will surface the result.
  if (existing && existing.status === 'loading') {
    return { next: prev, action: 'noop-loading' };
  }

  // Collapse on a click against any open state (ok/error). Preserve
  // `data` so a future click can re-open without a refetch.
  if (existing && existing.status !== 'closed') {
    return {
      next: { ...prev, [key]: { ...existing, status: 'closed' } },
      action: 'collapse',
    };
  }

  // Re-open a previously-closed row that still has a cached payload —
  // no fetch needed.
  if (existing && existing.status === 'closed' && existing.data !== undefined) {
    return {
      next: { ...prev, [key]: { status: 'ok', data: existing.data } },
      action: 'reopen-cached',
    };
  }

  // No cache (never opened, or closed without a cached payload): mark
  // loading and tell the caller to fetch.
  return {
    next: { ...prev, [key]: { status: 'loading' } },
    action: 'open-fresh',
  };
}
