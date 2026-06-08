#!/usr/bin/env node
// Local iPad-profile tap latency probe for cook-tier Lariat surfaces.

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { chromium, devices, webkit } from '@playwright/test';

export const SCHEMA_VERSION = 'lariat.ipadPerformanceProfile.v1';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_BROWSER = 'webkit';
const DEFAULT_DEVICE = 'iPad (gen 7)';
const DEFAULT_ITERATIONS = 5;
const DEFAULT_THRESHOLD_MS = 100;
const DEFAULT_LOCATION_ID = 'perf-ipad';
const DEFAULT_COOK_ID = 'perf-ipad-cook';

const FLOW_IDS = new Set(['station-pass', 'kds-send', 'eighty-six-add']);

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    baseUrl: DEFAULT_BASE_URL,
    browserName: DEFAULT_BROWSER,
    cookId: DEFAULT_COOK_ID,
    cpuSlowdown: 1,
    deviceName: DEFAULT_DEVICE,
    flowIds: [...FLOW_IDS],
    hardwareRequired: true,
    headed: false,
    iterations: DEFAULT_ITERATIONS,
    locationId: DEFAULT_LOCATION_ID,
    outPath: '',
    thresholdMs: DEFAULT_THRESHOLD_MS,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--base-url') {
      i += 1;
      opts.baseUrl = requireValue(argv[i], '--base-url');
    } else if (arg.startsWith('--base-url=')) {
      opts.baseUrl = requireValue(arg.slice('--base-url='.length), '--base-url');
    } else if (arg === '--browser') {
      i += 1;
      opts.browserName = requireValue(argv[i], '--browser');
    } else if (arg.startsWith('--browser=')) {
      opts.browserName = requireValue(arg.slice('--browser='.length), '--browser');
    } else if (arg === '--device') {
      i += 1;
      opts.deviceName = requireValue(argv[i], '--device');
    } else if (arg.startsWith('--device=')) {
      opts.deviceName = requireValue(arg.slice('--device='.length), '--device');
    } else if (arg === '--iterations') {
      i += 1;
      opts.iterations = parsePositiveInt(requireValue(argv[i], '--iterations'), '--iterations');
    } else if (arg.startsWith('--iterations=')) {
      opts.iterations = parsePositiveInt(arg.slice('--iterations='.length), '--iterations');
    } else if (arg === '--threshold-ms') {
      i += 1;
      opts.thresholdMs = parsePositiveNumber(requireValue(argv[i], '--threshold-ms'), '--threshold-ms');
    } else if (arg.startsWith('--threshold-ms=')) {
      opts.thresholdMs = parsePositiveNumber(arg.slice('--threshold-ms='.length), '--threshold-ms');
    } else if (arg === '--location') {
      i += 1;
      opts.locationId = requireValue(argv[i], '--location');
    } else if (arg.startsWith('--location=')) {
      opts.locationId = requireValue(arg.slice('--location='.length), '--location');
    } else if (arg === '--cook') {
      i += 1;
      opts.cookId = requireValue(argv[i], '--cook');
    } else if (arg.startsWith('--cook=')) {
      opts.cookId = requireValue(arg.slice('--cook='.length), '--cook');
    } else if (arg === '--flow') {
      i += 1;
      opts.flowIds = parseFlows(requireValue(argv[i], '--flow'));
    } else if (arg.startsWith('--flow=')) {
      opts.flowIds = parseFlows(arg.slice('--flow='.length));
    } else if (arg === '--cpu-slowdown') {
      i += 1;
      opts.cpuSlowdown = parsePositiveNumber(requireValue(argv[i], '--cpu-slowdown'), '--cpu-slowdown');
    } else if (arg.startsWith('--cpu-slowdown=')) {
      opts.cpuSlowdown = parsePositiveNumber(arg.slice('--cpu-slowdown='.length), '--cpu-slowdown');
    } else if (arg === '--out') {
      i += 1;
      opts.outPath = requireValue(argv[i], '--out');
    } else if (arg.startsWith('--out=')) {
      opts.outPath = requireValue(arg.slice('--out='.length), '--out');
    } else if (arg === '--headed') {
      opts.headed = true;
    } else if (arg === '--json') {
      // JSON is the only output mode; accepted for explicit scripts.
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!['chromium', 'webkit'].includes(opts.browserName)) {
    throw new Error('--browser must be chromium or webkit');
  }
  if (!devices[opts.deviceName]) {
    throw new Error(`Unknown Playwright device: ${opts.deviceName}`);
  }

  opts.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  if (opts.outPath) opts.outPath = validateRelativeOutPath(opts.outPath);
  return opts;
}

function requireValue(value, flag) {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function parseFlows(value) {
  const flows = value.split(',').map((flow) => flow.trim()).filter(Boolean);
  if (flows.length === 0) throw new Error('--flow requires at least one flow id');
  for (const flow of flows) {
    if (!FLOW_IDS.has(flow)) {
      throw new Error(`Unknown flow: ${flow}`);
    }
  }
  return flows;
}

function validateRelativeOutPath(outPath) {
  if (path.isAbsolute(outPath)) {
    throw new Error('--out must be relative to the current working directory');
  }
  const normalized = path.normalize(outPath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('--out must stay within the current working directory');
  }
  return normalized;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

export function summarizeSamples(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length === 0) {
    return { count: 0, minMs: 0, medianMs: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const medianIndex = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    minMs: roundMs(sorted[0]),
    medianMs: roundMs(sorted[medianIndex]),
    avgMs: roundMs(sorted.reduce((total, sample) => total + sample, 0) / sorted.length),
    p95Ms: roundMs(sorted[p95Index]),
    maxMs: roundMs(sorted[sorted.length - 1]),
  };
}

export function eightySixSubmitAccessibleName(item) {
  return `Mark ${item.trim() || 'item'} as 86'd`;
}

export function buildReport({
  baseUrl,
  browserName,
  deviceName,
  iterations,
  thresholdMs,
  hardwareRequired,
  measurements,
}) {
  const flows = measurements.map((measurement) => {
    const summary = summarizeSamples(measurement.samplesMs);
    return {
      id: measurement.id,
      label: measurement.label,
      samplesMs: measurement.samplesMs.map(roundMs),
      summary,
      thresholdMs,
      withinThreshold: summary.p95Ms <= thresholdMs,
    };
  });
  const passingFlows = flows.filter((flow) => flow.withinThreshold).length;
  const failingFlows = flows.length - passingFlows;
  return {
    schemaVersion: SCHEMA_VERSION,
    target: {
      baseUrl,
      browserName,
      deviceName,
      hardwareRequired,
      iterations,
      thresholdMs,
    },
    summary: {
      flowCount: flows.length,
      passingFlows,
      failingFlows,
      hardwareAcceptanceSatisfied: hardwareRequired ? false : failingFlows === 0,
    },
    flows,
  };
}

function browserType(browserName) {
  return browserName === 'webkit' ? webkit : chromium;
}

async function newPage(context, opts) {
  const page = await context.newPage();
  await page.addInitScript((cookId) => {
    window.localStorage.setItem('lariat_cook', cookId);
  }, opts.cookId);
  return page;
}

async function maybeSetCpuSlowdown(context, page, opts) {
  if (opts.browserName !== 'chromium' || opts.cpuSlowdown === 1) return;
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuSlowdown });
}

async function timeInteraction(action) {
  const started = performance.now();
  await action();
  return performance.now() - started;
}

async function stationPassSample(context, opts, iteration) {
  const page = await newPage(context, opts);
  await maybeSetCpuSlowdown(context, page, opts);
  await page.goto(`${opts.baseUrl}/stations/grill_saute?location=${encodeURIComponent(opts.locationId)}`);
  await page.waitForLoadState('networkidle');
  const passButtons = page.getByRole('button', { name: /^Pass / });
  const count = await passButtons.count();
  if (count === 0) throw new Error('No station Pass buttons found');
  const passButton = passButtons.nth(iteration % count);
  const elapsed = await timeInteraction(async () => {
    await passButton.tap();
    await passButton.waitFor({ state: 'visible' });
    await page.waitForFunction((el) => el?.getAttribute('aria-pressed') === 'true', await passButton.elementHandle());
  });
  await page.close();
  return elapsed;
}

async function kdsSendSample(context, opts, iteration) {
  const page = await newPage(context, opts);
  await maybeSetCpuSlowdown(context, page, opts);
  const orderNo = `P${Date.now()}-${iteration}`;
  await page.goto(`${opts.baseUrl}/kds/punch?location=${encodeURIComponent(opts.locationId)}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Order #').fill(orderNo);
  await page.getByLabel('Item').first().fill(`Perf burger ${iteration}`);
  const sendButton = page.getByRole('button', { name: 'Send to line' });
  const elapsed = await timeInteraction(async () => {
    await sendButton.tap();
    await page.getByText(`Sent #${orderNo} to the line`).waitFor({ state: 'visible' });
  });
  await page.close();
  return elapsed;
}

async function eightySixAddSample(context, opts, iteration) {
  const page = await newPage(context, opts);
  await maybeSetCpuSlowdown(context, page, opts);
  const item = `Perf 86 ${Date.now()}-${iteration}`;
  await page.goto(`${opts.baseUrl}/eighty-six?location=${encodeURIComponent(opts.locationId)}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Item').fill(item);
  const addButton = page.getByRole('button', { name: eightySixSubmitAccessibleName(item) });
  const elapsed = await timeInteraction(async () => {
    await addButton.tap();
    await page.getByText(item).waitFor({ state: 'visible' });
  });
  await page.close();
  return elapsed;
}

const FLOW_RUNNERS = {
  'station-pass': { label: 'Station pass tap', run: stationPassSample },
  'kds-send': { label: 'KDS send tap', run: kdsSendSample },
  'eighty-six-add': { label: '86 add tap', run: eightySixAddSample },
};

export async function runProfile(opts) {
  const browser = await browserType(opts.browserName).launch({ headless: !opts.headed });
  try {
    const context = await browser.newContext({
      ...devices[opts.deviceName],
      baseURL: opts.baseUrl,
    });
    const measurements = [];
    for (const flowId of opts.flowIds) {
      const flow = FLOW_RUNNERS[flowId];
      const samplesMs = [];
      for (let i = 0; i < opts.iterations; i += 1) {
        samplesMs.push(await flow.run(context, opts, i));
      }
      measurements.push({ id: flowId, label: flow.label, samplesMs });
    }
    await context.close();
    return buildReport({ ...opts, measurements });
  } finally {
    await browser.close();
  }
}

export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/profile-ipad-cook-surfaces.mjs [options]

Profiles cook-tier tap-to-feedback latency against a running Lariat app.

Options:
  --base-url <url>       App URL. Default: ${DEFAULT_BASE_URL}
  --browser <name>       webkit or chromium. Default: ${DEFAULT_BROWSER}
  --device <name>        Playwright device. Default: ${DEFAULT_DEVICE}
  --iterations <n>       Samples per flow. Default: ${DEFAULT_ITERATIONS}
  --threshold-ms <n>     P95 threshold. Default: ${DEFAULT_THRESHOLD_MS}
  --flow <ids>           Comma list: ${[...FLOW_IDS].join(', ')}
  --location <id>        Test location id. Default: ${DEFAULT_LOCATION_ID}
  --cook <id>            Cook id stored in localStorage. Default: ${DEFAULT_COOK_ID}
  --cpu-slowdown <n>     Chromium-only CDP throttling. Default: 1
  --out <path>           Optional JSON output path, e.g. output/playwright/ipad-profile.json
  --headed               Show the browser.
`);
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }
  const report = await runProfile(opts);
  const json = renderJson(report);
  process.stdout.write(json);
  if (opts.outPath) {
    const outPath = path.resolve(opts.outPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, json);
  }
  if (report.summary.failingFlows > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
