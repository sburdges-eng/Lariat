// Test-only loader hook that redirects `next/headers` imports to a
// local mock in this same directory. Used by tests that need to
// exercise route handlers which call `cookies()` from `next/headers`.
//
// Next.js normally runs route handlers inside a request-scoped
// AsyncLocalStorage context so `cookies()` can read per-request
// state. Under plain `node --test`, there's no Next runtime, so
// `cookies()` throws "was called outside a request scope". Rather
// than stand up a full Next context, we swap the module for a
// minimal mock whose cookie values are controlled by the test via
// `__setCookies`.
//
// Register this BEFORE resolver.mjs if both are needed, e.g.:
//   register(new URL('./next-headers-mock-loader.mjs', import.meta.url));
//   register(new URL('./resolver.mjs', import.meta.url));

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const MOCK_URL = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'next-headers-mock.mjs')
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') {
    return {
      url: MOCK_URL,
      format: 'module',
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
