# Agent Roles for Project Completion

A pipeline of specialised agents (and sub-agents) that ship a Lariat feature from idea to merged PR without anyone losing context, doing the same work twice, or hitting the wrong files. Each role has a single job, a fixed input, a fixed output, and a specific tool/subagent it maps to.

## TL;DR

```
                            ┌─────────────────┐
                            │  Orchestrator   │   (main thread — you)
                            └────────┬────────┘
                                     │
   ┌─────────────┬─────────────┬─────┴───────┬─────────────┬──────────────┐
   ▼             ▼             ▼             ▼             ▼              ▼
 Scout      Architect    Implementer   Lookahead       Reviewer       Memory
 (context) (next step)  (this step)   (next+1)       (post-commit)   Curator
                                                                     (background)
                                          │
                                     Verifier
                                  (gate after every
                                   implementer commit)
```

**Pipeline cadence per implementation step:**

1. Scout fetches everything relevant (gitnexus, file reads, memory).
2. Architect drafts the next plan section using Scout's output.
3. Implementer executes that section TDD-style.
4. **In parallel with step 3**, Lookahead drafts the *next* step's plan.
5. Verifier gates the commit (`npm run verify`).
6. Reviewer comments on the diff (post-commit, pre-PR-merge).
7. Memory Curator updates `AI_DEV_MEMORY.md` and project memory whenever a commit lands.

Steps 1–2 are serial. Step 3 can run in parallel with 4. Step 5 blocks 6/7. Step 6/7 run in parallel.

---

## Role definitions

### 1. Scout — context gatherer

**Job.** Before any code is written, pull every relevant fact into one place so downstream agents don't grep blindly.

**Inputs.** A natural-language description of the upcoming change (from Orchestrator).

**Outputs.** A single context bundle: file paths, gitnexus impact analysis, related-symbol callgraph excerpt, prior art commits, relevant memory excerpts, applicable patterns from `docs/PATTERNS.md`.

**Tools.**
- `mcp__gitnexus__query` (semantic find for the concept)
- `mcp__gitnexus__context` (callers/callees of named symbols)
- `mcp__gitnexus__impact` (blast radius for any symbol about to change)
- `mcp__gitnexus__route_map` / `tool_map` (HTTP/MCP entry points)
- `Read`, `Grep`
- `~/.claude/projects/-Users-seanburdges-Dev/memory/` (project memory)

**Subagent.** `feature-dev:code-explorer` or `Explore` (read-only, fast).

**Claims.** None — read-only role.

**Failure mode.** Returns "insufficient context" with a list of what's missing rather than guessing.

---

### 2. Architect — step planner

**Job.** Turn Scout's bundle into a numbered, TDD-shaped plan for *exactly one* implementation step. Same shape as `docs/superpowers/plans/*.md` — files to create/modify, function signatures, failing-test-first, commit boundaries.

**Inputs.** Scout's context bundle + the goal of the current step.

**Outputs.** A new section in `docs/superpowers/plans/<feature>-plan.md` (or a fresh plan file if it's a new feature). Numbered subtasks, each ending in a green test and a commit.

**Tools.** `Write`, `Edit`, `mcp__gitnexus__shape_check` (validate signatures against existing).

**Subagent.** `feature-dev:code-architect`.

**Claims.** The plan file only.

**Failure mode.** If the step is larger than ~5 commits, it splits into a sub-roadmap and asks Orchestrator to decide on ordering.

---

### 3. Implementer — code writer & debugger

**Job.** Execute one numbered step from the plan, TDD discipline. Red → green → commit.

**Inputs.** Plan section + Scout's bundle.

**Outputs.** Commits on the feature branch. Each commit passes `npm run verify`.

**Tools.** `Edit`, `Write`, `Bash` (test runs), `Read`. Uses the [TDD skill](../superpowers/) and the worktree protocol (`scripts/worktree.sh`).

**Subagent.** `general-purpose` or `strategic-implementer`. For deep debugging stalls, escalate to `codex:codex-rescue`.

**Claims.** Every file the current step touches (registered via `node scripts/agent-session.mjs update --claimed <files>`).

**Failure mode.** If a commit fails verify, the Implementer never proceeds — it reports back to Orchestrator with the failing output. No silent skipping.

---

### 4. Lookahead — next-step planner (parallel to Implementer)

**Job.** While the Implementer is heads-down on step N, the Lookahead drafts the plan for step N+1 so there's no stall when N completes.

**Inputs.** Architect's roadmap, Scout's context bundle, the partially-written code from step N (read-only).

**Outputs.** Plan section for step N+1 appended to the same plan file.

**Tools.** Same as Architect.

**Subagent.** `feature-dev:code-architect` (different invocation from the step-N Architect — runs concurrently).

**Claims.** Plan file *only* — never the same code files the Implementer holds.

**Failure mode.** If step N changes the contract Lookahead assumed, the N+1 plan is marked "rebase needed" and Orchestrator reruns it after N commits.

---

### 5. Verifier — gate runner

**Job.** Run `npm run verify` (and the targeted test files for the change) after every Implementer commit. Report PASS/FAIL only — never modifies code.

**Inputs.** A commit SHA.

**Outputs.** `verified: true|false`, with failing-test output on false.

**Tools.** `Bash` only.

**Subagent.** None — this is just the project's [`verify` skill](../superpowers/) wrapping `npm run verify`. Cheap to run inline from Orchestrator.

**Claims.** None.

**Failure mode.** On red, Implementer is told to fix before further work. Lookahead and Memory Curator are paused for that step.

---

### 6. Reviewer — post-commit critic

**Job.** Read the diff and surface bugs / convention violations / risk. No code changes — only comments.

**Inputs.** A diff range (`origin/main..HEAD`) or a PR number.

**Outputs.** A findings table: severity (critical/high/medium/low), file:line, issue, fix.

**Tools.** `git diff`, `Read`, `Grep`. Optionally invoked CodeRabbit (`@coderabbitai review` comment via `gh`) for an independent second opinion.

**Subagent.** `feature-dev:code-reviewer` for local; `coderabbit:code-reviewer` for cloud.

**Claims.** None — read-only.

**Failure mode.** Findings filtered to high-confidence only; speculative nits dropped. The Reviewer must justify each finding with a concrete fix.

---

### 7. Memory Curator — knowledge keeper

**Job.** Keep `AI_DEV_MEMORY.md` and `~/.claude/projects/-Users-seanburdges-Dev/memory/` in sync with reality. Updates project memory after every meaningful commit (new feature, schema change, convention shift).

**Inputs.** Git log since last curation.

**Outputs.**
- New / updated entries in `~/.claude/projects/-Users-seanburdges-Dev/memory/` (correct frontmatter, per the auto-memory rules)
- Pointer line in `~/Dev/AI_DEV_MEMORY.md` if the commit established a new cross-project takeaway
- Refresh of `gitnexus_detect_changes` index if the commit added new symbols (`npx gitnexus analyze`)

**Tools.** `Write`, `Edit`, `git log`, `mcp__gitnexus__detect_changes`, gitnexus CLI.

**Subagent.** `general-purpose` running in the background.

**Claims.** Memory files only — never source code.

**Failure mode.** Memory entries that contradict the current code are deleted (per auto-memory "trust observed state" rule), not silently rewritten.

---

### 8. Orchestrator — meta-coordinator

**Job.** Dispatches everyone else. Holds the big picture. Decides ordering, claims, when to escalate. **This is the main Claude thread (you).**

**Inputs.** User intent + all of the above outputs.

**Outputs.** Tool calls that drive the pipeline. Status updates back to the user.

**Tools.** Everything. Specifically uses `Agent` to spawn sub-agents and `TaskCreate`/`TaskUpdate` to track progress.

**Claims.** Manages claims for everyone via `node scripts/agent-session.mjs update`.

**Failure mode.** If two agents need conflicting claims, Orchestrator serializes them. Never lets the pipeline silently stall — every wait has a deadline.

---

## Concurrency rules

Two agents may run in parallel **only if** their claim sets are disjoint:

| Pair | Parallel? | Why |
|---|---|---|
| Scout + Implementer | ✓ | Scout reads only, no claims |
| Implementer + Lookahead | ✓ | Different files (code vs plan) |
| Implementer + Verifier (after commit) | ✓ | Verifier reads only |
| Reviewer + Memory Curator | ✓ | Both read-only or memory-only |
| Architect + Implementer | ✗ | Architect writes the plan the Implementer is reading |
| Implementer + Implementer | ✗ | Conflicting claims |

The hard rule: **`agent-session.mjs list` is checked before any sub-agent that writes is spawned.**

---

## Handoff artifacts

Each role produces a **named, persistent artifact** so downstream agents don't have to re-derive context:

| Role | Artifact | Lives at |
|---|---|---|
| Scout | Context bundle | Returned to Orchestrator (transient) |
| Architect | Plan section | `docs/superpowers/plans/<feature>-plan.md` |
| Implementer | Commit + test output | Git history |
| Lookahead | Plan section (N+1) | Same plan file |
| Verifier | Pass/fail | Orchestrator decision |
| Reviewer | Findings table | PR comment or chat |
| Memory Curator | Memory file | `~/.claude/projects/.../memory/<topic>.md` |

Plans, commits, and memory files are durable. Scout/Verifier/Reviewer outputs are transient and fed straight to the next role.

---

## Failure & escalation

| Symptom | First responder | Escalation |
|---|---|---|
| Tests red after Implementer commit | Implementer (fix loop) | After 3 fix attempts → `codex:codex-rescue` |
| Plan step too large | Architect (split) | Orchestrator reorders |
| Diff fails Reviewer | Implementer (address) | Skip with documented reason if disputed |
| Scout returns "insufficient context" | Orchestrator clarifies with user | Don't proceed to Architect |
| Two agents want same claim | Orchestrator serialises | Never both write |
| Memory contradicts code | Memory Curator deletes stale entry | — |

---

## Example: implementing one numbered step

Concrete walkthrough for "Task 8: Save form on /specials page" from the specials-persistence plan.

1. **Orchestrator** marks the task in_progress (`TaskUpdate`).
2. **Scout** runs in parallel:
   - `gitnexus_query("specials sandbox UI")` → finds `app/specials/page.jsx`
   - `gitnexus_context("SpecialsPage")` → finds existing component shape
   - Reads `docs/UI_COPY_RULES.md` for the copy constraints
   - Reads `docs/PATTERNS.md §10` for the LLM action JSON pattern
   - Returns a context bundle
3. **Architect** appends Task 8's section to the plan: failing test path, exact JSX skeleton, fetch shape, four numbered subtasks.
4. **Implementer** claims `app/specials/page.jsx` and `app/__tests__/SpecialsPageSave.test.jsx`. TDD: writes the failing test, sees red, writes the JSX, sees green, commits.
5. **Lookahead** runs in parallel with step 4 — drafts Task 9's plan (saved list page). Claims plan file only.
6. **Verifier** runs after the commit: `npm run verify` → green.
7. **Reviewer** scans the diff: e.g. flags missing redirect handling for the save fetch (real Codex P1 we hit on PR #77). Returns findings.
8. **Implementer** addresses Reviewer findings, recommits, Verifier reruns.
9. **Memory Curator** notices a new `Save this special` button + state-shape and adds a memory entry under `specials_persistence_save_flow.md` if non-obvious; otherwise no-op.
10. **Orchestrator** marks Task 8 completed and starts Task 9 (which Lookahead has already planned).

---

## Mapping to Lariat tooling

| Concept | Lariat hook |
|---|---|
| Claims | `node scripts/agent-session.mjs update/list` |
| Branch lock | `scripts/check-session-branch.mjs` (pre-commit guard) |
| Worktree per agent | `scripts/worktree.sh new <agent> <branch>` |
| Plans | `docs/superpowers/plans/` |
| Specs | `docs/superpowers/specs/` |
| Verify gate | `npm run verify` |
| Schema regression | `npm run test:schema` |
| Code intelligence | `npx gitnexus analyze` + `mcp__gitnexus__*` |
| Memory | `~/.claude/projects/-Users-seanburdges-Dev/memory/` |
| Cross-project memory | `~/Dev/AI_DEV_MEMORY.md` |

---

## When not to use this pipeline

- Single-file fix that's obviously a one-liner (no Scout, no plan — just commit).
- Doc-only changes (Architect + Implementer collapse into one).
- Emergency hotfixes (Reviewer can be deferred to post-merge).

The pipeline shines on **multi-step features with non-obvious dependencies** (e.g. specials-persistence: 12 steps across schema, API, UI, middleware, nav). For 1-step changes the overhead isn't worth it.
