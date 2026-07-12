// @ts-check
import { NextResponse } from 'next/server';
import { verifyPinCookieValue } from './lib/pinCookie';

/** @typedef {import('next/server').NextRequest} NextRequest */

/** Paths that show financial / sensitive v2 data when PIN is configured */
const SENSITIVE_PREFIXES = [
  '/analytics',
  '/costing',
  '/purchasing',
  '/menu-engineering',
  '/beo',
  '/management',
  '/morning',
  '/booking',
  '/playbook',
  '/shows',
  '/specials/saved',
  '/host',
  '/v2/command',
  '/v2/management',
  '/v2/analytics',
  '/api/costing',
  '/api/analytics',
  '/api/menu-engineering',
  '/api/beo',
  '/api/morning',
  '/api/audit',
  '/api/compute',
  '/api/shows',
  '/api/specials/saved',
  '/api/host',
  '/api/purchasing',
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

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isSensitive(pathname) {
  if (PUBLIC_CARVEOUTS.some((p) => pathname.startsWith(p))) return false;
  return SENSITIVE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * @param {NextRequest} request
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;
  if (pathname === '/login-pin') return NextResponse.next();

  if (!isSensitive(pathname)) return NextResponse.next();

  const pin = process.env.LARIAT_PIN;
  const pinSecret = process.env.LARIAT_PIN_SECRET;
  if (!pin) {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'PIN setup required' },
        { status: 503, headers: { 'cache-control': 'no-store' } },
      );
    }
    const setup = new URL('/login-pin', request.url);
    setup.searchParams.set('next', pathname + request.nextUrl.search);
    setup.searchParams.set('setup', '1');
    return NextResponse.redirect(setup);
  }

  const raw = request.cookies.get('lariat_pin_ok')?.value;
  if (await verifyPinCookieValue(raw, pinSecret)) return NextResponse.next();

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
    '/morning',
    '/morning/:path*',
    '/booking/:path*',
    '/playbook/:path*',
    '/shows/:path*',
    '/specials/saved',
    '/specials/saved/:path*',
    '/host/:path*',
    '/v2/command',
    '/v2/management',
    '/v2/analytics',
    '/login-pin',
    '/api/costing/:path*',
    '/api/analytics/:path*',
    '/api/menu-engineering/:path*',
    '/api/beo/:path*',
    '/api/morning',
    '/api/morning/:path*',
    '/api/audit/:path*',
    '/api/compute/:path*',
    '/api/shows/:path*',
    '/api/specials/saved',
    '/api/specials/saved/:path*',
    '/api/host/:path*',
    '/api/purchasing/:path*',
  ],
};
