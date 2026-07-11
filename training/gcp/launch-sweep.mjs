// Launches the Vertex sweep (or --smoke) and records artifacts/launched.json.
//   node training/gcp/launch-sweep.mjs [--smoke] [--spent=<usd>]
// Stages train.py + requirements.txt to gs://<bucket>/code/ first, then
// creates one custom job per matrix cell (pruned to the $ budget), with
// region fallback on quota/stockout errors.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandMatrix, projectCost, pruneToBudget, jobYaml, gcloudArgs } from './sweep-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, 'sweep-config.json'), 'utf8'));
const smoke = process.argv.includes('--smoke');
const spent = parseFloat((process.argv.find((a) => a.startsWith('--spent=')) || '--spent=0').split('=')[1]);
const hfToken = process.env.HF_TOKEN || '';

const ARTIFACTS = join(HERE, 'artifacts');
mkdirSync(ARTIFACTS, { recursive: true });

// stage code
for (const f of ['train.py', 'requirements.txt']) {
  execFileSync('gcloud', ['storage', 'cp', join(HERE, f), `gs://${config.bucket}/code/${f}`], { stdio: 'inherit' });
}

let jobs;
if (smoke) {
  const b = config.bases.find((x) => x.id === config.smoke.base);
  jobs = [{
    runId: 'smoke-0', base: b.id, chatTemplate: b.chatTemplate,
    machineType: b.machineType, acceleratorType: b.acceleratorType, acceleratorCount: b.acceleratorCount,
    region: config.regions[0], loraR: 16, lr: 0.0002, epochs: config.smoke.epochs,
    estHours: config.smoke.estHours, estCost: +(config.smoke.estHours * config.rates[b.machineType]).toFixed(2),
    subset: config.smoke.subset, timeoutHours: 3,
  }];
} else {
  jobs = pruneToBudget(expandMatrix(config, { hfToken }), config.budgetUsd, spent, config.rates);
}
console.log(`launching ${jobs.length} job(s); projected $${projectCost(jobs, config.rates).toFixed(2)} on top of $${spent} spent`);

const launched = [];
for (const job of jobs) {
  let ok = false;
  for (const region of config.regions) {
    const j = { ...job, region };
    const specPath = join(ARTIFACTS, `${job.runId}.spec.yaml`);
    writeFileSync(specPath, jobYaml(j, config, { hfToken }));
    try {
      const out = execFileSync('gcloud', gcloudArgs(j, config, specPath), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const meta = JSON.parse(out);
      launched.push({
        runId: job.runId, jobName: meta.name, region, machineType: job.machineType,
        state: 'LAUNCHED', estCost: job.estCost,
      });
      console.log(`  ${job.runId} -> ${meta.name} (${region})`);
      ok = true;
      break;
    } catch (e) {
      const msg = String(e.stderr || e.message).slice(0, 300).replace(/\n/g, ' ');
      console.error(`  ${job.runId} failed in ${region}: ${msg}`);
    }
  }
  if (!ok) launched.push({ runId: job.runId, jobName: null, region: null, machineType: job.machineType, state: 'LAUNCH_FAILED', estCost: 0 });
}

writeFileSync(join(ARTIFACTS, 'launched.json'), JSON.stringify({ launched }, null, 2));
const failed = launched.filter((l) => l.state === 'LAUNCH_FAILED');
console.log(`launched ${launched.length - failed.length}/${launched.length}; state in training/gcp/artifacts/launched.json`);
process.exit(failed.length === launched.length ? 1 : 0);
