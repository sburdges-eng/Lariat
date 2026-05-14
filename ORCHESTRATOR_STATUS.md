# Orchestrator status — 2026-05-14 (Phase 3.5 wave: COMPLETE)

## Recipe-photo wave (closed 2026-05-13)

Manifest: prior `tasks.yaml` (5 tasks)
Outcome: all 5 merged between `c9b9a69` and `42deab5`.

| Task | Branch | Merge commit | Tests |
|------|--------|--------------|-------|
| T1 | orch/T1 @ 31304de | c9b9a69 | 13/13 |
| T2 | orch/T2 @ a9099fd | a852fc8 (via T3) | 8/8 |
| T3 | orch/T3 @ 547330d | a852fc8 | 8 API + 4 UI |
| T4 | orch/T4 @ afb19c5 | 319aa53 | 11/11 |
| T5 | orch/T5 @ b8ecff6 | 42deab5 | 6/6 |

## Phase 3.5 wave (2026-05-14) — COMPLETE

All 8 tasks (+ audit + Phase 2B B3) shipped this session.

| Task | Status | Commit | Tests |
|------|--------|--------|-------|
| Phase 2B B3 — Settlement PDF | shipped | b1a39ec | 17/17 |
| T1 — line_check audit-row | shipped | 3f22201 | 19/19 (+3 new) |
| T2 — LARIAT_DATA_DIR JSON cache | shipped | c0df793 | 2/2 |
| T3 — .env hygiene | shipped | fbbeddb | (gitignore) |
| T4 — Ingredient-masters operator review UI | shipped | 45e4684 | 34/34 |
| T5 — Weekly settlement digest | shipped | 4758e27 | 10/10 |
| Audit §4 access-matrix refresh | shipped | 36c7246 | (docs) |
| T6 — Desktop first-run wizard | shipped (pre-existing) | — | (existing) |
| T7a — sync_feed schema + appendOp + replaySince | shipped | aedd10e | 22/22 |
| T7b — /api/peers/sync-since + Ed25519 auth | shipped | 6143758 | 24/24 |
| T7c — Receiving-side appliers + sync client | shipped | 82989af | 27/27 (20 apply + 7 client) |
| T8 — Graceful drainer stop + launchd template | shipped | a09804f | 9/9 |
| T8b — cloud-bridge secret in settings | shipped | 8104a2b | 15/15 (6 new) |

## Session commits — 2026-05-14

```
82989af feat(sync): receiving-side appliers + signed sync-since client (T7c)
8104a2b feat(desktop): cloudBridgeUrl + cloudBridgeSecret in settings (T8b)
92310f4 chore(orch): close T6/T7a/T7b/T8 partial; T7c + T8b queued
a09804f feat(cloud-bridge): graceful drainer stop + launchd template (T8)
6143758 feat(peers): /api/peers/sync-since + Ed25519 signed-request auth (T7b)
aedd10e feat(sync): sync_feed + replay_checkpoints schema + appendOp/replaySince (T7a)
e264ea0 chore(orch): close out T1-T5 + audit branch, refresh remaining manifest
36c7246 docs(architecture): refresh §4 access-control matrix to match middleware
45e4684 feat(costing): /costing/ingredient-masters operator review surface (T4)
6d8a08a chore(orch): roll up Phase 3.5 progress in ORCHESTRATOR_STATUS
4758e27 feat(shows): weekly settlement digest cron + renderDigestHtml (T5)
c0df793 fix(data): honor LARIAT_DATA_DIR for JSON cache root (T2)
3f22201 fix(checks): wrap line_check_entries INSERT in audit-event tx (T1)
fbbeddb chore(orch): Phase 3.5 task manifest + .env hygiene (T3)
b1a39ec feat(shows): printable settlement view + Download PDF button (Phase 2B B3)
fdfaf54 chore(docs): trio orchestration handoff protocol + recipe-photo wave closeout
```

16 commits. All commits green:
- typecheck clean on every commit
- 390/390 HACCP rules tests pass
- 179 new/regressed tests pass:
  - 17 settlement-pdf, 10 weekly-digest, 19 checks-api,
    2 data-cache-data-dir, 34 ingredient-masters,
    22 sync-feed, 24 peer-auth, 9 cloud-bridge-graceful-stop,
    6 settings (new), 27 sync-apply+sync-client, 9 sync-feed-types
- 0 regressions on existing suites (settlement-route, datapack
  semantic/prewarm/search, data-cache-last-known-good, cloud-bridge-
  push/drainer, recipe-photos)

## Cross-host sync stack — end-to-end shape

After this wave the multi-instance-sync layer is composable end-to-end:

```
producer (T7a)                              receiver (T7c)
   appendOp(op)   →    sync_feed table          ↑   applyWindow(ops)
                            │                   │       ├─ family1: INSERT OR IGNORE
                            │                   │       ├─ family2: tx DELETE+INSERT
                            │                   │       └─ family3: skip+audit (v1)
                            ↓                   │
                       replaySince(...)         │
                            │                   │
                            ↓                   │   fetchSyncSince(...)
              /api/peers/sync-since (T7b)  →    │
              ├─ X-Lariat-Peer-Pubkey           │   signProof + canonical payload
              ├─ X-Lariat-Timestamp             │   (T7c client mirrors T7b auth)
              └─ X-Lariat-Signature
              authenticateSyncRequest:
              ├─ peer_trust allowlist
              ├─ ±60s clock-skew window
              └─ verifyProof (Ed25519)
```

Still pending (captured in `tasks.yaml`):
1. Periodic apply scheduler (poll loop calling fetchSyncSince + applyWindow)
2. Family-3 LWW applier (v2 — not needed for single-KM v1 workflow)
3. /management/cloud-bridge UI form for T8b's settings round-trip
4. Ed25519 migration for cloud-bridge auth (cloud-side verifier required first)

## Followups outstanding

- **Unpushed main** — now 28 commits ahead of `origin/main`. Push when ready.
- **Stale GitNexus index** — `af98d62` sentinel warned across session.
  Run `npx gitnexus analyze` to refresh.
- **Audit worktree fully drained** — branch
  `audit/codebase-fixes-2026-05-13` in `Lariat-worktrees/` is obsolete;
  remove when convenient.
- **Uncommitted on main** — `data/normalized/compliance_rules.jsonl`
  (regenerated; project says do not hand-edit), `.vscode/tasks.json`
  (untracked IDE config), `design/` (zips + dirs from the
  LaRi Whole-Design Remix; `ed05b13` already synced the canonical
  output into `public/`).
