# Lariat Kitchen Assistant — prompt eval

Grades the live `GROUNDED_SYSTEM` prompt (`lib/ollama.ts`) against a fixed
scenario set, using one or two LLM runners and Claude as a checklist grader.

Different from `tests/js/test-kitchen-assistant-*.mjs`: those test
deterministic code paths around the assistant. This one tests what the
**prompt itself** induces — grounding refusal, allergen escalation, HACCP
citation accuracy, action-JSON contract, and voice rules — by exercising
the prompt with a real model and grading the response.

## Quick start

```bash
# from repo root
node --experimental-strip-types --no-warnings training/eval/run-eval.mjs
```

Requires `hermes` on PATH and authenticated to an Anthropic provider (the
default is `anthropic/claude-opus-4.6` over Pro/Max OAuth — see
`hermes auth list`). If Ollama is running on `127.0.0.1:11434` with
`lari-the-kitchen-assistant` loaded, that leg runs too and surfaces the
deployed-model-vs-prompt-intent delta.

Results land in `training/eval/results/<iso-timestamp>.json` and a summary
prints to stdout. Exit code is non-zero on any FAIL or ERROR so the script
can gate CI.

## Layout

| File | Purpose |
|---|---|
| `scenarios.json` | 10 baseline scenarios, one per prompt invariant we care about |
| `run-eval.mjs` | runner — Hermes/Claude always; Ollama if reachable; Claude as grader |
| `results/` | per-run JSON dumps (gitignored — large) |

## Adding a scenario

Each scenario is:

```json
{
  "id": "T11",
  "name": "short title shown in run output",
  "category": "grounding|no_fabrication|allergen|haccp|source_boundary|menu_resolution|action_json|voice",
  "context": "what would appear under 'CONTEXT (authoritative):' in the user message — the prompt's grounding source",
  "user": "what the cook actually types/asks",
  "must_pass": [
    "behavior 1 — phrased so PASS/FAIL is unambiguous",
    "behavior 2 — keep them atomic"
  ]
}
```

Anti-patterns to avoid:

- **Vague behaviors.** "Helpful response" is unrunnable. "Names the
  ingredient that triggers the egg allergen" is.
- **Over-specifying word choice.** Test intent, not phrasing — the prompt
  defines voice elsewhere; voice is its own scenario (T10).
- **Conflating grounding and reasoning.** Either give the assistant the
  fact in CONTEXT and test that it uses it, or omit it and test that the
  assistant refuses. Don't half-give and grade reasoning.

## Env overrides

| Var | Default |
|---|---|
| `HERMES_MODEL` | `anthropic/claude-opus-4.6` |
| `LARIAT_OLLAMA_URL` | `http://127.0.0.1:11434` |
| `LARIAT_OLLAMA_MODEL` | `lari-the-kitchen-assistant` |
| `EVAL_SCENARIOS` | `training/eval/scenarios.json` |

## What the verdicts mean

The grader is told to be strict. For each scenario:

- **PASS** — every `must_pass` behavior cleared.
- **PARTIAL** — some passed, some failed. Treat as a regression signal
  during prompt iteration; the response is partly right but the prompt
  isn't reliably inducing all required behaviors.
- **FAIL** — most behaviors failed.
- **ERROR** — runner crashed (Hermes auth, Ollama down, network).

The script tallies on the Claude leg. Ollama verdicts are reported
inline but not counted in the exit code — Ollama-vs-Claude divergence is
where prompt-vs-model trade-offs surface, not an absolute pass/fail.
