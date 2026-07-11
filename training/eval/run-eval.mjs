#!/usr/bin/env node
// Lariat Kitchen Assistant — prompt eval harness.
//
// Drives the assistant prompt (lib/ollama.ts::GROUNDED_SYSTEM) against
// a fixed scenario set and grades each response against per-scenario
// must_pass behaviors. Two runners:
//   1. anthropic-claude  — always on, uses `hermes -z` (Pro/Max OAuth)
//   2. ollama-live       — only if 11434 is reachable
// One grader (Claude via hermes) judges every response.
//
// Why not the existing test suites: those are unit/integration tests
// for deterministic code. This grades stochastic LLM output against
// the prompt's stated invariants (grounding, allergen escalation,
// HACCP citations, action-JSON contract, voice rules). The signal it
// produces is what the prompt actually *induces*, not what the code
// *guarantees*.
//
// Run: node --experimental-strip-types --no-warnings training/eval/run-eval.mjs
//
// Env overrides:
//   HERMES_MODEL          override `-m` flag (default anthropic/claude-opus-4.6)
//   LARIAT_OLLAMA_URL     Ollama base (default http://127.0.0.1:11434)
//   LARIAT_OLLAMA_MODEL   Ollama model (default lari-the-kitchen-assistant)
//   EVAL_SCENARIOS        path override (default training/eval/scenarios.json)
//   EVAL_REQUIRE_OLLAMA=1 gate on the ollama (deployed-model) leg; exit 2 if
//                         Ollama is unreachable instead of silently skipping
//   EVAL_OLLAMA_ONLY=1    skip the hermes candidate leg (grader still hermes)

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { GROUNDED_SYSTEM } from '../../lib/ollama.ts';
import { tallyVerdicts } from './tally.mjs';
// The per-turn directive is what makes a COMMAND scenario exercise the
// action-JSON path — the KA v2 eval omitted it, so it never tested the command
// path where the UI JSON-leak lived. These import DB-free from the dataset
// sources (they are extracted from route.js, not built from the snapshot).
import { ACTION_DIRECTIVE, ANSWER_FORMAT } from '../datasetv2/sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCENARIOS_PATH = process.env.EVAL_SCENARIOS || join(HERE, 'scenarios.json');
const RESULTS_DIR = join(HERE, 'results');
// Hermes: rely on the user's configured default (`hermes config show` ->
// model.default + model.provider). Passing `-m` without `--provider`
// bails with "No LLM provider configured", and pinning both inside the
// script would silently mask provider drift. HERMES_MODEL stays as an
// optional override for grid runs.
const HERMES_MODEL_OVERRIDE = process.env.HERMES_MODEL || '';
const HERMES_PROVIDER_OVERRIDE = process.env.HERMES_PROVIDER || '';
const OLLAMA_URL = (process.env.LARIAT_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.LARIAT_OLLAMA_MODEL || 'lari-the-kitchen-assistant';
// EVAL_REQUIRE_OLLAMA=1 — the deployed-model (ollama) leg becomes the gate:
// unreachable Ollama exits 2 instead of silently skipping, and the exit code
// tallies ollama verdicts instead of the claude leg. Added for KA v2 so a
// candidate flip can't hide behind the prompt-only claude baseline again
// (lari-qwen's 1/10 ollama leg hid behind `totals: PASS=10`).
// EVAL_OLLAMA_ONLY=1 — skip the hermes candidate leg (grading still uses
// hermes); halves wall-clock when comparing many local candidates whose
// claude leg would be identical anyway.
const REQUIRE_OLLAMA = process.env.EVAL_REQUIRE_OLLAMA === '1';
const OLLAMA_ONLY = process.env.EVAL_OLLAMA_ONLY === '1';
// 180s gives multi-criterion safety graders (e.g. T03 allergen — 4 must_pass
// items) headroom over the 90s ceiling that was firing as
// `grader exit=null: (empty)` from spawnSync's SIGTERM. If hermes truly hangs
// the timeout still trips eventually; the regression is +90s of clock budget
// on a wedged provider, which is acceptable for a pre-merge gate.
const HERMES_TIMEOUT_MS = 180_000;
const OLLAMA_TIMEOUT_MS = 90_000;

// ── runners ────────────────────────────────────────────────────────────────

// Always rely on configured defaults unless BOTH overrides are set —
// `hermes -z` rejects `-m` without `--provider` ("No LLM provider
// configured"). Pinning a model alone here would silently break.
function invokeHermes(prompt) {
  const args = [];
  if (HERMES_MODEL_OVERRIDE && HERMES_PROVIDER_OVERRIDE) {
    args.push('--provider', HERMES_PROVIDER_OVERRIDE, '-m', HERMES_MODEL_OVERRIDE);
  }
  args.push('-z', prompt);
  return spawnSync('hermes', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: HERMES_TIMEOUT_MS,
  });
}

function buildUserMessage(scenario) {
  // Append the SAME per-turn directive route.js appends, keyed on the scenario
  // mode, so command scenarios actually carry the ACTION ENGINE DIRECTIVE
  // (byte-matched to serving) and the ollama leg exercises the command path.
  const directive = scenario.mode === 'command' ? ACTION_DIRECTIVE : ANSWER_FORMAT;
  return `CONTEXT (authoritative):\n${scenario.context}\n\nQuestion:\n${scenario.user}${directive}`;
}

// Hermes -z is single-prompt; merge system+user with a hard fence so the
// graded model can't blur them. This mirrors the floor-app's chat shape
// closely enough for prompt-induced behavior to surface.
function runHermesAsAssistant(scenario) {
  const userMsg = buildUserMessage(scenario);
  const merged = [
    'Act as the assistant described in the SYSTEM block below.',
    'Respond ONLY with the assistant\'s reply — no preamble, no meta commentary.',
    '',
    '=== SYSTEM ===',
    GROUNDED_SYSTEM,
    '',
    '=== USER MESSAGE ===',
    userMsg,
  ].join('\n');
  const r = invokeHermes(merged);
  if (r.status !== 0 || !r.stdout) {
    return { ok: false, error: `hermes exit=${r.status} ${(r.stderr || r.stdout || '').slice(0, 600) || '(empty)'}` };
  }
  return { ok: true, content: r.stdout.trim() };
}

async function ollamaReachable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function runOllamaAsAssistant(scenario) {
  const userMsg = buildUserMessage(scenario);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        think: false,
        messages: [
          { role: 'system', content: GROUNDED_SYSTEM },
          { role: 'user', content: userMsg },
        ],
        options: { temperature: 0.2, top_p: 0.85, num_predict: 512, num_ctx: 4096 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `ollama HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }
    const data = await res.json();
    const content = data?.message?.content;
    if (typeof content !== 'string') return { ok: false, error: 'ollama: no message content' };
    return { ok: true, content: content.trim() };
  } catch (e) {
    return { ok: false, error: `ollama: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// ── grader ─────────────────────────────────────────────────────────────────

// Claude grades the response against the scenario's must_pass checklist.
// Output format is parsed below; we lean on a final "VERDICT:" line so a
// regex is enough — no JSON-parsing-of-LLM-output drama.
function gradeResponse(scenario, response) {
  const checklist = scenario.must_pass.map((b, i) => `  ${i + 1}. ${b}`).join('\n');
  const prompt = [
    'You are grading a kitchen-assistant response against a checklist.',
    'Be strict. PASS only if the response clearly satisfies the behavior.',
    '',
    'QUESTION THE COOK ASKED:',
    scenario.user,
    '',
    'CONTEXT THE ASSISTANT WAS GIVEN:',
    scenario.context,
    '',
    'ASSISTANT\'S RESPONSE:',
    response,
    '',
    'REQUIRED BEHAVIORS:',
    checklist,
    '',
    'For each numbered behavior, output exactly one line:',
    '  <N>. PASS|FAIL — <one-sentence reason>',
    '',
    'Then on a single final line, output exactly one of:',
    '  VERDICT: PASS',
    '  VERDICT: PARTIAL',
    '  VERDICT: FAIL',
    '(PASS = all behaviors pass; FAIL = no behaviors pass; PARTIAL = some pass, some fail.)',
  ].join('\n');
  const r = invokeHermes(prompt);
  if (r.status !== 0 || !r.stdout) {
    return {
      verdict: 'ERROR',
      detail: `grader exit=${r.status}: ${(r.stderr || r.stdout || '').slice(0, 400) || '(empty)'}`,
    };
  }
  const out = r.stdout.trim();
  const m = out.match(/VERDICT:\s*(PASS|PARTIAL|FAIL)/i);
  return { verdict: m ? m[1].toUpperCase() : 'UNKNOWN', detail: out };
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const scenarios = JSON.parse(readFileSync(SCENARIOS_PATH, 'utf8'));
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    console.error('No scenarios loaded.');
    process.exit(2);
  }
  const useOllama = await ollamaReachable();
  if (REQUIRE_OLLAMA && !useOllama) {
    console.error(`EVAL_REQUIRE_OLLAMA=1 but Ollama is unreachable at ${OLLAMA_URL}`);
    process.exit(2);
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(RESULTS_DIR, { recursive: true });

  const hermesDesc = HERMES_MODEL_OVERRIDE && HERMES_PROVIDER_OVERRIDE
    ? `${HERMES_PROVIDER_OVERRIDE} / ${HERMES_MODEL_OVERRIDE}`
    : '(configured default — see `hermes config show`)';
  console.log(`Lariat Kitchen Assistant prompt eval`);
  console.log(`  scenarios:   ${scenarios.length}`);
  console.log(`  hermes:      ${hermesDesc}`);
  console.log(`  ollama:      ${useOllama ? `ON (${OLLAMA_URL}, model=${OLLAMA_MODEL})` : 'SKIPPED (not reachable)'}`);
  console.log('');

  const results = [];

  for (const sc of scenarios) {
    process.stdout.write(`[${sc.id}] ${sc.name.padEnd(54)} ... `);
    const entry = {
      id: sc.id, name: sc.name, category: sc.category,
      mode: sc.mode || 'question', intent: sc.intent, requireTemp: sc.requireTemp,
      expectAction: sc.expectAction, runners: {},
    };

    // --- claude leg (always, unless EVAL_OLLAMA_ONLY) ---
    if (OLLAMA_ONLY) {
      entry.runners.claude = { ok: false, error: 'skipped (EVAL_OLLAMA_ONLY)' };
    } else {
      const claudeT0 = Date.now();
      const claudeResp = runHermesAsAssistant(sc);
      const claudeMs = Date.now() - claudeT0;
      if (!claudeResp.ok) {
        entry.runners.claude = { ok: false, error: claudeResp.error, ms: claudeMs };
      } else {
        const grade = gradeResponse(sc, claudeResp.content);
        entry.runners.claude = {
          ok: true,
          ms: claudeMs,
          response: claudeResp.content,
          verdict: grade.verdict,
          grader_detail: grade.detail,
        };
      }
    }

    // --- ollama leg (optional) ---
    if (useOllama) {
      const ollT0 = Date.now();
      const ollResp = await runOllamaAsAssistant(sc);
      const ollMs = Date.now() - ollT0;
      if (!ollResp.ok) {
        entry.runners.ollama = { ok: false, error: ollResp.error, ms: ollMs };
      } else {
        const grade = gradeResponse(sc, ollResp.content);
        entry.runners.ollama = {
          ok: true,
          ms: ollMs,
          response: ollResp.content,
          verdict: grade.verdict,
          grader_detail: grade.detail,
        };
      }
    }

    const v = entry.runners.claude.verdict || (entry.runners.claude.ok ? 'UNKNOWN' : 'ERROR');
    const tag = v === 'PASS' ? 'PASS  '
              : v === 'PARTIAL' ? 'PARTIAL'
              : v === 'FAIL' ? 'FAIL  '
              : 'ERR   ';
    let suffix = '';
    if (useOllama) {
      const ov = entry.runners.ollama?.verdict || (entry.runners.ollama?.ok ? 'UNKNOWN' : 'ERROR');
      suffix = `  [ollama: ${ov}]`;
    }
    console.log(`${tag}${suffix}`);
    results.push(entry);
  }

  const claudeTally = tallyVerdicts(results, 'claude');
  const ollamaTally = useOllama ? tallyVerdicts(results, 'ollama') : null;

  const summary = {
    timestamp: new Date().toISOString(),
    hermes_model: HERMES_MODEL_OVERRIDE || '(configured default)',
    hermes_provider: HERMES_PROVIDER_OVERRIDE || '(configured default)',
    ollama_used: useOllama,
    ollama_model: useOllama ? OLLAMA_MODEL : null,
    ollama_only: OLLAMA_ONLY,
    totals: {
      scenarios: scenarios.length,
      pass: claudeTally.pass,
      partial: claudeTally.partial,
      fail: claudeTally.fail,
      error: claudeTally.error,
    },
    ollama_totals: ollamaTally,
    results,
  };
  const outPath = join(RESULTS_DIR, `${ts}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('');
  console.log(`totals: PASS=${claudeTally.pass}  PARTIAL=${claudeTally.partial}  FAIL=${claudeTally.fail}  ERR=${claudeTally.error}`);
  if (ollamaTally) {
    console.log(`ollama-leg: PASS=${ollamaTally.pass}  PARTIAL=${ollamaTally.partial}  FAIL=${ollamaTally.fail}  ERR=${ollamaTally.error}  score=${ollamaTally.score}`);
  }
  console.log(`saved:  ${outPath}`);

  if (REQUIRE_OLLAMA) {
    // Gate on the deployed-model leg. Any FAIL or ERROR fails the gate;
    // PARTIAL is tolerated (the historical deployed baseline is 8-9/10, so a
    // 10/10 requirement would block every flip; PARTIALs surface in the log).
    if (!ollamaTally || ollamaTally.fail > 0 || ollamaTally.error > 0) process.exit(1);
  } else if (!OLLAMA_ONLY) {
    // Original behavior: nonzero on any non-PASS so this can gate CI. The
    // frozen claude-leg baseline is 10/10 PASS — PARTIAL is a regression on a
    // baseline that already passes every behavior, not a tolerated grey zone.
    if (claudeTally.fail > 0 || claudeTally.error > 0 || claudeTally.partial > 0) process.exit(1);
  }
}

main().catch((e) => {
  console.error('eval crashed:', e);
  process.exit(2);
});
