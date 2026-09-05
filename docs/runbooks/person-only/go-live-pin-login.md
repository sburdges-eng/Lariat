# Go-live: one real manager PIN login

> **DONE — verified 2026-09-02.** Root cause found and fixed along the way:
> `middleware.js` requires `LARIAT_PIN` (master override PIN) to be set before
> it honors any session; it was missing, so every gated page redirected to
> setup. A random break-glass `LARIAT_PIN` now lives in `.env.local` (distinct
> from Sean's own PIN so logins keep per-user attribution). Verified end to
> end: login → `source: manager_user, Sean (owner)`; `/beo`, `/host`,
> `/morning`, `/shows/tonight` render 200 with the session; anonymous requests
> still redirect to `/login-pin`. Note: bare `/shows` is a 404 by design — the
> pages are `/shows/tonight` and `/shows/archive`.

**Why only you:** only you know the PIN; a green `/api/health` does not prove
login works (its probe checks the DB row, never cookie signing).
**When:** before service starts 2026-09-02.
**Takes:** 2 minutes.

## Where things stand

- `LARIAT_PIN_SECRET` is now set in `.env.local` (2026-09-02) — the missing
  secret that would have turned every login into a 500 is fixed.
- A wrong-PIN request already returns a clean 401, so the route is healthy.
- Your PIN user ("Sean") is active in the running DB.

## Steps

1. On the serving Mac, open `http://localhost:3000/beo` (it will redirect to
   the PIN gate).
2. Sign in with your manager PIN.
3. Confirm the BEO board and one more manager surface (e.g. `/shows`) load.

## Done when

You're signed in and manager boards render. If sign-in errors instead of
rejecting, stop and report the exact message — do not work around it.
