import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandMatrix, projectCost, pruneToBudget, jobYaml, gcloudArgs, entryCommand } from '../../training/gcp/sweep-lib.mjs';

const config = JSON.parse(readFileSync('training/gcp/sweep-config.json', 'utf8'));

test('matrix expands bases x grid, skips gated bases without HF_TOKEN', () => {
  const gated = config.bases.filter((b) => b.gated).length;
  const ungated = config.bases.length - gated;
  const jobs = expandMatrix(config, { hfToken: '' });
  assert.equal(jobs.length, ungated * config.grid.length);
  assert.ok(jobs.every((j) => !j.base.startsWith('meta-llama')));
  const withTok = expandMatrix(config, { hfToken: 'hf_x' });
  assert.equal(withTok.length, config.bases.length * config.grid.length);
});

test('run ids are unique and shell-safe', () => {
  const jobs = expandMatrix(config, { hfToken: 'hf_x' });
  const ids = new Set(jobs.map((j) => j.runId));
  assert.equal(ids.size, jobs.length);
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test('cost projection = hours * rate summed', () => {
  const jobs = [{ estHours: 2, machineType: 'a2-highgpu-1g' }, { estHours: 1, machineType: 'a2-highgpu-1g' }];
  assert.equal(projectCost(jobs, config.rates), 3 * config.rates['a2-highgpu-1g']);
});

test('pruneToBudget drops tail jobs until projection fits', () => {
  // 10h a2 spot jobs at $1.7/hr = $17 each
  const jobs = Array.from({ length: 9 }, (_, i) => ({ runId: `j${i}`, estHours: 10, machineType: 'a2-highgpu-1g' }));
  const kept = pruneToBudget(jobs, 100, 0, config.rates);
  assert.equal(kept.length, 5); // 5 * 17 = 85 <= 100; 6 would be 102
  const withSpent = pruneToBudget(jobs, 100, 60, config.rates);
  assert.equal(withSpent.length, 2); // 60 + 2*17 = 94 <= 100; 3rd -> 111
});

test('jobYaml carries machine, accelerator, image, timeout, and the entry command', () => {
  const [job] = expandMatrix(config, { hfToken: '' });
  const yaml = jobYaml(job, config);
  assert.match(yaml, new RegExp(`machineType: ${job.machineType}`));
  assert.match(yaml, new RegExp(`acceleratorType: ${job.acceleratorType}`));
  assert.match(yaml, /imageUri: us-docker\.pkg\.dev\/vertex-ai\/training\/pytorch-gpu/);
  assert.match(yaml, /timeout: \d+s/);
  assert.match(yaml, /train\.py/);
  assert.match(yaml, new RegExp(`--run-id ${job.runId}`));
});

test('jobYaml embeds HF_TOKEN env only when provided', () => {
  const [job] = expandMatrix(config, { hfToken: 'hf_secret' });
  assert.match(jobYaml(job, config, { hfToken: 'hf_secret' }), /HF_TOKEN/);
  assert.ok(!jobYaml(job, config, { hfToken: '' }).includes('HF_TOKEN'));
});

test('entryCommand pulls code from GCS, installs deps, runs train.py with job params', () => {
  const [job] = expandMatrix(config, { hfToken: '' });
  const cmd = entryCommand(job, config);
  assert.match(cmd, /blob\('code\/' \+ f\)/);
  assert.match(cmd, /'train\.py'/);
  assert.match(cmd, /requirements\.txt/);
  assert.match(cmd, new RegExp(`--base ${job.base.replace(/[/]/g, '.')}`));
  assert.match(cmd, new RegExp(`--lora-r ${job.loraR}`));
});

test('gcloudArgs uses --config and the job region', () => {
  const [job] = expandMatrix(config, { hfToken: '' });
  const args = gcloudArgs(job, config, '/tmp/spec.yaml');
  assert.equal(args[0], 'ai');
  assert.ok(args.includes('custom-jobs') && args.includes('create'));
  assert.ok(args.includes(`--region=${job.region}`));
  assert.ok(args.includes('--config=/tmp/spec.yaml'));
  assert.ok(args.some((s) => s.startsWith('--display-name=lariat-ka-v2-')));
});
