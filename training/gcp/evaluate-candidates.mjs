// Packages each downloaded GGUF as an Ollama model and runs the patched eval
// harness (ollama leg only) against it, plus the currently-deployed baseline.
//   node training/gcp/evaluate-candidates.mjs [--skip-baseline]
// Emits training/gcp/artifacts/eval-results.json + a console leaderboard.
// Selection rule (applied by the orchestrator): highest score among
// non-baseline rows; tie -> smaller model.
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RESULTS_DIR = join(REPO, 'training', 'eval', 'results');
const skipBaseline = process.argv.includes('--skip-baseline');
const metrics = JSON.parse(readFileSync(join(HERE, 'artifacts', 'metrics-all.json'), 'utf8'));

function makeModel(runId, baseModel) {
  let gguf = join(HERE, 'artifacts', runId, 'model-q4_k_m.gguf');
  if (!existsSync(gguf)) {
    // f16 fallback from a job whose on-VM quantize failed — quantize locally
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
    // exit 1 = gate fail; run-eval still wrote the results file, so continue.
    // Anything else (exit 2, signal kill -> status null, internal fatal) means
    // NO fresh results file exists — swallowing it would silently attribute
    // the previous candidate's file to this one (review finding).
    if (e.status === 1) return;
    const hint = e.status === 2 ? ' (Ollama unreachable or eval could not start?)' : '';
    throw new Error(`eval aborted for ${model}: status=${e.status} signal=${e.signal}${hint}`);
  }
}

function latestResult() {
  const files = readdirSync(RESULTS_DIR).filter((x) => x.endsWith('.json'))
    .map((x) => ({ x, t: statSync(join(RESULTS_DIR, x)).mtimeMs }))
    .sort((a, b) => a.t - b.t);
  if (!files.length) throw new Error(`no eval results in ${RESULTS_DIR} — did run-eval crash before writing?`);
  const f = files.at(-1);
  const j = JSON.parse(readFileSync(join(RESULTS_DIR, f.x), 'utf8'));
  return { ollama: j.ollama_totals, model: j.ollama_model, file: f.x };
}

function timedProbe(model) {
  const t0 = Date.now();
  try {
    execFileSync('curl', ['-s', '--max-time', '90', 'http://127.0.0.1:11434/api/chat', '-d', JSON.stringify({
      model, stream: false, think: false,
      messages: [
        { role: 'system', content: 'You are a test. Reply with one short sentence.' },
        { role: 'user', content: 'Say OK.' },
      ],
      options: { temperature: 0.2, num_predict: 32 },
    })], { encoding: 'utf8' });
    return Date.now() - t0;
  } catch {
    return null;
  }
}

const rows = [];
for (const m of metrics.slice(0, 4)) {
  const model = makeModel(m.run_id, m.base_model);
  if (!model) { console.error(`no GGUF for ${m.run_id}, skipping`); continue; }
  console.log(`\n=== evaluating ${model} ===`);
  const probeMs = timedProbe(model); // also warms the model
  try {
    runEval(model);
    const t = latestResult();
    if (t.model !== model) {
      throw new Error(`results file is for ${t.model}, expected ${model} — stale result, not attributing`);
    }
    rows.push({ runId: m.run_id, base: m.base_model, valLoss: m.val_loss, probeMs, ...t.ollama, baseline: false });
  } catch (e) {
    console.error(`  SKIPPING ${m.run_id}: ${e.message}`);
    rows.push({ runId: m.run_id, base: m.base_model, valLoss: m.val_loss, probeMs, error: String(e.message), score: null, baseline: false });
  }
}

if (!skipBaseline) {
  console.log('\n=== evaluating deployed baseline (lari-the-kitchen-assistant) ===');
  const probeMs = timedProbe('lari-the-kitchen-assistant');
  runEval('lari-the-kitchen-assistant');
  const bt = latestResult();
  if (bt.model !== 'lari-the-kitchen-assistant') {
    throw new Error(`baseline results file is for ${bt.model} — stale result`);
  }
  rows.push({ runId: 'deployed-baseline', base: 'lari-the-kitchen-assistant (deepseek-r1:14b)', valLoss: null, probeMs, ...bt.ollama, baseline: true });
}

rows.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
writeFileSync(join(HERE, 'artifacts', 'eval-results.json'), JSON.stringify(rows, null, 2));
console.log('\nLEADERBOARD (ollama leg, score = pass + 0.5*partial):');
console.table(rows.map(({ runId, base, valLoss, pass, partial, fail, error, score, probeMs }) =>
  ({ runId, base: base.slice(0, 40), valLoss, pass, partial, fail, error, score, probeMs })));
