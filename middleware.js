import { NextResponse } from 'next/server';
import { verifyPinCookieValue } from './lib/pinCookie';

const PIN = process.env.LARIAT_PIN;
const PIN_SECRET = process.env.LARIAT_PIN_SECRET;

/** Paths that show financial / sensitive v2 data when PIN is configured */
const SENSITIVE_PREFIXES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/booking',
  '/playbook',
  '/shows',
  '/specials/saved',
  '/host',
  '/api/costing',
  '/api/analytics',
  '/api/menu-engineering',
  '/api/beo',
  '/api/audit',
  '/api/compute',
  '/api/shows',
  '/api/specials/saved',
  '/api/host',
];

/** Public carve-outs inside otherwise-PIN-gated prefixes. Order matters:
 *  the client-share BEO doc is intentionally guest-readable via an
 *  unguessable token in the URL, so we exempt it from the PIN redirect.
 *  Both the page route and its read+sign API endpoints must be public.
 */
const PUBLIC_CARVEOUTS = [
  '/beo/share/',
  '/api/beo/share/',
];

function isSensitive(pathname) {
  if (PUBLIC_CARVEOUTS.some((p) => pathname.startsWith(p))) return false;
  return SENSITIVE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request) {
  if (!PIN) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === '/login-pin') return NextResponse.next();

  if (!isSensitive(pathname)) return NextResponse.next();

  const raw = request.cookies.get('lariat_pin_ok')?.value;
  if (await verifyPinCookieValue(raw, PIN_SECRET)) return NextResponse.next();

  const login = new URL('/login-pin', request.url);
  login.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    '/analytics/:path*',
    '/costing/:path*',
    '/purchasing/:path*',
    '/menu-engineering/:path*',
    '/beo/:path*',
    '/management/:path*',
    '/booking/:path*',
    '/playbook/:path*',
    '/shows/:path*',
    '/specials/saved',
    '/specials/saved/:path*',
    '/host/:path*',
    '/login-pin',
    '/api/costing/:path*',
    '/api/analytics/:path*',
    '/api/menu-engineering/:path*',
    '/api/beo/:path*',
    '/api/audit/:path*',
    '/api/compute/:path*',
    '/api/shows/:path*',
    '/api/specials/saved',
    '/api/specials/saved/:path*',
    '/api/host/:path*',
  ],
};
