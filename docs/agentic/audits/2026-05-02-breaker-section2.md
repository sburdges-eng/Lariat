# Breaker Audit — 2026-05-02 — Section 2

**Section covered:** 2 — PIN gate / manager routes / replay-curl protection.

**Auditor:** claude

**Read-only:** YES.

**GitNexus:** reindexed at the start of this pass (16,026 nodes, 24,519 edges).

---

## Method

Six-prong checklist applied to:
- `middleware.js` — the entry-point gate
- `lib/pin.ts` — the in-route helper
- `lib/pinCookie.ts` — the HMAC cookie helper
- `app/api/auth/pin/route.js` — the cookie issuer
- Every API route directory mentioned in `SENSITIVE_PREFIXES` — costing, analytics, menu-engineering, beo, audit, compute, shows, specials/saved

Verified the path-to-regexp matcher behavior empirically (the bundled `next/dist/compiled/path-to-regexp`) to confirm `/analytics/:path*` matches `/analytics` root.

---

## Findings

| # | Priority | Title |
|---|---|---|
| 1 | **P1** | 10 routes under `SENSITIVE_PREFIXES` lack the in-route `hasPinCookie()` re-check, breaking the doctrine of "curl/replay can't bypass the middleware". [Full record](findings/2026-05-02-pin-gate-defense-in-depth-missing.md). |

No P0, P2, or P3 findings this pass.

---

## Verified-correct surfaces

- **HMAC cookie shape** (`lib/pinCookie.ts`) — constant-time compare, length pre-check, `v1.` prefix, legacy fallback gated on `LARIAT_PIN_SECRET` unset.
- **Cookie attributes** (`app/api/auth/pin/route.js::cookieHeader`) — HttpOnly, SameSite=Strict, Max-Age 8h, Secure in production.
- **Path-to-regexp matcher** — `/analytics/:path*` matches `/analytics` (root) AND `/analytics/foo`; same for every `/api/<prefix>/:path*` entry. The dual `/specials/saved` + `/specials/saved/:path*` listing is redundant, not load-bearing.
- **Rate limiter on `/api/auth/pin`** — 5 failed attempts / IP / 60 s; in-memory; resets on process restart. Acceptable for LAN-only deploy per the `app/api/auth/pin/route.js` comment block.
- **Phase 2 routes** (`/api/shows/[id]/*`, `/api/specials/saved/*`) — uniformly call `hasPinCookie()` in the route. The newer convention is correct; the gap is the older routes haven't been retrofitted.

---

## Test gaps surfaced

- **No `tests/js/test-pin-defense-in-depth.mjs`.** A test that asserts every `SENSITIVE_PREFIXES` route returns 401 without the cookie would catch finding #1 today and prevent regression as new sensitive routes are added.
- `tests/js/test-pin-cookie-hmac.mjs` covers the cookie crypto but not the route-level re-check coverage matrix.

---

## Recommended next moves

1. **Fix finding #1** — single PR adds `requirePin()` to the 10 routes. Pair with the new defense-in-depth test that walks the SENSITIVE_PREFIXES list. ~30 minutes including tests.
2. **Refactor follow-up** — consider a `withPin(handler)` wrapper so future routes can't forget. That's `REFACTOR_GOVERNANCE.md` territory, not this audit. The wrapper would also give us one place to add per-PIC role granularity later (per Phase 2 risk register: "Manager-only PIN gate too coarse… per-route role check deferred to Phase 3 labor").
3. **Schedule next breaker pass for Section 3 — Location scoping** in the next session. That section is high-risk because it has the most failure modes (cookie/header/session derivations vs body/query) and was hit twice in this session's PR review (PR #96 had a critical "loc hardcoded to DEFAULT_LOCATION_ID").

---

## Stop conditions hit

None. Section 2 sweep completed. P1 found but read-only mode held — fix follows on a separate branch / PR.

---

## Workflow notes

- The "call-graph reach" prong I suggested at the end of Section 1 paid off here. After GitNexus reindexed, comparing the matcher list to the route inventory was a single bash loop (~8 lines), not a brute-force grep. Same pattern transfers to the location-scoping audit in Section 3.
- One workflow tweak suggested: when a finding spans many files (this one touches 10 routes), the finding template's "Likely files" field should be allowed to span a sub-bullet list rather than just a flat list — current template handled it but the rendering is awkward.
