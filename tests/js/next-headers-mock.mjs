// Test-only mock for `next/headers`. Loaded in place of the real
// module by next-headers-mock-loader.mjs.
//
// Exposes the same surface route handlers use (`cookies()`), plus
// a test-only `__setCookies(map)` helper that lets a test stage the
// cookie jar the next handler call will see. Pattern mirrors
// `setDbPathForTest()` in lib/db.ts — test-only hook, production
// code never calls it.

let _cookieMap = new Map();

/**
 * Test-only: replace the cookie jar that the next `cookies()` call
 * will return. Pass an object or Map; call with no argument to clear.
 */
export function __setCookies(map) {
  _cookieMap = new Map();
  if (!map) return;
  if (map instanceof Map) {
    for (const [k, v] of map) _cookieMap.set(k, String(v));
  } else {
    for (const [k, v] of Object.entries(map)) _cookieMap.set(k, String(v));
  }
}

/**
 * Mock implementation of Next's `cookies()`. Returns an object with
 * the subset of the real API that Lariat's route handlers use:
 *   .get(name) → { name, value } | undefined
 *
 * Like the real one, this is async (handlers use `await cookies()`).
 */
export async function cookies() {
  return {
    get(name) {
      const value = _cookieMap.get(name);
      return value === undefined ? undefined : { name, value };
    },
  };
}

/**
 * Mock `headers()` — present for completeness, returns an empty
 * Headers. Route handlers in this codebase don't call it, but leave
 * the export so any future code that does won't crash the mock.
 */
export async function headers() {
  return new Headers();
}
