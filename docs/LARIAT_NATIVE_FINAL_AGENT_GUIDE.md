# Lariat Native Final Agent Guide

Purpose: give Claude, Cursor, Antigravity, and Xcode sessions one current map for finishing the macOS-native Lariat app without re-porting completed work or destabilizing the live restaurant database.

This document is project-local to `~/Dev/hospitality/Lariat`. Do not apply it from bare `~/Dev` except as routing metadata.

## Container Inventory

Use these paths as the current Lariat surfaces inside `~/Dev`:

| Path | Status | Use |
| --- | --- | --- |
| `hospitality/Lariat/` | Canonical Lariat repo on `main` | Source of truth for web edge, native package, docs, migrations, data contract, and app workflows. |
| `hospitality/Lariat/LariatNative/` | Canonical macOS/iPad SwiftPM package | Final native app: `LariatModel`, `LariatDB`, `LariatApp`. |
| `Lariat-KDS/` | Separate clean Swift repo | Companion KDS client. Touch only when ticket protocol, KDS UI, or app-store KDS work is named. |
| `lariat-data-sources/` | Real Lariat workbooks, PDFs, HR/BEO/menu data, PII | Read/ingest/reference only. Never delete or bulk rewrite. |
| `lariat-data-sources/LariatHR/` | Legacy/reference Xcode project | Historical HR/native reference. Not the final native app. |
| `Lariat/` | Dev-container artifact folder | Data artifacts/logs only, not the app repo. |
| `hospitality/Lariat-worktrees/` | Empty right now | Reserved for isolated Lariat worktrees. |
| `EXPERIMENTS/LariatHR-dist/` | Only `.DS_Store` observed | Not a source surface for final native work. |
| `.claude/worktrees/cadi-cxx-toolchain/**/Lariat*` | Stale cross-scope worktree snapshot | Do not use as source of truth for final native app work. |

## Current Native State

Treat the newest native endgame doc as authoritative over older handoff docs:

- `docs/superpowers/specs/2026-07-02-lariat-native-endgame.md`
- `docs/superpowers/specs/2026-07-02-lariat-native-phase-c-schema-inversion.md`
- `docs/superpowers/specs/2026-07-03-lariat-native-phase-c1-rule-ledger.md`
- `docs/superpowers/specs/2026-07-03-lariat-native-phase-c2-c3-activation.md`
- `docs/superpowers/specs/lariat-native-edge-blockers.md`
- `LariatNative/Scripts/PACKAGING.md`

What is already strong:

- Phase A and Phase B are recorded complete in the endgame doc.
- Native app has broad operator coverage across cook, safety, labor, inventory, manager, costing, purchasing, FOH, shows, house, BEO, and assistant tiers.
- `swift test` from `LariatNative/` is currently green in this checkout.
- H1-H5 are recorded complete.
- H6a local notifications are already implemented in `LariatNative`.
- C2 `SchemaMigrator` and C3 `ActorSource` taxonomy exist as pre-flip build artifacts.
- Packaging groundwork exists: `LariatNative/Scripts/package-app.sh` can assemble ad-hoc signed `.app` / `.pkg`.
- `Lariat-KDS` is green with `swift test`.

What still blocks the final native version:

- A full service-day shutoff test with the Next.js server disabled.
- Phase C1 completion: finish adversarial verification on unverified ported-write rows, fix or reclassify refuted rows, and triage low-confidence rows before deleting any web write route.
- Phase C4 reconciliation: at least 7 consecutive green service days, backup and restore drill, audit/event integrity checks, and money/checksum checks.
- Phase C5 write-route cutover, wave by wave, only after C1-C4 gates.
- Phase D edge reduction: retain only `lariat-native-edge-blockers.md` surfaces.
- Phase E consolidation: relocate/absorb load-bearing paths first; delete only confirmed duplicates with explicit user approval.
- H7 accessibility/iPad work. H7a Phase 1 (13 `.safety`-tier board views + VoiceOver/Dynamic-Type fixes) is merged to `main`. H7a Phase 2 (~61 remaining files across other tiers) has not started; no active H7 worktree currently exists.
- H8 distribution completion: Developer ID identity, notarization profile, final `.app`/`.pkg` or `.dmg` decision, double-click data-dir behavior, and launch smoke in a real GUI session.
- H6 remaining slices: native printing (H6b, shipped to `main`) and menu-bar extra (H6c, done on
  branch `feat/lariat-native-h6c-menu-bar-extra` — `.window`-style live red/amber signal panel over
  H6a's AlertMonitor poll; awaiting GUI smoke + merge) are complete. **Multi-window (H6d) is the
  last H6 slice and has not started** — it needs a deliberate rework of `BoardPollerHub.shared.active`
  from a global "most-recently-started poller" singleton to per-window/scene-scoped active tracking,
  so ⌘R and `PollFreshnessIndicator` target the right window. Follow-up notification preferences only
  if explicitly requested.

## Model Tier Routing for Claude

Use model tiers as risk controls, not status symbols. If a named tier is unavailable in the active Claude install, fall back one level down and record that fallback in the handoff.

| Tier | Use as main agent | Use as subagent | Do not use for |
| --- | --- | --- | --- |
| Max/Fable | Final-native governance, irreversible Phase C/D/E decisions, release/freezing calls, service-day cutover plan, destructive consolidation review | Red-team reviewer for schema inversion, edge deletion, audit ledger contradictions, notarization/release risk | Routine implementation, broad file search, test-log summarization |
| Opus | Architecture, high-risk planning, money/HACCP/PIN/audit review, Phase C ledger verification, multi-agent coordination | Reviewer, adversarial verifier, root-cause analyst, model-tier arbiter | Large mechanical edits that Sonnet can do safely |
| Sonnet | Default implementation tier, TDD, SwiftUI/GRDB work, docs updates, workspace/rule edits, focused fixes | Implementer, scoped reviewer for narrow non-regulated diffs | Irreversible deletion or schema-ownership flip without Opus/Max review |
| Haiku | Fast read-only inventory, file lists, line references, status summarization, test-output triage, typo-level checks | Scout subagent, checklist auditor, command-output condenser | Editing regulated code, deciding architecture, interpreting ambiguous parity or audit contracts |

Mandatory escalation:

- Use Opus or Max/Fable before changing schema ownership, `audit_events`, PIN/temp-PIN logic, HACCP write rules, settlement/costing money math, `ActorSource`, `SchemaMigrator`, or Phase D route deletion.
- Use Max/Fable or Opus for any destructive consolidation plan. No agent deletes Lariat duplicates without explicit user approval.
- Use Sonnet for normal Swift implementation after an Opus/Max plan is accepted.
- Use Haiku only read-only unless the user explicitly asks for a trivial text edit.

## Native Workflows

### 1. Intake and Routing

1. Confirm the workspace root is `hospitality/Lariat` or the named Lariat worktree, not bare `~/Dev`.
2. Read `AGENTS.md`, `CLAUDE.md`, this guide, and the most relevant endgame/spec doc.
3. Run `git -c core.fsmonitor=false status --short` before edits.
4. If the task touches KDS protocol/client, also read `Lariat-KDS/AGENTS.md` and `Lariat-KDS/docs/lariat-kds-protocol.md`.
5. If the task touches real source workbooks or HR/BEO/menu data, treat `lariat-data-sources/` as PII and preserve it.

### 2. Planning

Create or update a SPEC/PLAN for any work larger than a one-file docs/rule edit.

Plans must declare:

- Affected subsystem.
- Freeze-readiness impact.
- Determinism impact.
- Security/audit impact.
- Exact files in scope.
- Acceptance gates.

Fail closed on these ambiguities:

- Whether a web write route is truly ported.
- Whether a route is edge-retained or just unported.
- Whether a native write weakens web audit/PIN/HACCP semantics.
- Whether a data path is a duplicate or load-bearing.

### 3. Implementation

- Use a Lariat worktree for multi-commit or long-running work:
  `scripts/worktree.sh new claude feat/<short-name>`.
- Native app code stays under `LariatNative/**` unless the plan explicitly includes web edge, docs, workspace, or KDS files.
- Swift layers stay directional: `LariatApp -> LariatDB -> LariatModel`.
- Pure logic and parity math live in `LariatModel`.
- GRDB reads/writes live in `LariatDB`.
- SwiftUI and OS integration live in `LariatApp`.
- Regulated writes use `AuditedWriteRunner` / `AuditEventWriter` in the same transaction.
- Do not run native migrations against the live `data/lariat.db` until Phase C flip gates pass.

### 4. Review

Review order:

1. Scope: only planned files changed.
2. Contract: no weaker audit/PIN/HACCP/location semantics.
3. Determinism: no cloud runtime dependency, no hidden absolute path, no mutable manifest.
4. Tests: targeted gates first, then full relevant gate.
5. Docs: update endgame/edge-blocker/ledger/packaging docs when the truth changes.

Minimum gates by lane:

| Lane | Gate |
| --- | --- |
| LariatNative code | `swift build && swift test` from `LariatNative/` |
| KDS client/protocol | `swift test` from `Lariat-KDS/` plus the matching Lariat protocol tests |
| Web edge/API | Relevant `npm run test:*`, `npm run typecheck`, and `npm run build` from `hospitality/Lariat/` |
| Phase C ledger/cutover | C1 ledger verification, reconcile script, backup/restore evidence, and Opus/Max review |
| H8 packaging | `LariatNative/Scripts/package-app.sh --pkg`, `codesign --verify`, resource-bundle check, and GUI launch smoke |

## Agent Roles

Use existing Claude agents before inventing new ones:

- `swift-port-audit`: read-only scope report. Prefer Opus for money/HACCP/PIN/audit areas; Sonnet for ordinary view/read boards.
- `swift-port`: one feature area into native. Prefer Sonnet. For risky write paths, brief from an Opus audit first.
- `reviewer`: read-only review. Prefer Opus for regulated or Phase C work; Sonnet for narrow docs/UI.
- `fix-it`: parallel hypotheses on red gates. Opus coordinates hypotheses; Sonnet workers can test fixes.
- `llm-action-auditor`: use after kitchen-assistant/specials action diffs. Prefer Opus for security review.
- `coordinator`: batches independent tasks but never auto-merges.

Main-agent rule:

- The main agent owns integration, status, and the final claim.
- Subagents may gather evidence or implement scoped work, but the main agent reruns the gates and reads the diff before declaring completion.

## Cursor, Antigravity, and Xcode

Preferred final-native IDE entrypoints:

- Cursor/Antigravity: `~/Dev/workspaces/lariat-native.code-workspace`.
- Xcode: `~/Dev/workspaces/lariat-native.xcworkspace`.
- General Lariat/web edge: `~/Dev/workspaces/lariat.code-workspace`.
- KDS only: `~/Dev/workspaces/lariat-kds.code-workspace`.

Workspace rules:

- Do not open `~/` or bare `~/Dev`.
- Do not recursively search the whole Dev container.
- Do not let watcher/search include `.build`, `.swiftpm`, `.next`, `node_modules`, `data/lariat.db*`, `worktrees/**/.build`, or generated package/build artifacts.
- Use `LariatNative` SwiftPM tasks for native app gates.
- Use `Lariat-KDS` tasks only when KDS is in scope.

## Release and Cutover Guardrails

No final-native release claim is valid until:

1. `swift build && swift test` passes from `LariatNative/`.
2. KDS tests pass if any KDS contract changed.
3. H7/H8 status is current and documented.
4. The edge-blocker log matches the web surfaces kept after Phase D.
5. Phase C ledger has no unverified ported-write deletions.
6. The service-day shutoff test is completed and documented.
7. Packaging/notarization decisions are resolved or explicitly scoped out of that release.

Never delete, move, or rewrite `lariat-data-sources/`, `hospitality/Lariat`, `hospitality/Lariat/LariatNative`, or `Lariat-KDS` as part of consolidation without a backup, a restore test, and explicit user approval.
