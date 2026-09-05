# Lift (or keep) the HACCP `sync_feed` C5-DELETE-BLOCK

**Why this is yours:** The block is your own 2026-07-07 decision, and the ledger says it clears only when *you* either confirm the venue is single-device-system-of-record and explicitly lift it, or require a native `sync_feed` producer first. An agent cannot ratify the deployment shape.
**Unblocks:** C5 task 1 (list the blocked rows) and the wave-2 "operational logs" cutover for `checks` / `cooling` / `sanitizer` / `temp-log`. Nothing gets deleted by this step — C5 stays gated on C4.
**Where:** chat + this laptop (one read-only SQL check against the venue DB)  **Time:** 15m
**Status:** open — per `docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md:90-96` (owner decision 2026-07-07) and `:301`

## Before you start
- [ ] The block is still real: all 4 web routes still call `appendOp` — check: `grep -l "appendOp" app/api/checks/route.ts app/api/cooling/route.js app/api/sanitizer/route.ts app/api/temp-log/route.js` → 4 paths print.
- [ ] No native producer has landed since — check: `grep -rl "sync_feed" LariatNative/Sources/LariatDB/*.swift` → only `ReceivingRepository.swift` (a comment saying it deliberately omits it).
- [ ] You know which DB is the venue's — check: `ls -la "$HOME/Library/Application Support/Lariat/data/lariat.db"` → the ~7.9 MB file (repo `data/` holds no `lariat.db`; do not let a script create one there).
- [ ] `sqlite3` CLI present — check: `which sqlite3` → `/usr/bin/sqlite3`.

## Steps
1. **Confirm no peer or cloud-bridge host is configured on this Mac.** `grep -n "^LARIAT_SYNC_PEERS\|^LARIAT_SYNC_PEER_KEY\|^LARIAT_CLOUD_BRIDGE_URL" .env.local; echo "exit=$?"` → expect: no lines, `exit=1` (as of 2026-09-01 that is what it prints). If a line prints: a second host is or was wired in → default to **KEEP**, skip to step 5.
2. **Confirm the venue DB has never trusted a peer or been replayed.** Read-only, safe while the app is open:
   `sqlite3 -readonly "$HOME/Library/Application Support/Lariat/data/lariat.db" "SELECT 'peer_trust',COUNT(*) FROM peer_trust UNION ALL SELECT 'replay_checkpoints',COUNT(*) FROM replay_checkpoints UNION ALL SELECT 'sync_feed_hosts',COUNT(DISTINCT source_host) FROM sync_feed;"`
   → expect: `peer_trust|0`, `replay_checkpoints|0`, `sync_feed_hosts|0` or `|1`. Human-readable equivalent: `LARIAT_DATA_DIR="$HOME/Library/Application Support/Lariat/data" npm run sync:status`. If peer_trust > 0, replay_checkpoints > 0, or hosts > 1: another host has consumed this feed → **KEEP**, skip to step 5.
3. **Decide (chat, your call — not derivable from code).** Question: *Is this Mac the only host that will ever hold the HACCP tables of record — iPads go through this one host (web hub or native), and no second Mac/laptop replays the feed?* Inputs: `salvage.md:63-64` says no separate venue Mac exists; `salvage.md:59` leaves the LAN-hub / iPad architecture as your open call. **YES → LIFT (step 4). NO or undecided → KEEP (step 5).**
4. **(LIFT) Write the lift into the ledger.** Edit `docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md`: after the `OWNER DECISION 2026-07-07` sentence (`:90-96`) add `**OWNER DECISION <YYYY-MM-DD>: block LIFTED — single-device system-of-record confirmed (LARIAT_SYNC_PEERS unset; peer_trust=0; replay_checkpoints=0; salvage.md:63-64). sync_feed stays web-edge-only per lariat-native-edge-blockers.md:41-50. C5 wave 2 may delete the four routes.**`; at `:301` strike the item and append `LIFTED <YYYY-MM-DD>`. → expect: `grep -n "LIFTED" docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md` prints 2 lines. Then go to step 6.
5. **(KEEP) Write the keep + the requirement into the ledger.** Same two spots: `**OWNER DECISION <YYYY-MM-DD>: block KEPT — a native sync_feed producer is required before C5 wave 2.** Port `appendOp` (lib/syncFeed.ts:92, in-tx guard :94-99, INSERT :107-122) into the `AuditedWriteRunner.perform` blocks at LineCheckRepository.swift:100/147, CoolingRepository.swift:84/133, SanitizerRepository.swift:124, TempLogRepository.swift:103; op_id UUIDv7 per lib/localIdentity.ts:54; rowJson excludes `id` (app/api/checks/route.ts:110-116).` → expect: `grep -n "KEPT" …ledger.md` prints 2 lines. The port itself is an ordinary agent task — hand it off in chat; it is not person-only.
6. **Update the C5 plan task line.** `docs/superpowers/plans/2026-08-05-c5-write-cutover.md:18` — append `(HACCP block LIFTED|KEPT <YYYY-MM-DD>, ledger :90)`. → expect: `sed -n 18p docs/superpowers/plans/2026-08-05-c5-write-cutover.md` shows the note.
7. **Update project status.** `docs/PROJECT_STATUS.md:62` — replace the "Carried from memory, not re-verified" bullet with the decision + ledger cite. LIFT: remove it from "Blocked on an owner decision" (`:56`). KEEP: reword to "blocked-code — native producer port pending".

## Pass / fail
The ledger's own gate (`:90-96`): the block clears when **either** (a) a native `sync_feed` producer exists in the four HACCP repositories, **or** (b) single-device-system-of-record is confirmed **and** the block is explicitly lifted in the ledger. **Pass** = one of those is written, dated, at `:90-96` and `:301`. **Fail** = neither written; the block stands and no C5 wave may delete `checks` / `cooling` / `sanitizer` / `temp-log` (`:94-95`, `:301`).

## Record the result
- Evidence: no template exists — the ledger note *is* the evidence. Paste the step 1 and step 2 outputs verbatim into the decision sentence (the three counts + "LARIAT_SYNC_PEERS unset").
- Then update: ledger `:90-96` + `:301` (steps 4/5); `docs/superpowers/plans/2026-08-05-c5-write-cutover.md:18` (step 6); `docs/PROJECT_STATUS.md:62` (step 7); `docs/runbooks/person-only/README.md` index row — the directory does not exist yet, so create it with this runbook as its first file and set this file's Status line to `done <YYYY-MM-DD>`. `docs/OPERATIONS_HANDOFF.md` has no row for this item (§1–§6 checked) — nothing to strike.

## Close out
```bash
scripts/worktree.sh new sean chore/haccp-sync-feed-block-lift
```
Commit the evidence and doc updates on that branch and open a PR (the repo's /ship skill runs the verify gate). Never push to main. Note: as of 2026-09-01 `scripts/verify.sh` is untracked in the main checkout (`git status` shows `??`); if `/ship` cannot find it on your branch, `npm run verify:gate` is the documented equivalent (`CLAUDE.md:206`).

## If something goes wrong
- Doc-only decision; no service-day rollback. Undo = revert the ledger commit.
- Step 1 or 2 shows a peer, checkpoint, or second `source_host` → do **not** lift. KEEP is the safe default; the ledger's reason stands (`:87-89`: native writes would feed no `sync_feed`, replication of food-safety data silently stops).
- Lifted, then a second host appears later (a `peer_trust` row, `LARIAT_SYNC_PEERS` set, or cloud-bridge enabled) → the lift is void. Re-block in the ledger before any C5 wave touches HACCP.
- KEEP path: the port touches `PROTECTED_CONTRACTS.md` §7 (`:202-220`, replay must tolerate `sync_feed` rowid gaps `:216`); the agent must run the targeted sync suites (`test:regression-core` includes `tests/js/test-sync-feed.mjs`, `package.json:30`). Do not improvise around HACCP.
- Nothing here starts a deletion: C5 is still `planned — gated on C4` (`c5-write-cutover.md:4`, `:14`; `tasks.yaml:18`), and C4 is gated on G0 (`c4-reconcile.md:4`). Tell the C5 lead in chat which way you decided.
