# Set LARIAT_PIN / LARIAT_PIN_SECRET in .env.local on the serving Mac

**Why this is yours:** Only the owner writes secrets. In production the PIN cookie signer throws without `LARIAT_PIN_SECRET` (`lib/pinCookie.ts:117-118`), so every manager login returns 500 (`app/api/auth/pin/route.ts:151-166`); without `LARIAT_PIN` every manager page redirects to the dead-end "Manager PIN needed" card (`middleware.js:94-107`, `app/login-pin/LoginPinForm.jsx:19-27`). A fresh install has always needed an operator to put `LARIAT_PIN` in `.env.local` and restart (`tests/js/test-unconfigured-install-bootstrap.mjs:11-16`). Measured 2026-09-01 on this laptop: `.env.local` holds only `LARIAT_DATA_ROOT`.
**Unblocks:** Manager PIN login on the production web build (Analytics, Costing, Order guide, Menu engineering, BEO and their `/api/*` — `docs/OPERATIONS.md:93`); `scripts/demo-smoke.sh`, which reads `LARIAT_PIN` from `.env.local` (`scripts/demo-smoke.sh:25-33`); `/api/health` `pin_gate` probe (`app/api/health/route.ts:174-183`, required at `:233`).
**Where:** venue Mac (the checkout that runs `npm run start`); browser check from a pilot iPad or the Mac itself.  **Time:** 5 min + one server restart (~10 min total; every open browser re-enters the PIN once).
**Status:** open — per `.env.example:11-14` and `lib/pinCookie.ts:23-25`

## Before you start
- [ ] You are on the venue Mac, in the checkout that serves production — check: `git rev-parse --show-toplevel && pgrep -fl "next start"` (expect a repo path and one `next start` pid; `package.json:51`, `ops/launchd/README.md:105-106`)
- [ ] `.env.local` exists and has no PIN keys yet — check: `test -f .env.local && grep -oE '^LARIAT_[A-Z_]+=' .env.local` (expect `LARIAT_DATA_ROOT=` and nothing named `LARIAT_PIN*`)
- [ ] `node` is on PATH — check: `node --version` (v24.20.0 on this laptop; the generator at `.env.example:13` needs any Node)
- [ ] You have chosen the manager PIN (4–6 digits so the same value also passes the desktop wrapper's rule, `desktop/settings.ts:33-35`) — no command; a product decision
- [ ] Not in a service window — the restart plus secret set invalidates every outstanding PIN cookie (`lib/pinCookie.ts:30`); cook pages (Today / Stations / Recipes / 86 / Inventory) are never gated and keep running (`docs/OPERATIONS.md:93`)

## Steps
1. **Generate the secret.** (venue Mac, repo root) `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` → expect one 64-character hex line (`.env.example:13`; `openssl rand -hex 32` is the equivalent named at `lib/pinCookie.ts:45,93`). If not: check `node --version`.
2. **Add both keys to `.env.local`.** `nano .env.local` and append exactly two lines, no quotes, no spaces around `=`:
   ```
   LARIAT_PIN=<your 4–6 digit PIN>
   LARIAT_PIN_SECRET=<the 64 hex chars from step 1>
   ```
   → expect the file saved (`.env.example:11-14` is the template). Never paste either value into chat, a commit, or a PR. If not: the file is gitignored (`.gitignore:25`) — it is safe to create it if missing.
3. **Verify the lines parse.** `grep -cE '^LARIAT_PIN=[^[:space:]]+$' .env.local; grep -cE '^LARIAT_PIN_SECRET=[0-9a-f]{64}$' .env.local; git status --short .env.local` → expect `1`, `1`, and empty git output. If not: fix whitespace/quotes; if git lists the file, stop — it must never be tracked.
4. **Restart the production server.** Stop the running `next start` (Ctrl-C in its terminal, or `kill $(pgrep -f "next start")`), then from the repo root `npm run start` → expect Next listening on port 3000 (`package.json:51`). No rebuild needed — both keys are read from `process.env` at request time (`middleware.js:94-95`, `app/api/auth/pin/route.ts:108,153`). If the venue instead runs the Electron wrapper, skip this file entirely: it ignores `.env.local` and injects `LARIAT_PIN` / `LARIAT_PIN_SECRET` from `~/Library/Application Support/Lariat/settings.json` (`desktop/settings.ts:8-9,76-77`, `desktop/paths.ts:50-54`) with `NODE_ENV=production` (`desktop/main.ts:25-30`).
5. **Confirm the server sees both keys.** `curl -s http://localhost:3000/api/auth/pin` → expect `"pin_enabled":true,"pin_override":true,...,"pin_signed":true` (`app/api/auth/pin/route.ts:94-105`; use `:3001` if the venue serves there — `.env.example:3`). If `pin_signed:false` or `pin_override:false`: the server was not restarted from the directory holding `.env.local` — re-do step 4.
6. **Confirm health is green on the PIN probe.** `curl -s http://localhost:3000/api/health | grep -o '"pin_gate":{[^}]*}'` → expect `"ok":true,"detail":"PIN gate active"` (`app/api/health/route.ts:174-183`; endpoint is deliberately not PIN-gated, `:9`). If `"PIN unset - manager pages stay closed until a PIN is set"`: `LARIAT_PIN` is not loaded (`lib/managerPins.ts:127-134`).
7. **Do a real manager login.** (pilot iPad or the Mac's browser) Open `http://<venue-mac>:3000/analytics` → expect a redirect to `/login-pin?next=/analytics` (`middleware.js:109-113`); enter the PIN → expect the Analytics page. `Wrong PIN` = 401 (`LoginPinForm.jsx:52`); `PIN sign-in is not working. Ask the owner to check setup.` = 500, secret still missing in production (`LoginPinForm.jsx:54`, `route.ts:151-166`); the "Manager PIN needed" card = `LARIAT_PIN` not loaded (`LoginPinForm.jsx:19-27`).
8. **Run the smoke script (no PIN in shell history — it reads `.env.local`).** `scripts/demo-smoke.sh` → expect no `PIN auth failed` line and a route table (`scripts/demo-smoke.sh:25-33,42-48`). A non-200 route in the table is a separate defect, not this runbook's failure; note it in the evidence. If `Dev server not reachable`: set `BASE=http://<host>:<port> scripts/demo-smoke.sh` (`:14,19`).

## Pass / fail
Pass = all three: (a) `GET /api/auth/pin` returns `pin_override:true` and `pin_signed:true`; (b) `/api/health` `pin_gate.ok` is `true`; (c) a real browser PIN entry on the production build lands on a gated page (evidence target: "a real manager PIN login succeeds on the production build"). Fail = any 500 on POST `/api/auth/pin` (`route.ts:151-166`), or `pin_signed:false` after restart. A 429 is not a fail — five misses per minute per IP, wait 60 s (`route.ts:36-38`).

## Record the result
- Evidence: no template exists for this item (`docs/superpowers/templates/` holds only `service-day-shutoff-log.md`). Paste the step-5 JSON (it carries no secret) and the step-8 summary line under a new `## Evidence YYYY-MM-DD` heading at the bottom of this runbook, plus the device used in step 7. Never paste `.env.local`.
- Then update: this runbook's **Status** line → `done YYYY-MM-DD`; `docs/PROJECT_STATUS.md` — no row tracks this today (grep 2026-09-01 found none), so add one under the "Where the project is" table (header at `docs/PROJECT_STATUS.md:29`): `| Manager PIN gate on production web (LARIAT_PIN + LARIAT_PIN_SECRET) | web | shipped | this runbook, evidence YYYY-MM-DD | HIGH |` and refresh the as-of line (`:10`); `docs/OPERATIONS_HANDOFF.md` §4 table (`:58-64`) has no PIN row — nothing to strike; add `| Manager PIN | ~~LARIAT_PIN / LARIAT_PIN_SECRET~~ — done YYYY-MM-DD |` so the handoff shows it closed (header rule at `:6-7`); `docs/runbooks/person-only/README.md` index row — directory and index do not exist yet (not on disk, not on `origin/main`), create both with this runbook.

## Close out
```bash
scripts/worktree.sh new sean chore/env-local-pin-secret
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main.

## If something goes wrong
- **Login shows "PIN sign-in is not working" after the restart:** secret not loaded. Confirm `.env.local` sits in the directory `npm run start` ran from (`tests/js/test-unconfigured-install-bootstrap.mjs:14-15`), re-check step 3, restart again.
- **Every manager page bounces to "Manager PIN needed":** `LARIAT_PIN` not loaded (`middleware.js:96-107`). Same fix.
- **Rollback:** delete the two lines from `.env.local` and restart — you are back to the prior state (manager pages closed, health `pin_gate` down at `app/api/health/route.ts:181`). Cook surfaces are unaffected either way (`docs/OPERATIONS.md:93`), so rollback is safe mid-service if needed.
- **Secret leaked or lost:** generate a new one (step 1), replace the line, restart; every browser re-enters the PIN once (`lib/pinCookie.ts:30`, `docs/superpowers/specs/2026-07-11-lariat-pin-identity-v2.md:39-42`).
- **`git status` ever lists `.env.local`:** stop and do not commit — it is gitignored (`.gitignore:22-25`); something is wrong with the checkout.
- Who to tell: nobody — owner-only. Record the outcome in this runbook's Status line.
