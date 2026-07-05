// GET /v2/enable — one-tap bootstrap for the v2 preview cookie.
//
// Visiting this URL sets `lariat_v2=1` and lands on /v2/today. Replaces
// the devtools-cookie-editing step for onboarding a Stage-1 pilot device
// (docs/OPERATIONS_HANDOFF.md §2) with a single URL a device can visit
// or bookmark once. Max-Age mirrors the locale cookie's 1-year lifetime
// (app/_components/LocalePicker.jsx) — a standing opt-in, not a session.

export const dynamic = 'force-dynamic';

// Mirrors app/v2/layout.jsx's V2_PREVIEW_COOKIE — kept as a local literal
// (not a cross-import) because layout.jsx is JSX and can't be loaded by
// the plain-Node test harness that exercises this route directly.
const V2_PREVIEW_COOKIE = 'lariat_v2';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function GET() {
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/v2/today',
      'Set-Cookie': `${V2_PREVIEW_COOKIE}=1; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`,
    },
  });
}
