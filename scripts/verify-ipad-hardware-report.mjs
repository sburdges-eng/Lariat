#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_FLOWS = ['station-pass', 'kds-send', 'eighty-six-add'];
const REQUIRED_SCHEMA = 'lariat.ipadPerformanceProfile.v1';
const REQUIRED_BROWSER = 'webkit';
const REQUIRED_DEVICE = 'iPad (gen 7)';
const MIN_SAMPLES = 5;
const MAX_P95_MS = 100;

export function validateHardwareReport(report) {
  const errors = [];
  const perFlow = {};
  const target = report?.target ?? {};
  const flows = Array.isArray(report?.flows) ? report.flows : [];
  const flowMap = new Map(flows.map((flow) => [flow?.id, flow]));

  if (report?.schemaVersion !== REQUIRED_SCHEMA) {
    errors.push(`schemaVersion must be ${REQUIRED_SCHEMA}`);
  }
  if (target.browserName !== REQUIRED_BROWSER) {
    errors.push(`browserName must be ${REQUIRED_BROWSER}`);
  }
  if (target.deviceName !== REQUIRED_DEVICE) {
    errors.push(`deviceName must be ${REQUIRED_DEVICE}`);
  }
  if (target.hardwareRequired !== true) {
    errors.push('hardwareRequired must be true');
  }
  if (!Number.isFinite(target.iterations) || target.iterations < MIN_SAMPLES) {
    errors.push(`iterations must be at least ${MIN_SAMPLES}`);
  }
  if (!Number.isFinite(target.thresholdMs) || target.thresholdMs > MAX_P95_MS) {
    errors.push(`thresholdMs must be ${MAX_P95_MS} or lower`);
  }

  for (const flowId of REQUIRED_FLOWS) {
    const flow = flowMap.get(flowId);
    if (!flow) {
      errors.push(`Missing required flow: ${flowId}`);
      perFlow[flowId] = { ok: false, missing: true, count: 0, p95Ms: null, withinThreshold: false };
      continue;
    }
    const count = Number(flow?.summary?.count ?? 0);
    const p95Ms = Number(flow?.summary?.p95Ms ?? NaN);
    const withinThreshold = flow?.withinThreshold === true;
    const ok = count >= MIN_SAMPLES && Number.isFinite(p95Ms) && p95Ms <= MAX_P95_MS && withinThreshold;
    if (count < MIN_SAMPLES) {
      errors.push(`${flowId} must include at least ${MIN_SAMPLES} samples`);
    }
    if (!Number.isFinite(p95Ms) || p95Ms > MAX_P95_MS) {
      errors.push(`${flowId} must have p95Ms <= ${MAX_P95_MS}`);
    }
    if (!withinThreshold) {
      errors.push(`${flowId} must report withinThreshold = true`);
    }
    perFlow[flowId] = { ok, count, p95Ms: Number.isFinite(p95Ms) ? p95Ms : null, withinThreshold };
  }

  return { ok: errors.length === 0, errors, perFlow };
}

export function summarizeHardwareValidation(result) {
  const status = result.ok ? 'PASS' : 'FAIL';
  const lines = [`${status}: iPad Gen 7 hardware report validation`];
  for (const flowId of REQUIRED_FLOWS) {
    const flow = result.perFlow[flowId];
    if (!flow || flow.missing) {
      lines.push(`${flowId}: missing`);
      continue;
    }
    lines.push(`${flowId}: p95 ${flow.p95Ms}ms, samples ${flow.count}, ${flow.ok ? 'pass' : 'fail'}`);
  }
  if (result.errors.length) {
    lines.push('Errors:');
    for (const error of result.errors) lines.push(`- ${error}`);
  }
  return lines.join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { json: false, path: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      args.json = true;
    } else if (!args.path) {
      args.path = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.path) {
    throw new Error('Usage: node scripts/verify-ipad-hardware-report.mjs [--json] <relative-report-path>');
  }
  if (path.isAbsolute(args.path)) {
    throw new Error('Report path must be relative to the current working directory');
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const reportPath = path.resolve(process.cwd(), args.path);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const result = validateHardwareReport(report);
  const output = args.json ? JSON.stringify(result, null, 2) : summarizeHardwareValidation(result);
  process.stdout.write(`${output}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
