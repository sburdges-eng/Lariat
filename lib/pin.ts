// Shared PIN-cookie helpers for API routes.
//
// The `lariat_pin_ok=1` cookie is issued by POST /api/auth/pin after the
// manager enters LARIAT_PIN at /login-pin. Middleware.js protects the
// "sensitive" pages (analytics, costing, etc) by redirecting browsers
// without the cookie. API routes that need PIC-level authority (sick
// worker reports, back-dated temp logs, wage actions) perform the same
// check in-route so a curl/replay can't bypass the UI.
//
// Matches the shape of hasPinCookie() in app/api/temp-log/route.js.

/** True when the PIC has entered the PIN in this browser session. */
export function hasPinCookie(req: Request): boolean {
  const raw = req.headers.get('cookie');
  if (!raw) return false;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== 'lariat_pin_ok') continue;
    return part.slice(eq + 1).trim() === '1';
  }
  return false;
}

/** True if the PIN gate is configured at all (env var set). */
export function pinConfigured(): boolean {
  return !!process.env.LARIAT_PIN;
}

/**
 * Default gate for PIC-authority actions: if the PIN is configured,
 * require the cookie. If no PIN configured (LAN-trust single-site
 * deployment), allow through. Matches temp-log back-date logic.
 */
export function pinRequiredForPic(): boolean {
  return pinConfigured();
}
