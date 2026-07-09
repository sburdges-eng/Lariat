// Pure helpers for the Vertex sweep — matrix expansion, budget math, and
// CustomJobSpec YAML rendering. Tested by tests/js/test-sweep-lib.mjs.

export function expandMatrix(config, { hfToken }) {
  const bases = config.bases.filter((b) => !b.gated || !!hfToken);
  const jobs = [];
  for (const b of bases) {
    for (const g of config.grid) {
      const estHours = b.estHoursPerEpoch * g.epochs + 0.6; // + merge/GGUF overhead
      jobs.push({
        runId: `${b.tag}-r${g.loraR}-lr${String(g.lr).replace(/[.]/g, 'p')}-e${g.epochs}`,
        base: b.id,
        chatTemplate: b.chatTemplate,
        machineType: b.machineType,
        acceleratorType: b.acceleratorType,
        acceleratorCount: b.acceleratorCount,
        region: config.regions[0],
        loraR: g.loraR,
        lr: g.lr,
        epochs: g.epochs,
        estHours,
        estCost: +(estHours * config.rates[b.machineType]).toFixed(2),
      });
    }
  }
  return jobs;
}

export const projectCost = (jobs, rates) =>
  jobs.reduce((s, j) => s + j.estHours * rates[j.machineType], 0);

export function pruneToBudget(jobs, capUsd, spentUsd, rates) {
  const kept = [];
  let acc = spentUsd;
  for (const j of jobs) {
    const c = j.estHours * rates[j.machineType];
    if (acc + c <= capUsd) { kept.push(j); acc += c; }
  }
  return kept;
}

// Entry command run inside the prebuilt PyTorch container: fetch code from
// GCS (google-cloud-storage ships in the prebuilt image), install pinned
// deps, run the training script.
export function entryCommand(job, config) {
  const fetch = `python -c "from google.cloud import storage; b = storage.Client().bucket('${config.bucket}'); ` +
    `[b.blob('code/' + f).download_to_filename('/tmp/' + f) for f in ['train.py', 'requirements.txt']]"`;
  const train = `python /tmp/train.py --base ${job.base} --chat-template ${job.chatTemplate}` +
    ` --run-id ${job.runId} --bucket ${config.bucket} --lora-r ${job.loraR} --lr ${job.lr}` +
    ` --epochs ${job.epochs} --max-seq ${config.maxSeq}` +
    (job.subset ? ` --subset ${job.subset}` : '');
  return `set -e; ${fetch}; pip install -q -r /tmp/requirements.txt; ${train}`;
}

// Full CustomJobSpec YAML (https://cloud.google.com/vertex-ai/docs/reference/rest/v1/CustomJobSpec)
export function jobYaml(job, config, { hfToken = '' } = {}) {
  const env = hfToken
    ? `      env:
        - name: HF_TOKEN
          value: "${hfToken}"
`
    : '';
  // YAML double-quoted scalar: escape backslashes and double quotes
  const cmd = entryCommand(job, config).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `workerPoolSpecs:
  - machineSpec:
      machineType: ${job.machineType}
      acceleratorType: ${job.acceleratorType}
      acceleratorCount: ${job.acceleratorCount}
    replicaCount: 1
    diskSpec:
      bootDiskType: pd-ssd
      bootDiskSizeGb: ${config.bootDiskGb}
    containerSpec:
      imageUri: ${config.containerUri}
      command:
        - /bin/bash
        - -c
      args:
        - "${cmd}"
${env}scheduling:
  timeout: ${Math.round((job.timeoutHours ?? config.jobTimeoutHours) * 3600)}s
`;
}

export function gcloudArgs(job, config, configPath) {
  return [
    'ai', 'custom-jobs', 'create',
    `--project=${config.project}`,
    `--region=${job.region}`,
    `--display-name=lariat-ka-v2-${job.runId}`,
    `--config=${configPath}`,
    '--format=json',
  ];
}
