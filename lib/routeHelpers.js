// @ts-check
// Shared helpers for App Router route handlers.
//
// Uses Response.json shape rather than next/server's NextResponse so
// routes that import this remain loadable from the Node test runner.

/**
 * @param {unknown} body
 * @param {ResponseInit} [init]
 */
export function json(body, init) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}
