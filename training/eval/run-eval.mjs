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

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { GROUNDED_SYSTEM } from '../../lib/ollama.ts';

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
  return `CONTEXT (authoritative):\n${scenario.context}\n\nQuestion:\n${scenario.user}`;
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
  let totalPass = 0;
  let totalFail = 0;
  let totalPartial = 0;
  let totalError = 0;

  for (const sc of scenarios) {
    process.stdout.write(`[${sc.id}] ${sc.name.padEnd(54)} ... `);
    const entry = { id: sc.id, name: sc.name, category: sc.category, runners: {} };

    // --- claude leg (always) ---
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

    // tally on claude verdict (the always-on path)
    const v = entry.runners.claude.verdict || (entry.runners.claude.ok ? 'UNKNOWN' : 'ERROR');
    if (v === 'PASS') { totalPass++; }
    else if (v === 'FAIL') { totalFail++; }
    else if (v === 'PARTIAL') { totalPartial++; }
    else { totalError++; }

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

  const summary = {
    timestamp: new Date().toISOString(),
    hermes_model: HERMES_MODEL_OVERRIDE || '(configured default)',
    hermes_provider: HERMES_PROVIDER_OVERRIDE || '(configured default)',
    ollama_used: useOllama,
    ollama_model: useOllama ? OLLAMA_MODEL : null,
    totals: {
      scenarios: scenarios.length,
      pass: totalPass,
      partial: totalPartial,
      fail: totalFail,
      error: totalError,
    },
    results,
  };
  const outPath = join(RESULTS_DIR, `${ts}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('');
  console.log(`totals: PASS=${totalPass}  PARTIAL=${totalPartial}  FAIL=${totalFail}  ERR=${totalError}`);
  console.log(`saved:  ${outPath}`);

  // Exit code: nonzero on any non-PASS so this can gate CI. The frozen
  // baseline is 10/10 PASS — PARTIAL is a regression on a baseline that
  // already passes every behavior, not a tolerated grey zone.
  if (totalFail > 0 || totalError > 0 || totalPartial > 0) process.exit(1);
}

main().catch((e) => {
  console.error('eval crashed:', e);
  process.exit(2);
});
