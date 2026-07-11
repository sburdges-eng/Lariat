# PIN cookie identity v2 (audit P0-1 / P0-2)

**Date:** 2026-07-11 · **Status:** implemented with this PR · **Owner ratification:** requested in PR

## Problem (audit P0-1, verified severity P2)

The `lariat_pin_ok` cookie signs the fixed payload `"1"` — no per-user identity.
Consequences:

1. A **disabled manager keeps an 8-hour stateless session** — disabling the row
   in `manager_pin_users` does not invalidate the cookie already in their browser.
2. `audit_events.actor` stays null for PIN-gated writes — login knows *which*
   manager (`findActiveManagerByPin`, P0-3 wave) but the identity is dropped
   the moment the cookie is minted.
3. (P0-2) `RoleProvider` is rendering-only by its own contract; the real gap
   was always server-side identity, which this closes.

## Design

Exactly the pattern `lib/tempPinCookie.ts` already proves (its spec invariant:
"the cookie alone NEVER bypasses the DB check"):

- **Format:** `v2.<sub>.<b64url(hmac-sha256(secret, "v2."+sub))>` where `sub`
  is the `manager_pin_users.id` that logged in, or `0` for the env `LARIAT_PIN`
  override login. The version prefix is inside the signed payload (downgrade
  block). `signPinCookieValue(secret, sub = 0)` — same export, new param.
- **Stateless layer** (`lib/pinCookie.ts`, Edge-safe): `verifyPinCookieValue`
  accepts v2 only; `pinCookieSubject`/`pinCookieSubjectFromRequest` extract
  `sub`. middleware.js keeps its stateless HMAC page check unchanged.
- **Stateful layer** (`lib/pin.ts`, Node): `hasPinCookie` — `sub > 0` requires
  the manager row to still be `is_active = 1` at the deployment location on
  EVERY gated request (revocation is immediate at API level); `sub = 0` keeps
  status-quo authority (only mintable by knowing the env override PIN, which
  was never revocable — not the audit finding). New `pinActor(req)` returns
  `{source:'override'}` or `{source:'manager', id, name, role}` for
  incremental `audit_events.actor` adoption by routes.
- **v1 hard cut:** previously-issued `v1.<mac>` cookies stop verifying. Cost:
  every logged-in browser re-enters the PIN once (8h ceiling anyway). This is
  the existing secret-rotation runbook and avoids carrying an
  unrevocable-format acceptance window.
- **Dev/legacy posture unchanged:** with no `LARIAT_PIN_SECRET` outside
  production, the unsigned `"1"` degrade (maps to `sub = 0`) still works;
  in production it fails closed (P0-4, PR #462).

## Out of scope

- Wiring `pinActor` into every PIN-gated route's audit call (incremental
  follow-up; the helper ships now).
- Per-manager *pages* revocation in middleware (Edge has no DB; the next API
  call enforces it).
- RoleProvider changes (rendering-only contract stands).

## Files

`lib/pinCookie.ts`, `lib/pin.ts` (+`pinActor`, `pinCookieValueAuthorized`),
`lib/managerPins.ts` (+`findManagerPinUserById`), `app/api/auth/pin/route.ts`,
`app/food-safety/sick-worker/page.jsx` + `app/labor/certs/page.jsx` (server
pages rendering regulated data now use the DB-checked gate), tests
(`test-pin-cookie-hmac.mjs`, `test-pin-helper-shared.mjs`).
