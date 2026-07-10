// Packages each downloaded GGUF as an Ollama model and runs the WS-4 gate:
//   node training/gcp/evaluate-candidates.mjs [--skip-baseline] [--samples=N]
// For every candidate + the deployed baseline it:
//   1. runs the scenario eval N times (default 3) — multi-sample to see through
//      LLM-grader noise (KA v2 scored the SAME model 9.0/7.5/8.0);
//   2. applies the DETERMINISTIC format linter as a HARD pre-gate on the raw
//      command/question responses — a candidate that leaks a 2nd JSON block, a
//      <think> block, an unknown action, prose numbers on a command, a write
//      action on a question, or an allergen "safe" claim is DISQUALIFIED before
//      its LLM score counts (this is the gate the v2 UI-leak slipped past);
//   3. measures real COMMAND-path latency (full prompt) and reports p95.
// Emits training/gcp/artifacts/eval-results.json + a leaderboard.
// FLIP RULE (applied by the orchestrator): among format-passing candidates,
// flip the winner ONLY if its mean score exceeds the baseline mean by a margin
// larger than the observed grader noise (>= 1.0 aggregate points). Never flip a
// format-failing model regardless of score.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintCommandResponse, lintQuestionResponse } from '../eval/format-lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RESULTS_DIR = join(REPO, 'training', 'eval', 'results');
const skipBaseline = process.argv.includes('--skip-baseline');
const SAMPLES = parseInt((process.argv.find((a) => a.startsWith('--samples=')) || '--samples=3').split('=')[1], 10);
const metrics = JSON.parse(readFileSync(join(HERE, 'artifacts', 'metrics-all.json'), 'utf8'));

function makeModel(runId, baseModel) {
  let gguf = join(HERE, 'artifacts', runId, 'model-q4_k_m.gguf');
  if (!existsSync(gguf)) {
    const f16 = join(HERE, 'artifacts', runId, 'model-f16.gguf');
    if (!existsSync(f16)) return null;
    console.log(`quantizing ${runId} f16 -> q4_K_M locally…`);
    execSync(`llama-quantize ${JSON.stringify(f16)} ${JSON.stringify(gguf)} q4_k_m`, { stdio: 'inherit' });
  }
  const tmpl = baseModel.startsWith('meta-llama') ? 'Modelfile.llama31-v2.tmpl' : 'Modelfile.qwen-v2.tmpl';
  const mf = readFileSync(join(HERE, tmpl), 'utf8').replace('{{GGUF_PATH}}', gguf);
  const mfPath = join(HERE, 'artifacts', runId, 'Modelfile');
  writeFileSync(mfPath, mf);
  const name = `lari-ka-cand-${runId}`;
  execSync(`ollama create ${name} -f ${JSON.stringify(mfPath)}`, { stdio: 'inherit' });
  return name;
}

function runEval(model) {
  try {
    execFileSync(process.execPath,
      ['--experimental-strip-types', '--no-warnings', 'training/eval/run-eval.mjs'],
      {
        cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, LARIAT_OLLAMA_MODEL: model, EVAL_REQUIRE_OLLAMA: '1', EVAL_OLLAMA_ONLY: '1' },
      });
  } catch (e) {
    if (e.status === 1) return; // gate fail — results file still written
    const hint = e.status === 2 ? ' (Ollama unreachable or eval could not start?)' : '';
    throw new Error(`eval aborted for ${model}: status=${e.status} signal=${e.signal}${hint}`);
  }
}

function latestResultFull() {
  const files = readdirSync(RESULTS_DIR).filter((x) => x.endsWith('.json'))
    .map((x) => ({ x, t: statSync(join(RESULTS_DIR, x)).mtimeMs }))
    .sort((a, b) => a.t - b.t);
  if (!files.length) throw new Error(`no eval results in ${RESULTS_DIR} — did run-eval crash before writing?`);
  return JSON.parse(readFileSync(join(RESULTS_DIR, files.at(-1).x), 'utf8'));
}

// Deterministic format lint over one run's stored responses. Returns
// { formatPass, violations:[{id,vs}], commandMs:[...] }.
function lintRun(j) {
  const violations = [];
  const commandMs = [];
  for (const e of j.results || []) {
    const r = e.runners?.ollama;
    if (!r || !r.ok || typeof r.response !== 'string') continue;
    if (e.mode === 'command') {
      if (typeof r.ms === 'number') commandMs.push(r.ms);
      const res = lintCommandResponse(r.response);
      if (!res.ok) violations.push({ id: e.id, vs: res.violations });
    } else {
      const res = lintQuestionResponse(r.response, { intent: e.intent, requireTemp: e.requireTemp });
      if (!res.ok) violations.push({ id: e.id, vs: res.violations });
    }
  }
  return { formatPass: violations.length === 0, violations, commandMs };
}

const p95 = (arr) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.ceil(arr.length * 0.95) - 1)] : null);

function evaluateModel(model) {
  const scores = [];
  let formatPass = true;
  const allViolations = [];
  const allCommandMs = [];
  for (let s = 0; s < SAMPLES; s++) {
    runEval(model);
    const j = latestResultFull();
    if (j.ollama_model !== model) throw new Error(`stale results file (${j.ollama_model} != ${model})`);
    scores.push(j.ollama_totals?.score ?? 0);
    const lint = lintRun(j);
    if (!lint.formatPass) { formatPass = false; allViolations.push({ sample: s, ...lint }); }
    allCommandMs.push(...lint.commandMs);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    meanScore: +mean.toFixed(2), minScore: Math.min(...scores), maxScore: Math.max(...scores),
    scores, formatPass, violations: allViolations, commandP95Ms: p95(allCommandMs),
  };
}

const rows = [];
for (const m of metrics.slice(0, 4)) {
  const model = makeModel(m.run_id, m.base_model);
  if (!model) { console.error(`no GGUF for ${m.run_id}, skipping`); continue; }
  console.log(`\n=== evaluating ${model} (${SAMPLES} samples) ===`);
  try {
    const r = evaluateModel(model);
    rows.push({ runId: m.run_id, base: m.base_model, valLoss: m.val_loss, baseline: false, ...r });
    if (!r.formatPass) console.error(`  DISQUALIFIED (format): ${JSON.stringify(r.violations).slice(0, 300)}`);
  } catch (e) {
    console.error(`  SKIPPING ${m.run_id}: ${e.message}`);
    rows.push({ runId: m.run_id, base: m.base_model, valLoss: m.val_loss, baseline: false, error: String(e.message), meanScore: null, formatPass: false });
  }
}

if (!skipBaseline) {
  console.log(`\n=== evaluating deployed baseline (${SAMPLES} samples) ===`);
  const r = evaluateModel('lari-the-kitchen-assistant');
  rows.push({ runId: 'deployed-baseline', base: 'lari-the-kitchen-assistant (deepseek-r1:14b)', valLoss: null, baseline: true, ...r });
}

const baseline = rows.find((x) => x.baseline);
// Rank format-passing candidates by mean; format-fails sink to the bottom.
rows.sort((a, b) => (Number(b.formatPass) - Number(a.formatPass)) || ((b.meanScore ?? -1) - (a.meanScore ?? -1)));
writeFileSync(join(HERE, 'artifacts', 'eval-results.json'), JSON.stringify({ samples: SAMPLES, rows }, null, 2));

console.log(`\nLEADERBOARD (${SAMPLES}-sample mean; format-fail = auto-disqualified):`);
console.table(rows.map(({ runId, base, meanScore, minScore, maxScore, formatPass, commandP95Ms, baseline: bl }) =>
  ({ runId, base: base.slice(0, 34), meanScore, range: `${minScore ?? '-'}–${maxScore ?? '-'}`, formatPass, cmdP95ms: commandP95Ms, baseline: bl })));

// Advisory flip decision (orchestrator confirms): margin must exceed grader noise.
const MARGIN = 1.0;
const eligible = rows.filter((x) => !x.baseline && x.formatPass && x.meanScore != null);
const winner = eligible[0];
if (baseline && winner) {
  const margin = +(winner.meanScore - baseline.meanScore).toFixed(2);
  console.log(`\nbaseline mean=${baseline.meanScore} (formatPass=${baseline.formatPass}); best eligible ${winner.runId} mean=${winner.meanScore} (margin ${margin >= 0 ? '+' : ''}${margin})`);
  console.log(margin >= MARGIN
    ? `FLIP RECOMMENDED: ${winner.runId} beats baseline by ${margin} >= ${MARGIN} and passes the format gate.`
    : `DO NOT FLIP on score: margin ${margin} < ${MARGIN} (within grader noise). Stay on DeepSeek unless another reason.`);
} else if (!eligible.length) {
  console.log('\nNO ELIGIBLE CANDIDATE: every candidate failed the deterministic format gate. DO NOT FLIP.');
}
