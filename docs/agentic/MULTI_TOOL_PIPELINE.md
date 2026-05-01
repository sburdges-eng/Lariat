# Multi-Tool Agent Pipeline

Companion to [`AGENT_ROLES.md`](AGENT_ROLES.md). That document defines **what** each role does. This document defines **which tool plays each role**, how Claude / Codex / Gemini hand off work, and how the existing per-tool sessions plug into the pipeline.

## Current sessions

Snapshot — keep this section current via `node scripts/agent-session.mjs update --tool <name> --status <s>`.

```
$ node scripts/agent-session.mjs list

claude  · Orchestrator + primary Implementer · branch main
gemini  · idle (MACP work shipped 2026-05-01)
codex   · on-demand (rescue / second opinion / parallel implementer)
```

## Tool capability profile

| Tool | Strengths | Weak spots | Primary handle |
|---|---|---|---|
| **Claude Code** | Rich Edit/Write tooling, MCP integrations, auto-memory, deep Anthropic-SDK fluency | Most expensive token-wise on Opus | This session, native |
| **Codex (GPT-5.4)** | Strong second-opinion model, isolated runtime via `codex:codex-rescue`, willing to do deep root-cause | No persistent memory between rescues | `codex:codex-rescue` plugin / `codex` CLI |
| **Gemini CLI** | Very long context (whole-module reads in one shot), low-latency brainstorming, second-opinion model class | Less mature MCP tooling, no Edit | `mcp__gemini-cli__ask-gemini`, `mcp__gemini-cli__brainstorm` |

The principle: **don't pick a tool by tribe. Pick by role-fit.**

## Role-to-tool assignment

Each role from `AGENT_ROLES.md` mapped to its best-fit tool, with a fallback.

| Role | Primary | Fallback / Second-pass | Why |
|---|---|---|---|
| Orchestrator | Claude | — | Only one orchestrator; main thread holds context |
| Scout | Claude (`feature-dev:code-explorer`) | Gemini (`ask-gemini` for whole-module scans) | Gemini wins when the relevant context spans >50 files |
| Architect | Claude (`feature-dev:code-architect`) | Gemini (`brainstorm`) | Gemini brainstorm for fresh framing; Claude codifies |
| Implementer | Claude (`general-purpose` / `strategic-implementer`) | Codex (`codex:codex-rescue`) for stalls; Gemini (own worktree) for parallel independent tasks | Claude is the default builder |
| Lookahead | Claude (`feature-dev:code-architect`, 2nd invocation) | — | Same instance class as Architect |
| Verifier | Inline Bash | — | Just runs `npm run verify` |
| Reviewer (1st pass) | Claude (`feature-dev:code-reviewer`) | — | Local, fast |
| Reviewer (2nd pass — independent) | Codex + Gemini (run in parallel) | — | Different model classes catch different bugs |
| Reviewer (3rd pass — cloud) | CodeRabbit (`@coderabbitai review`) | Cursor Bugbot (auto-runs on PR) | External, opinionated |
| Memory Curator | Claude (auto-memory rules are Claude-specific) | — | Memory at `~/.claude/projects/...` is Claude-managed |
| Rescue Implementer | Codex (`codex:codex-rescue`) | Gemini in own worktree | After 3 Claude fix attempts |

The key non-obvious calls:
- **Reviewer pass 2 = Codex + Gemini in parallel.** Different model families miss different bugs. Cheap to run both at once for substantial diffs.
- **Lookahead is always Claude.** Stays in the same plan-document context as Architect.
- **Memory Curator is Claude-only.** The auto-memory rules at `~/.claude/projects/.../memory/` aren't visible to Codex/Gemini; trying to delegate this just creates drift.

## Cross-tool handoff protocols

### Claims protocol

`scripts/agent-session.mjs` is the cross-tool source of truth.

```bash
# Before any write, every tool MUST run:
node scripts/agent-session.mjs list

# Before claiming files:
node scripts/agent-session.mjs update --tool <claude|codex|gemini> --status "<one-line>" --claimed "<comma,separated,files>"

# When done with a step:
node scripts/agent-session.mjs update --tool <name> --status idle --claimed ""
```

Per-tool wrappers: each tool's `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` should reference this convention. The pre-commit guard at `scripts/check-session-branch.mjs` enforces the branch lock side; the file-claim side is advisory but observed.

### Worktree protocol

Each tool gets its own worktree to avoid HEAD ping-pong:

```bash
scripts/worktree.sh new claude  <branch>      # → ../Lariat-worktrees/claude-<branch>
scripts/worktree.sh new codex   <branch>      # → ../Lariat-worktrees/codex-<branch>
scripts/worktree.sh new gemini  <branch>      # → ../Lariat-worktrees/gemini-<branch>
```

When two tools work on the same feature, they typically work on **different branches** (e.g. one builds Task 5, the other Task 6) and merge through PRs. When two tools work on the same branch, only one writes at a time per the claims protocol.

### Codex handoff: rescue

Trigger: Implementer (Claude) has tried 3+ fixes and tests still fail.

```
Claude → Codex via codex:codex-rescue subagent
       → prompt includes: failing test output, attempted fixes, plan section, file paths
       → Codex returns: diagnosis + suggested fix
Claude reads Codex output, applies suggestion, reruns tests
```

If Codex can't fix it either, Orchestrator escalates to user.

### Codex handoff: second-opinion review

Trigger: Substantial diff (>200 lines) on a new feature, before PR merge.

```
Claude opens PR → Claude runs feature-dev:code-reviewer locally
                → Claude triggers Codex via codex:codex-rescue with prompt:
                  "Review the diff in <branch>. Findings only, no code edits."
                → Codex returns severity-tagged findings
                → Claude diffs Codex findings against own findings; addresses unique ones
```

### Gemini handoff: brainstorm

Trigger: Architect needs framing help on a fuzzy feature (no clear shape yet).

```
Claude calls mcp__gemini-cli__brainstorm with prompt:
  "<feature description>, <constraints from CLAUDE.md>, what shapes are reasonable?"
Gemini returns 3-4 shapes
Claude picks one + writes plan
```

### Gemini handoff: long-context analyzer

Trigger: Scout needs to understand a module that spans many files (e.g. understanding the full ETL pipeline before changing one stage).

```
Claude calls mcp__gemini-cli__ask-gemini with prompt:
  "Read scripts/ingest-*.mjs, lib/computeEngine/*, and lib/costingBenchmarks.mjs.
   Trace the path from a vendor CSV row to a recipe cost. Report under 600 words."
Gemini returns the trace
Claude proceeds with surgical confidence
```

### Gemini handoff: parallel independent task

Trigger: Two unrelated tasks queued, both have plans. Wall-clock matters.

```
Claude (own worktree)  → claims branch A, builds Feature A
Gemini (own worktree)  → claims branch B, builds Feature B
                       (driven by user opening a Gemini CLI session)
Each pushes its branch + opens its PR
Memory Curator (Claude) updates after both merge
```

This is the only case where Gemini does primary implementation. Reason: the user has to actually drive the Gemini CLI session — Claude can't spawn a Gemini implementer remotely.

## Orchestrator decision tree

When picking who does the next step:

```
Is it a code change?
├── Yes → Is it small (one-step) and obvious?
│   ├── Yes → Claude inline; skip Scout/Architect
│   └── No  → Full pipeline; Claude is Architect + Implementer by default
└── No → Is it a memory / docs / plan update?
    ├── Memory  → Claude (auto-memory)
    ├── Plan    → Claude (Architect)
    └── Other   → Claude inline

Is the Implementer stuck (3+ red runs)?
├── Yes → Codex rescue
└── No  → continue

Is the diff substantial (>200 lines, >5 files)?
├── Yes → Reviewer pass 2 = Codex + Gemini in parallel
└── No  → Reviewer pass 1 only (Claude local)

Is the next feature unrelated to current work + is user driving Gemini?
├── Yes → Hand it to Gemini in own worktree
└── No  → Claude carries on
```

## Concrete pipeline run — example

Walking the specials-persistence feature retroactively to show how it would have used the multi-tool pipeline.

| Step | Role | Tool | What happened (actual) | What multi-tool would change |
|---|---|---|---|---|
| 0 | Orchestrator | Claude | User asked to start | — |
| 1 | Scout | Claude | grep + read CLAUDE.md / PATTERNS.md | Could have used `ask-gemini` to long-scan all `app/api/*/route.js` for the RFC-4180 audit pattern in one shot |
| 2 | Architect | Claude | Wrote 12-task plan | — |
| 3 | Implementer (Tasks 1-5) | Claude | TDD'd through schema, validators, exporter, routes | — |
| 4 | Implementer (Tasks 6-11) | Claude (this session) | TDD'd through export endpoint, UI, gates | — |
| 5 | Verifier | inline | `npm run verify` after each commit | — |
| 6 | Reviewer pass 1 | Claude (`feature-dev:code-reviewer`) | Found 4 issues, 2 valid | — |
| 7 | Reviewer pass 2 | **Cursor Bugbot + CodeRabbit** | Found 5 more issues, 4 valid | Should have **also** run Codex review in parallel — would have caught the location-query bug Bugbot caught, sooner |
| 8 | Memory Curator | Claude | Auto-memory rules apply | — |

Net delta: one extra Codex parallel review at step 7 would have shifted the location-query fix earlier, before Cursor Bugbot saw it.

## Status integration

Each tool reports status via `agent-session.mjs update`:

| Tool | Status format |
|---|---|
| Claude | `"<role>: <task>"` e.g. `"Implementer: Task 8 specials save form"` |
| Codex | `"Rescue: <symptom>"` e.g. `"Rescue: failing test in test-cooling-rules"` |
| Gemini | `"<role>: <task>"` e.g. `"Implementer: feat/menu-engineering-prep-median"` |

Pipeline-wide rule: **if your status is older than 30 minutes and you're still claimed on files, you're stalled — Orchestrator may force-clear your claim.**

## Bootstrapping a multi-tool run

For the next feature, the Orchestrator should:

1. Pick the feature; mark `agent-session` with the Claude orchestrator status.
2. Run Scout (Claude or Gemini long-context, depending on scope).
3. Run Architect (Claude); produce plan in `docs/superpowers/plans/`.
4. **Decide split.** If two independent task groups: hand one to Gemini via user-driven session. Otherwise Claude continues.
5. Implementer loop: TDD, commit, Verifier; on stall escalate to Codex.
6. After feature complete: Reviewer pass 1 (Claude). On substantial diff: Reviewer pass 2 (Codex + Gemini in parallel). Always: cloud reviewers via PR.
7. Memory Curator (Claude) updates after merge.

## When to skip the multi-tool pipeline

Same conditions as `AGENT_ROLES.md` — single-file fixes, doc-only changes, hotfixes. Plus:

- **No Codex rescue if Claude hasn't tried 3 times.** It's a backstop, not a bypass.
- **No Gemini brainstorm for problems with a known shape.** Brainstorming a known shape just adds latency.
- **No parallel Reviewer pass for diffs <50 lines.** One pass is plenty.

## See also

- [`AGENT_ROLES.md`](AGENT_ROLES.md) — the base role definitions
- `scripts/agent-session.mjs` — the claims tool
- `scripts/worktree.sh` — per-tool worktree creation
- `scripts/check-session-branch.mjs` — pre-commit branch lock
- `~/Dev/AGENTS.md` — cross-tool conventions (Codex, Antigravity, Cursor)
- `~/Dev/GEMINI.md` — Gemini-specific rules
