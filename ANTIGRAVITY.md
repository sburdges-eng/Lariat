# Antigravity — Lariat

Use the same workspace and rules as Cursor and Gemini on this repo.

## Workspace (binding)

Open **`~/Dev/workspaces/lariat.code-workspace`** — not `~/`, not `~/Dev/`, not the home folder.

That workspace includes Lariat plus shared `workspace-scaffold` docs, scripts, agents, hooks, and skills. See `~/Dev/DEV_OPS_RUNBOOK.md`.

## Agent entrypoints

1. [AGENTS.md](AGENTS.md) — domain + MACP/worktrees
2. [GEMINI.md](GEMINI.md) — Gemini/Antigravity handoff protocol when Claude or Codex consults you
3. [../../workspace-scaffold/docs/TRIO_ORCHESTRATION.md](../../workspace-scaffold/docs/TRIO_ORCHESTRATION.md) — **Codex-first** trio policy

## Your role in the trio

- **Codex** orchestrates; prompts start in the Codex terminal when using the trio task layout.
- **You (Gemini/Antigravity)** — long-context review, second opinions, brainstorms. Append results to `.agent-sessions/handoff.md`, not only chat.
- **Claude** — implementation and commits.

## Search scope

Never scan from `~/Dev/` without `path: "/Users/seanburdges/Dev/hospitality/Lariat"`. Skip `node_modules/`, `build/`, `.venv/`, `data/lariat.db*`.
