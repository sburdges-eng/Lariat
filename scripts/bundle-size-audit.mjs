#!/usr/bin/env node
// Deterministic bundle-size audit for the Next/Electron production build.

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 'lariat.bundleAudit.v1';

const DEFAULT_TOP_LIMIT = 10;
const NEXT_STATIC_DIR = '.next/static';
const NEXT_SERVER_DIR = '.next/server';
const DESKTOP_WIZARD_DIR = 'desktop/dist/wizard';

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function parseArgs(argv = process.argv.slice(2)) {
  const opts = {
    repoRoot: defaultRepoRoot(),
    topLimit: DEFAULT_TOP_LIMIT,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--root') {
      i += 1;
      if (!argv[i]) throw new Error('--root requires a path');
      opts.repoRoot = path.resolve(argv[i]);
    } else if (arg.startsWith('--root=')) {
      opts.repoRoot = path.resolve(arg.slice('--root='.length));
    } else if (arg === '--top') {
      i += 1;
      if (!argv[i]) throw new Error('--top requires a number');
      opts.topLimit = parsePositiveInt(argv[i], '--top');
    } else if (arg.startsWith('--top=')) {
      opts.topLimit = parsePositiveInt(arg.slice('--top='.length), '--top');
    } else if (arg === '--json') {
      // JSON is the only output mode; the flag is accepted for explicit CI use.
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function readJson(repoRoot, relPath, fallback = null) {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) return fallback;
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function readText(repoRoot, relPath, fallback = '') {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) return fallback;
  return fs.readFileSync(fullPath, 'utf8').trim();
}

function listFiles(repoRoot, relDir) {
  const root = path.join(repoRoot, relDir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(toRepoPath(repoRoot, fullPath));
      }
    }
  }
  return out.sort();
}

function toRepoPath(repoRoot, fullPath) {
  return path.relative(repoRoot, fullPath).split(path.sep).join('/');
}

function gzipBytes(buffer) {
  return gzipSync(buffer, { level: 9 }).byteLength;
}

function fileMeasure(repoRoot, relPath) {
  const bytes = fs.readFileSync(path.join(repoRoot, relPath));
  return {
    path: relPath,
    bytes: bytes.byteLength,
    gzipBytes: gzipBytes(bytes),
  };
}

function summarizeMeasuredFiles(files) {
  return {
    files: files.length,
    bytes: sum(files, 'bytes'),
    gzipBytes: sum(files, 'gzipBytes'),
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function extname(relPath) {
  return path.extname(relPath).toLowerCase();
}

function topFiles(files, limit) {
  return [...files]
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map((file) => ({
      path: file.path,
      bytes: file.bytes,
      gzipBytes: file.gzipBytes,
    }));
}

function countRoutes(repoRoot) {
  const routeManifest = readJson(repoRoot, '.next/app-path-routes-manifest.json', {});
  const routes = Object.values(routeManifest).filter((route) => typeof route === 'string');
  const uniqueRoutes = [...new Set(routes)].sort();
  const prerenderManifest = readJson(repoRoot, '.next/prerender-manifest.json', {});
  const prerenderedRoutes = Object.keys(prerenderManifest.routes || {}).sort();

  return {
    total: uniqueRoutes.length,
    appPages: uniqueRoutes.filter((route) => !route.startsWith('/api/') && route !== '/favicon.ico').length,
    apiRoutes: uniqueRoutes.filter((route) => route.startsWith('/api/')).length,
    dynamicRoutes: uniqueRoutes.filter((route) => route.includes('[') || route.includes(']')).length,
    prerenderedRoutes: prerenderedRoutes.length,
  };
}

function edgeRuntimeFiles(repoRoot) {
  const middlewareManifest = readJson(repoRoot, '.next/server/middleware-manifest.json', {});
  const files = new Set();
  for (const middleware of Object.values(middlewareManifest.middleware || {})) {
    for (const relPath of middleware.files || []) {
      files.add(`.next/${relPath}`);
    }
  }
  return [...files].filter((relPath) => fs.existsSync(path.join(repoRoot, relPath))).sort();
}

function summarizeNext(repoRoot, topLimit) {
  const buildId = readText(repoRoot, '.next/BUILD_ID');
  if (!buildId) {
    throw new Error('Missing .next/BUILD_ID. Run `npm run build` before `npm run bundle:audit`.');
  }

  const staticFiles = listFiles(repoRoot, NEXT_STATIC_DIR);
  const serverFiles = listFiles(repoRoot, NEXT_SERVER_DIR).filter((relPath) => extname(relPath) !== '.map');
  const edgeFiles = edgeRuntimeFiles(repoRoot);
  const staticMeasured = staticFiles.map((relPath) => fileMeasure(repoRoot, relPath));
  const serverMeasured = serverFiles.map((relPath) => fileMeasure(repoRoot, relPath));
  const edgeMeasured = edgeFiles.map((relPath) => fileMeasure(repoRoot, relPath));

  const staticJs = staticMeasured.filter((file) => extname(file.path) === '.js');
  const staticCss = staticMeasured.filter((file) => extname(file.path) === '.css');
  const staticOther = staticMeasured.filter((file) => !['.js', '.css'].includes(extname(file.path)));
  const serverJs = serverMeasured.filter((file) => extname(file.path) === '.js');

  return {
    buildId,
    routes: countRoutes(repoRoot),
    static: {
      total: summarizeMeasuredFiles(staticMeasured),
      js: summarizeMeasuredFiles(staticJs),
      css: summarizeMeasuredFiles(staticCss),
      other: summarizeMeasuredFiles(staticOther),
    },
    server: {
      total: summarizeMeasuredFiles(serverMeasured),
      js: summarizeMeasuredFiles(serverJs),
      edgeRuntime: summarizeMeasuredFiles(edgeMeasured),
    },
    largestAssets: topFiles([...staticMeasured, ...serverMeasured], topLimit),
  };
}

function summarizeDesktop(repoRoot, topLimit) {
  const wizardFiles = listFiles(repoRoot, DESKTOP_WIZARD_DIR);
  if (wizardFiles.length === 0) {
    return {
      wizardPresent: false,
      wizard: {
        total: { files: 0, bytes: 0, gzipBytes: 0 },
        js: { files: 0, bytes: 0, gzipBytes: 0 },
        css: { files: 0, bytes: 0, gzipBytes: 0 },
        largestAssets: [],
      },
    };
  }

  const measured = wizardFiles.map((relPath) => fileMeasure(repoRoot, relPath));
  const js = measured.filter((file) => extname(file.path) === '.js');
  const css = measured.filter((file) => extname(file.path) === '.css');

  return {
    wizardPresent: true,
    wizard: {
      total: summarizeMeasuredFiles(measured),
      js: summarizeMeasuredFiles(js),
      css: summarizeMeasuredFiles(css),
      largestAssets: topFiles(measured, topLimit),
    },
  };
}

export function auditBundle(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot());
  const topLimit = options.topLimit || DEFAULT_TOP_LIMIT;
  return {
    schemaVersion: SCHEMA_VERSION,
    build: {
      nextCommand: 'npm run build',
      desktopCommand: 'npm run desktop:build',
      desktopWizardPath: DESKTOP_WIZARD_DIR,
    },
    next: summarizeNext(repoRoot, topLimit),
    desktop: summarizeDesktop(repoRoot, topLimit),
  };
}

export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/bundle-size-audit.mjs [--root <repo>] [--top <n>] [--json]

Reads production build artifacts and prints deterministic bundle-size JSON.

Required first:
  npm run build

Optional desktop artifacts:
  npm run desktop:build
`);
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }
  process.stdout.write(renderJson(auditBundle(opts)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
