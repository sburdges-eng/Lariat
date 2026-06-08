#!/usr/bin/env node
// Tests for the dev-mode LaRi code_search tool.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-dev-code-search.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const tool = await import('../../lib/devCodeSearch.ts');

function fakeSpawn({ stdout = '', stderr = '', status = 0, error = null } = {}, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { stdout, stderr, status, error };
  };
}

describe('runDevCodeSearch safety boundaries', () => {
  it('requires both the dev env flag and a manager PIN before invoking ripgrep', () => {
    const calls = [];
    const spawnSyncImpl = fakeSpawn({ stdout: 'lib/ollama.ts:1:ollamaChat\n' }, calls);
    const repoRoot = path.join(os.tmpdir(), 'lariat-code-search-test');

    const disabled = tool.runDevCodeSearch({
      query: 'ollamaChat',
      hasPin: true,
      repoRoot,
      env: {},
      spawnSyncImpl,
    });
    assert.equal(disabled.ok, false);
    assert.equal(disabled.code, 'disabled');

    const blocked = tool.runDevCodeSearch({
      query: 'ollamaChat',
      hasPin: false,
      repoRoot,
      env: { LARIAT_DEV_CODE_SEARCH: '1' },
      spawnSyncImpl,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'tier_blocked');
    assert.equal(calls.length, 0, 'ripgrep must not run before both gates pass');
  });

  it('runs ripgrep from the repo root and returns capped relative hits only', () => {
    const calls = [];
    const repoRoot = path.join(os.tmpdir(), 'lariat-code-search-test');
    const absoluteLeak = path.join(path.sep, 'tmp', 'absolute', 'leak.js');
    const spawnSyncImpl = fakeSpawn({
      stdout: [
        'app/api/kitchen-assistant/route.js:7:  ollamaChat,',
        `${absoluteLeak}:1:ollamaChat`,
        '../escape.js:2:ollamaChat',
        'lib/ollama.ts:123:export async function ollamaChat(opts) {',
      ].join('\n') + '\n',
    }, calls);

    const result = tool.runDevCodeSearch({
      query: 'ollamaChat',
      glob: 'app/api/kitchen-assistant/**',
      limit: 1,
      hasPin: true,
      repoRoot,
      env: { LARIAT_DEV_CODE_SEARCH: 'true' },
      spawnSyncImpl,
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'rg');
    assert.equal(calls[0].opts.cwd, repoRoot);
    assert.ok(calls[0].args.includes('--fixed-strings'), 'query should be a literal fixed-string search');
    assert.ok(calls[0].args.includes('--'), 'query should be separated from options');
    assert.deepEqual(
      result.hits.map((hit) => ({ path: hit.path, lineNumber: hit.lineNumber })),
      [{ path: 'app/api/kitchen-assistant/route.js', lineNumber: 7 }],
    );
    assert.equal(result.truncated, true);
    assert.equal(result.hits.some((hit) => path.isAbsolute(hit.path)), false);
    assert.equal(result.hits.some((hit) => hit.path.startsWith('..')), false);
  });

  it('rejects path traversal globs before invoking ripgrep', () => {
    const calls = [];
    const result = tool.runDevCodeSearch({
      query: 'ollamaChat',
      glob: '../**',
      hasPin: true,
      repoRoot: path.join(os.tmpdir(), 'lariat-code-search-test'),
      env: { LARIAT_DEV_CODE_SEARCH: '1' },
      spawnSyncImpl: fakeSpawn({}, calls),
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_glob');
    assert.equal(calls.length, 0);
  });
});

describe('renderDevCodeSearchForPrompt', () => {
  it('formats a bounded, pipe-safe table for LaRi responses', () => {
    const text = tool.formatDevCodeSearchForPrompt({
      ok: true,
      schemaVersion: tool.DEV_CODE_SEARCH_SCHEMA_VERSION,
      query: 'ollamaChat',
      glob: null,
      hitCount: 1,
      truncated: false,
      hits: [
        {
          path: 'lib/ollama.ts',
          lineNumber: 123,
          text: 'export async function ollamaChat(opts | with pipe) {',
        },
      ],
    });

    assert.match(text, /Code search "ollamaChat" - 1 hit/);
    assert.match(text, /lib\/ollama\.ts \| 123 \| export async function ollamaChat\(opts \/ with pipe\)/);
  });
});
