// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
// Shared helpers for App Router route handlers.
//
// Uses Response.json shape rather than next/server's NextResponse so
// routes that import this remain loadable from the Node test runner.

export function json(body, init) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}
