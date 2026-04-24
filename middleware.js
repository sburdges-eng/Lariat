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
  '/api/costing',
  '/api/analytics',
  '/api/menu-engineering',
  '/api/beo',
  '/api/audit',
];

function isSensitive(pathname) {
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
    '/login-pin',
    '/api/costing/:path*',
    '/api/analytics/:path*',
    '/api/menu-engineering/:path*',
    '/api/beo/:path*',
    '/api/audit/:path*',
  ],
};
