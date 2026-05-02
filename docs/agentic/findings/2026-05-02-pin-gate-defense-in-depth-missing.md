# Breaker Audit Finding

**Subsystem:** PIN gate / manager routes / replay-curl protection (Section 2)

**Invariant:** Every API route under `SENSITIVE_PREFIXES` must call `hasPinCookie()` from `lib/pin.ts` in addition to the middleware gate. Source: `docs/ARCHITECTURE.md §4` ("PIN gate") and `lib/pin.ts:1-8`:

> "API routes that need PIC-level authority (sick worker reports, back-dated temp logs, wage actions) perform the same check in-route so a curl/replay can't bypass the UI."

**Break attempt:** Compare the set of routes the middleware matcher protects to the set of routes that do an in-route `hasPinCookie()` re-check.

```bash
# Routes the middleware matcher claims to protect:
grep -A2 "/api/.*:path\*" middleware.js | grep "/api/" | sort -u

# Routes that perform an in-route re-check:
grep -rl "hasPinCookie\|pinRequiredForPic" app/api
```

**Observed result:** **10 routes are matcher-protected but lack the in-route `hasPinCookie()` re-check.**

| Route | File |
|---|---|
| `GET /api/costing` | `app/api/costing/route.js` |
| `GET POST /api/costing/depletion-exceptions` | `app/api/costing/depletion-exceptions/route.js` |
| `GET POST /api/costing/pack-changes` | `app/api/costing/pack-changes/route.js` (just touched in #103!) |
| `GET /api/analytics` | `app/api/analytics/route.js` |
| `GET /api/menu-engineering` | `app/api/menu-engineering/route.js` |
| `GET /api/menu-engineering/margin-deltas` | `app/api/menu-engineering/margin-deltas/route.js` |
| `GET /api/beo` | `app/api/beo/route.js` |
| `GET /api/beo/prep-history` | `app/api/beo/prep-history/route.js` |
| `GET /api/audit/log` | `app/api/audit/log/route.js` |
| `POST /api/compute/status` | `app/api/compute/status/route.js` (CLAUDE.md explicitly says PIN-gated) |

**Expected result:** Each route opens its handler with:

```js
import { hasPinCookie, pinRequiredForPic } from '../../../lib/pin';
...
async function requirePin(req) {
  if (pinRequiredForPic() && !(await hasPinCookie(req))) {
    return Response.json({ error: 'PIN required' }, { status: 401 });
  }
  return null;
}
export async function GET(req) {
  const pinFail = await requirePin(req);
  if (pinFail) return pinFail;
  ...
}
```

This is the established pattern in the Phase 2 / specials-persistence routes (e.g. `app/api/shows/[id]/box-office/[lineId]/route.js:27-32`, `app/api/specials/saved/[id]/route.js`).

**Risk:** Defense-in-depth gap on financial / regulated surfaces. The middleware does protect these routes today, so this is **not a current data leak**. But the doctrine says both layers — and three concrete failure modes break that:

1. **Matcher gap on a future addition.** When a new sub-route is added under `/api/audit/...` without the matcher being updated, in-route checks would catch it; today, nothing catches it.
2. **Middleware misconfiguration.** A typo in `middleware.js` config (e.g. `/api/costig/:path*`), an env-var difference between dev and prod, or a Next.js middleware bug means everything under that prefix becomes unprotected.
3. **Same-origin SSRF / fetch from a public route.** A future bug in a non-sensitive route that proxies to one of these endpoints could expose the data without ever hitting the middleware.

The most exposed single endpoint is `/api/audit/log` — it returns the entire append-only audit trail, which contains every regulated mutation. A middleware regression there is a compliance-critical exposure.

**Repro command:**
```bash
# Confirm the 10-route gap:
for d in costing analytics menu-engineering beo audit compute; do
  for f in $(find app/api/$d -name "route.*" 2>/dev/null); do
    if ! grep -q "hasPinCookie\|pinRequiredForPic" "$f"; then echo "  $f"; fi
  done
done
```

**Likely files:**
- `app/api/costing/route.js`
- `app/api/costing/depletion-exceptions/route.js`
- `app/api/costing/pack-changes/route.js`
- `app/api/analytics/route.js`
- `app/api/menu-engineering/route.js`
- `app/api/menu-engineering/margin-deltas/route.js`
- `app/api/beo/route.js`
- `app/api/beo/prep-history/route.js`
- `app/api/audit/log/route.js`
- `app/api/compute/status/route.js`
- New: `tests/js/test-pin-defense-in-depth.mjs` — pin the contract: every SENSITIVE_PREFIXES route returns 401 without the cookie

**Fix class:** logic + test (small, mechanical edit to each route)

**Priority:** **P1** — defense-in-depth on financial/regulated/audit surfaces. Not a current leak; one regression away from being one.

---

## Optional notes

- The fix is mechanical and ~3 lines per route. A single PR adds the import + `requirePin()` helper (or imports a shared one) + the early-return at the top of each handler.
- Better long-term: a `withPin(handler)` wrapper or a custom matcher that auto-injects the check. That's a refactor (`REFACTOR_GOVERNANCE.md`), not this finding.
- Verified-correct in this sweep:
  - HMAC cookie shape (`lib/pinCookie.ts`) — constant-time compare, length check, v1 prefix, legacy fallback gated on `LARIAT_PIN_SECRET` unset.
  - Cookie attributes (`app/api/auth/pin/route.js::cookieHeader`) — HttpOnly, SameSite=Strict, Max-Age 8h, Secure in production.
  - Path-to-regexp matcher behavior — verified via `next/dist/compiled/path-to-regexp` that `/analytics/:path*` matches `/analytics` (root) AND `/analytics/foo`. The dual `/specials/saved` + `/specials/saved/:path*` listing is redundant, not a fix for a real gap. (Cleanup, not a finding.)
- Adjacent thing noticed but NOT this finding: the `/api/auth/pin` rate limiter (5 attempts / 60s / IP) resets on process restart. Acceptable for LAN-only deploy per the comment; documented.
