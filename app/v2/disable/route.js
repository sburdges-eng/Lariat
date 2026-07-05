// GET /v2/disable — one-tap opt-out of the v2 preview cookie.
//
// Visiting this URL clears `lariat_v2` and lands back on v1's `/`. The
// cutover plan's rollback step 1 is "put operators back on v1
// immediately" (docs/V2_CUTOVER_PLAN.md) — this is that action for a
// single device, without touching the browser's cookie settings.

export const dynamic = 'force-dynamic';

// Mirrors app/v2/layout.jsx's V2_PREVIEW_COOKIE — kept as a local literal
// (not a cross-import) because layout.jsx is JSX and can't be loaded by
// the plain-Node test harness that exercises this route directly.
const V2_PREVIEW_COOKIE = 'lariat_v2';

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${V2_PREVIEW_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
    },
  });
}
