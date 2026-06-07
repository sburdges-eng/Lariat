#!/usr/bin/env node
// Bundle audit coverage for scripts/bundle-size-audit.mjs.
// Run: node --test tests/js/test-bundle-size-audit.mjs

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { auditBundle, renderJson, SCHEMA_VERSION } from '../../scripts/bundle-size-audit.mjs';

const TMP_DIRS = [];

afterEach(() => {
  while (TMP_DIRS.length > 0) {
    fs.rmSync(TMP_DIRS.pop(), { recursive: true, force: true });
  }
});

function makeRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-bundle-audit-'));
  TMP_DIRS.push(repoRoot);
  return repoRoot;
}

function writeFile(repoRoot, relPath, contents) {
  const fullPath = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function writeJson(repoRoot, relPath, value) {
  writeFile(repoRoot, relPath, `${JSON.stringify(value, null, 2)}\n`);
}

function gzipLength(contents) {
  return gzipSync(Buffer.from(contents), { level: 9 }).byteLength;
}

describe('bundle-size audit', () => {
  it('summarizes Next and desktop build artifacts with deterministic ordering', () => {
    const repoRoot = makeRepo();

    const appJs = 'console.log("kitchen board");\n';
    const frameworkJs = 'function prep(){return "line check";}\n';
    const css = 'body{font-family:system-ui;}\n';
    const serverPage = 'export default function Page(){return null;}\n';
    const middleware = 'export function middleware(){}\n';
    const edgeRuntime = 'globalThis.edgeRuntime=true;\n';
    const edgeInstrumentation = 'export function register(){}\n';
    const wizardJs = 'console.log("first run wizard");\n';
    const wizardCss = '.wizard{display:grid;}\n';

    writeFile(repoRoot, '.next/BUILD_ID', 'BUILD123\n');
    writeFile(repoRoot, '.next/static/chunks/app.js', appJs);
    writeFile(repoRoot, '.next/static/chunks/framework.js', frameworkJs);
    writeFile(repoRoot, '.next/static/css/app.css', css);
    writeFile(repoRoot, '.next/server/app/page.js', serverPage);
    writeFile(repoRoot, '.next/server/middleware.js', middleware);
    writeFile(repoRoot, '.next/server/edge-runtime-webpack.js', edgeRuntime);
    writeFile(repoRoot, '.next/server/edge-instrumentation.js', edgeInstrumentation);
    writeFile(repoRoot, 'desktop/dist/wizard/assets/wizard.js', wizardJs);
    writeFile(repoRoot, 'desktop/dist/wizard/assets/wizard.css', wizardCss);

    writeJson(repoRoot, '.next/app-path-routes-manifest.json', {
      '/api/health/route': '/api/health',
      '/favicon.ico/route': '/favicon.ico',
      '/install/page': '/install',
      '/recipes/[slug]/page': '/recipes/[slug]',
    });
    writeJson(repoRoot, '.next/prerender-manifest.json', {
      routes: {
        '/install': {},
      },
    });
    writeJson(repoRoot, '.next/server/middleware-manifest.json', {
      middleware: {
        '/': {
          files: [
            'server/edge-instrumentation.js',
            'server/edge-runtime-webpack.js',
            'server/middleware.js',
          ],
        },
      },
    });

    const report = auditBundle({ repoRoot, topLimit: 3 });
    const json = renderJson(report);

    assert.equal(Object.keys(report)[0], 'schemaVersion');
    assert.equal(report.schemaVersion, SCHEMA_VERSION);
    assert.equal(report.next.buildId, 'BUILD123');
    assert.deepEqual(report.next.routes, {
      total: 4,
      appPages: 2,
      apiRoutes: 1,
      dynamicRoutes: 1,
      prerenderedRoutes: 1,
    });
    assert.deepEqual(report.next.static.js, {
      files: 2,
      bytes: Buffer.byteLength(appJs) + Buffer.byteLength(frameworkJs),
      gzipBytes: gzipLength(appJs) + gzipLength(frameworkJs),
    });
    assert.deepEqual(report.next.static.css, {
      files: 1,
      bytes: Buffer.byteLength(css),
      gzipBytes: gzipLength(css),
    });
    assert.deepEqual(report.next.server.edgeRuntime, {
      files: 3,
      bytes: Buffer.byteLength(edgeInstrumentation) + Buffer.byteLength(edgeRuntime) + Buffer.byteLength(middleware),
      gzipBytes: gzipLength(edgeInstrumentation) + gzipLength(edgeRuntime) + gzipLength(middleware),
    });
    assert.equal(report.desktop.wizardPresent, true);
    assert.deepEqual(report.desktop.wizard.js, {
      files: 1,
      bytes: Buffer.byteLength(wizardJs),
      gzipBytes: gzipLength(wizardJs),
    });
    assert.equal(report.next.largestAssets.length, 3);
    assert.equal(json.startsWith(`{\n  "schemaVersion": "${SCHEMA_VERSION}"`), true);
    assert.equal(json.includes(repoRoot), false, 'audit JSON must not leak absolute paths');
  });

  it('reports absent desktop wizard artifacts without failing Next-only builds', () => {
    const repoRoot = makeRepo();
    writeFile(repoRoot, '.next/BUILD_ID', 'BUILD456\n');
    writeFile(repoRoot, '.next/static/chunks/app.js', 'console.log("today");\n');
    writeJson(repoRoot, '.next/app-path-routes-manifest.json', {});
    writeJson(repoRoot, '.next/prerender-manifest.json', {});
    writeJson(repoRoot, '.next/server/middleware-manifest.json', {});

    const report = auditBundle({ repoRoot });

    assert.equal(report.desktop.wizardPresent, false);
    assert.deepEqual(report.desktop.wizard.total, { files: 0, bytes: 0, gzipBytes: 0 });
  });

  it('fails closed when production build artifacts are missing', () => {
    const repoRoot = makeRepo();

    assert.throws(
      () => auditBundle({ repoRoot }),
      /Missing \.next\/BUILD_ID\. Run `npm run build` before `npm run bundle:audit`\./,
    );
  });
});
