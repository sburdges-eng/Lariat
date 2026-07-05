# LariatNative H6/H7 holistic-bar — session handoff

> **Purpose.** Phase A, B, and Phase C's build-phase of the LariatNative Swift port are
> done (see `docs/superpowers/plans/2026-07-02-lariat-native-a4-a6-roadmap-and-handoff.md`
> and `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`). What's left is the
> "holistic bar" (endgame spec §4, H1-H9) plus operator-gated items (shut-off test, 7-day
> reconcile window). This is the pick-up doc for the **H6/H7 sub-project thread**
> specifically — read this before touching H6 or H7 work.

## 0. At a glance

- **H1-H5**: done. **H8**: packaging done (#416); signing/notarization gated on an owner
  identity decision. **H9**: continuous.
- **H6 (platform integration) + H7 (accessibility + iPad)**: decomposed into 4 independent
  sub-projects, worked one at a time, each through its own spec → plan → TDD cycle
  (`spec-plan-tdd` skill). iPad (part of H7) is its own separate future wave — not one of
  the 4.
- **Order chosen so far:** H6a (done) → H7a Phase 1 (plan approved, awaiting "go") → next
  pick from {H7a Phase 2+, H6b, H6c} is an open decision, ask the user.

## 1. Sub-project status

| Sub-project | Status | Branch / worktree | Docs |
|---|---|---|---|
| **H6a** — local notifications for red signals | **PR #428 open, CI-green, unmerged** | `feat/lariat-native-h6a-notifications` / `worktrees/native-h6a-notifications` | spec: `docs/superpowers/specs/2026-07-04-lariat-native-h6a-alert-notifications-design.md`; plan: `docs/superpowers/plans/2026-07-04-lariat-native-h6a-alert-notifications.md` |
| **H7a Phase 1** — VoiceOver labels, `.safety` tier (13 files) | **Plan approved & committed, awaiting explicit "go" to start T1** | `feat/lariat-native-h7a-accessibility` / `worktrees/native-h7a-accessibility` | spec: `docs/superpowers/specs/2026-07-05-lariat-native-h7a-accessibility-safety-tier-design.md`; plan: `docs/superpowers/plans/2026-07-05-lariat-native-h7a-accessibility-safety-tier.md` |
| **H7a Phase 2+** — remaining 13 tiers (~61 more zero-coverage view files) | Not started | — | Follows H7a Phase 1's exact same pattern once that lands |
| **H6b** — native printing (settlement/BEO/line sheets via `NSPrintOperation`) | Not started | — | — |
| **H6c** — menu-bar extra + multi-window (KDS on 2nd display) | Not started | — | — |
| **H7b** — iPad cook tier | Explicitly deferred, separate future wave (own spec/plan when picked up) | — | — |

**If you're picking this up fresh:** check PR #428's state first
(`gh pr view 428 --json state,mergeable,statusCheckRollup`) — it may have been merged or
reviewed since this was written. Same for H7a's branch — check
`git log --oneline feat/lariat-native-h7a-accessibility -3` to confirm no one has already
started T1.

## 2. H6a detail (for context on what already landed)

Local `AlertMonitor` singleton (bespoke 45s loop, independent of which board is on
screen — `BoardPoller` instances stop when their view disappears, so this couldn't reuse
that). Fires a system notification the moment any `.red` `CommandAlert` first appears or
worsens. Added `cooling-overdue` as a new red source (previously untracked).

Two real bugs found and fixed during review/testing, not just theoretical:
1. **Adversarial plan review** caught that the original delegate design only handled the
   notification tap, which would have silently suppressed the banner while the app is
   foreground on a different board (exactly the feature's primary use case) — fixed by
   also implementing `willPresent`.
2. **Manual launch smoke test** (`swift run LariatApp`, this project's standard dev
   command) crashed immediately: `UNUserNotificationCenter.current()` requires real
   bundle identity, which an unbundled `swift run` executable doesn't have. Fixed with
   `NotificationEnvironment.canUseNotifications(bundleIdentifier:)` guarding all three
   touch points (`ensureAuthorized`, `post`, delegate registration) — see
   `LariatNative/Sources/LariatModel/NotificationPoster.swift`. **If any future H6/H7
   work touches `UNUserNotificationCenter` anywhere else, apply this same guard** — the
   crash is not H6a-specific, it's inherent to running unbundled.

## 3. Operational gotchas found this session

1. **All git worktrees were externally wiped once mid-session** — the entire
   `worktrees/` directory (not just one) went empty, `git worktree list` showed nothing
   but `main`. This was NOT caused by any command run in this thread. **Recovery is
   simple and lossless:** the branches' commits live in `.git` regardless of the working
   directory being gone — `git worktree add worktrees/<name> <branch>` recreates it
   instantly. If you find `worktrees/` empty, check `git branch -a` first (the work is
   almost certainly still there) before assuming anything was lost.
2. **GitNexus `detect_changes({scope: "compare", base_ref: "main"})` can false-positive
   as CRITICAL risk** when a branch's fork point has drifted behind a fast-moving `main`
   — it diffs against literal tip-of-main, so unrelated commits that landed on `main`
   after your branch forked show up mixed in with your own changes. Always cross-check
   with a merge-base-scoped diff before trusting the raw risk level:
   `git diff --name-status $(git merge-base origin/main HEAD) -- <path>`.
3. **A spec claim was wrong because it was grep-derived, not read-derived.** H7a's spec
   claimed "1 hostile Dynamic-Type pattern in `HaccpPlanView`" based on a
   `\.frame(height: [0-9]+)` grep hit — which turned out to be a harmless 1pt decorative
   divider, not a text-clipping risk. The real risk (fixed-`width` `Text` columns) was
   only found by actually reading the file during plan-writing. **Lesson for any future
   phase of this sweep: grep is fine for a first-pass inventory, but verify specific
   claims by reading the file before writing them into a plan a subagent might implement
   verbatim.**

## 4. Conventions to keep following

- One sub-project = one spec (`docs/superpowers/specs/`) → one plan
  (`docs/superpowers/plans/`) → HALT for explicit user approval → TDD execution → PR.
  Never skip the halt. Never merge to `main` without being asked.
- Each sub-project gets its own worktree + branch, named `feat/lariat-native-<slug>`,
  cut from `origin/main` (not from another in-flight feature branch).
- Accessibility work follows `SanitizerView.swift`'s inline `.accessibilityLabel(...)`
  house style — no extraction to `LariatModel`, no new test dependency (this codebase
  has exactly one, GRDB). Acceptance for that kind of work is `swift build` clean + a
  scripted grep-based coverage audit, not XCTest — there is no `LariatAppTests` target.
- Where a task's acceptance can't be a real automated test (most `LariatApp`-layer view
  code), say so explicitly in the plan rather than silently claiming "TDD throughout."

## 5. Immediate next action

If nothing has changed since this was written: say "go" to start H7a Phase 1's T1, or
pick a different queued item from §1's table (ask the user which, if not already told).
