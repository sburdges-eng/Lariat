// Single-pass sweep monitor with cost accounting.
//   node training/gcp/monitor.mjs [--download]
// exit 0 = all jobs terminal; exit 3 = still running (caller paces polling).
// --download (only when done): pulls metrics.json for every SUCCEEDED run and
// the top-4 GGUFs by val_loss into artifacts/<runId>/.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, 'sweep-config.json'), 'utf8'));
const { launched } = JSON.parse(readFileSync(join(HERE, 'artifacts', 'launched.json'), 'utf8'));
const doDownload = process.argv.includes('--download');
const gc = (args) => execFileSync('gcloud', args, { encoding: 'utf8' });

const jobs = [];
for (const l of launched.filter((x) => x.jobName)) {
  const d = JSON.parse(gc(['ai', 'custom-jobs', 'describe', l.jobName, `--region=${l.region}`, '--format=json']));
  const start = d.startTime ? new Date(d.startTime).getTime() : null;
  const end = d.endTime ? new Date(d.endTime).getTime() : Date.now();
  const elapsedH = start ? Math.max(0, (end - start) / 3.6e6) : 0;
  const rate = config.rates[l.machineType] ?? 1.0;
  jobs.push({
    runId: l.runId, region: l.region, state: d.state,
    elapsedH: +elapsedH.toFixed(2), costUsd: +(elapsedH * rate).toFixed(2),
  });
}
const done = jobs.length > 0 && jobs.every((j) => /SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(j.state));
const totalCostUsd = +jobs.reduce((s, j) => s + j.costUsd, 0).toFixed(2);
writeFileSync(join(HERE, 'artifacts', 'status.json'), JSON.stringify({ jobs, totalCostUsd, done }, null, 2));
console.table(jobs);
console.log(`total ≈ $${totalCostUsd}, done=${done}`);

if (doDownload && done) {
  const metrics = [];
  for (const j of jobs.filter((x) => x.state === 'JOB_STATE_SUCCEEDED')) {
    try {
      const m = JSON.parse(gc(['storage', 'cat', `gs://${config.bucket}/runs/${j.runId}/metrics.json`]));
      metrics.push(m);
    } catch {
      console.error(`  no metrics.json for ${j.runId} — skipping`);
    }
  }
  metrics.sort((a, b) => (a.val_loss ?? 9e9) - (b.val_loss ?? 9e9));
  writeFileSync(join(HERE, 'artifacts', 'metrics-all.json'), JSON.stringify(metrics, null, 2));
  for (const m of metrics.slice(0, 4)) {
    const dir = join(HERE, 'artifacts', m.run_id);
    mkdirSync(dir, { recursive: true });
    const dst = join(dir, 'model-q4_k_m.gguf');
    if (!existsSync(dst)) {
      console.log(`downloading ${m.run_id} (val_loss=${m.val_loss})…`);
      gc(['storage', 'cp', `gs://${config.bucket}/runs/${m.run_id}/model-q4_k_m.gguf`, dst]);
    }
  }
  console.log(`downloaded top ${Math.min(4, metrics.length)} candidates by val_loss`);
}
process.exit(done ? 0 : 3);
