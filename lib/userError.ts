// Map runtime errors to kitchen-language strings for cook/manager UI.
//
// Closes §7 P3 from the 2026-05-02 breaker audit
// (docs/agentic/findings/2026-05-02-raw-error-messages-violate-ui-copy-rules.md).
//
// Pre-fix every regulated UI surface rendered raw `err.message` to the
// user — "NetworkError when attempting to fetch resource", "TypeError:
// Failed to fetch", or worse. RecipeEditForm.jsx:82 even fell back to
// the literally banned phrase "An error occurred while saving" from
// docs/UI_COPY_RULES.md §AVOID.
//
// Contract:
//   - Network-failure shapes (fetch TypeError, NetworkError, AbortError)
//     → "Lost connection. Try again."
//   - Generic TypeError → "Did not save. Try again."
//   - Default → "Something broke. Try again."
//
// The original error is NOT discarded — callers should `console.error`
// it for debug. This helper only produces what the cook sees.
//
// Pattern reference: app/gold-stars/GoldStarBoard.tsx:147 already
// shipped "Lost connection. Try again." as the precedent.

const NETWORK_FALLBACK = 'Lost connection. Try again.';
const SAVE_FALLBACK = 'Did not save. Try again.';
const GENERIC_FALLBACK = 'Something broke. Try again.';

export function humanize(err: unknown): string {
  if (err == null) return GENERIC_FALLBACK;

  // TypeError shape from fetch is the load-bearing case for iPad on
  // a flaky kitchen LAN. Both the constructor and the message hint
  // the same shape; checking either is enough.
  if (err instanceof TypeError) {
    const msg = err.message || '';
    if (/fetch|network|load failed/i.test(msg)) return NETWORK_FALLBACK;
    return SAVE_FALLBACK;
  }

  // Native NetworkError (rare in modern browsers but defensible).
  // Also covers DOMException 'NetworkError'.
  if (typeof err === 'object' && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') {
      if (/network|abort/i.test(name)) return NETWORK_FALLBACK;
    }
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && /network|fetch|load failed/i.test(msg)) {
      return NETWORK_FALLBACK;
    }
  }

  if (typeof err === 'string') {
    if (/network|fetch|load failed|connection/i.test(err)) return NETWORK_FALLBACK;
  }

  return GENERIC_FALLBACK;
}
