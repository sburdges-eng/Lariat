import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

describe('stations.json setup_key field', () => {
  const stations = JSON.parse(readFileSync(join(ROOT, 'data/cache/stations.json'), 'utf-8'));
  const setups = JSON.parse(readFileSync(join(ROOT, 'data/cache/setups.json'), 'utf-8'));

  it('every station has a setup_key property (may be null for FOH roles)', () => {
    for (const s of stations) {
      assert.ok('setup_key' in s, `station ${s.id} missing setup_key field`);
    }
  });

  it('non-null setup_key must reference an existing tab in setups.json', () => {
    for (const s of stations) {
      if (s.setup_key == null) continue;
      assert.ok(
        Array.isArray(setups[s.setup_key]) && setups[s.setup_key].length > 0,
        `station ${s.id} has setup_key="${s.setup_key}" but setups.json has no matching non-empty tab`,
      );
    }
  });

  it('every setup tab in setups.json is referenced by at least one station', () => {
    const referenced = new Set(stations.map((s) => s.setup_key).filter(Boolean));
    for (const tab of Object.keys(setups)) {
      assert.ok(referenced.has(tab), `setups.json tab "${tab}" is orphaned — no station.setup_key points to it`);
    }
  });

  it('runner (FOH role) has no setup — null is the expected value', () => {
    const runner = stations.find((s) => s.id === 'runner');
    assert.ok(runner, 'runner station missing from stations.json');
    assert.equal(runner.setup_key, null);
  });
});

describe('training QA generator', () => {
  it('produces valid JSONL without crashing against current cache', () => {
    const result = spawnSync('node', ['training/generate-qa.mjs'], {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, `generate-qa failed:\n${result.stderr}`);
    const jsonl = readFileSync(join(ROOT, 'training/lariat-qa.jsonl'), 'utf-8').trim();
    const lines = jsonl.split('\n');
    assert.ok(lines.length > 100, `expected > 100 training pairs, got ${lines.length}`);
    for (const [i, line] of lines.entries()) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        assert.fail(`line ${i + 1} is not valid JSON: ${line.slice(0, 120)}`);
      }
      assert.ok(Array.isArray(parsed.messages), `line ${i + 1} missing messages array`);
      assert.equal(parsed.messages.length, 2, `line ${i + 1} expected 2 messages, got ${parsed.messages.length}`);
      assert.equal(parsed.messages[0].role, 'user');
      assert.equal(parsed.messages[1].role, 'assistant');
    }
  });

  it('covers Station Setup questions — proof the setups surface is in training', () => {
    const jsonl = readFileSync(join(ROOT, 'training/lariat-qa.jsonl'), 'utf-8');
    // Opening-steps questions follow the "opening steps" / "setup" phrasing in generate-qa.mjs
    const setupQuestions = jsonl.split('\n').filter((l) => {
      if (!l.trim()) return false;
      const msg = JSON.parse(l).messages[0].content.toLowerCase();
      return msg.includes('opening') || msg.includes('setup');
    });
    assert.ok(setupQuestions.length >= 4,
      `expected at least 4 setup-related training pairs (one per setup tab), got ${setupQuestions.length}`);
  });
});
