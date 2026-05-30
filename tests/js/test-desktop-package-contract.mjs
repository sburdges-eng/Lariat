#!/usr/bin/env node
// Desktop package contract: the shipped app must be fresh, leaner, and signed
// before dmg/zip targets are made.
//
// Run: node --test tests/js/test-desktop-package-contract.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const builder = fs.readFileSync('electron-builder.yml', 'utf8');
const script = fs.readFileSync('scripts/package-desktop.mjs', 'utf8');

describe('desktop packaging contract', () => {
  it('stamps version.json before desktop builds', () => {
    assert.match(pkg.scripts['desktop:build'], /npm run version:stamp/);
  });

  it('ships the repo build stamp and excludes dev-only public/build files', () => {
    for (const rule of [
      'version.json',
      '!.next/**/*.map',
      '!public/design-atlas/**',
      '!**/.DS_Store',
    ]) {
      assert.ok(builder.includes(rule), `electron-builder.yml missing ${rule}`);
    }
  });

  it('does not package common dev dependency trees', () => {
    for (const rule of [
      '!node_modules/electron/**',
      '!node_modules/electron-builder/**',
      '!node_modules/@playwright/**',
      '!node_modules/@huggingface/**',
      '!node_modules/typescript/**',
      '!node_modules/jest/**',
      '!node_modules/@types/**',
      '!node_modules/onnxruntime-node/**',
      '!node_modules/onnxruntime-web/**',
    ]) {
      assert.ok(builder.includes(rule), `electron-builder.yml missing ${rule}`);
    }
  });

  it('ad-hoc signs before mac targets and audits the final bundle', () => {
    assert.match(builder, /afterPack:\s*desktop\/after-pack-ad-hoc\.cjs/);
    assert.match(script, /assertFreshArtifacts/);
    assert.match(script, /assertNoPackagedPath/);
    assert.match(script, /codesign/);
  });

  it('restores host Node native modules after Electron packaging', () => {
    assert.match(script, /restoreHostNativeDeps/);
    assert.match(script, /rebuild['"],\s*['"]better-sqlite3/);
  });
});
