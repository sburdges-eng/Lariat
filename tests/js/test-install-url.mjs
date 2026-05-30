#!/usr/bin/env node
// Install page helpers: packaged desktop should not show PWA install copy,
// and loopback URLs must not be offered to other devices.
//
// Run: node --test tests/js/test-install-url.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const installUrl = await import('../../app/install/installUrl.js');
const installPageSource = fs.readFileSync(
  new URL('../../app/install/page.jsx', import.meta.url),
  'utf8',
);

describe('install URL helpers', () => {
  it('detects packaged desktop user agents', () => {
    assert.equal(installUrl.isDesktopUserAgent('Mozilla/5.0 Electron/42.1.0'), true);
    assert.equal(installUrl.isDesktopUserAgent('Mozilla/5.0 Chrome/142.0.0.0'), false);
  });

  it('does not advertise loopback addresses to other devices', () => {
    const url = installUrl.lanInstallUrl({
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '3001',
    });
    assert.equal(url, 'http://lariat.local:3001');
  });

  it('keeps real LAN hostnames and ports', () => {
    const url = installUrl.lanInstallUrl({
      protocol: 'http:',
      hostname: '192.168.1.42',
      port: '3001',
    });
    assert.equal(url, 'http://192.168.1.42:3001');
  });

  it('uses neutral route copy so the desktop app is not a PWA install prompt', () => {
    assert.match(installPageSource, /<h1>Connect Lariat<\/h1>/);
    assert.doesNotMatch(installPageSource, /Put Lariat on this Mac or iPad/);
  });
});
