import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

function bashScript(relativePath, args = [], options = {}) {
  return run("bash", [path.join(repoRoot, relativePath), ...args], options);
}

function pythonScript(relativePath, args = [], options = {}) {
  return run("python3", [path.join(repoRoot, relativePath), ...args], options);
}

function fixtureRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "lariat-governance-"));
  const git = run("git", ["init", "-q"], { cwd: root });
  assert.equal(git.status, 0, git.stderr);
  return root;
}

function withFixtureRepo(fn) {
  const root = fixtureRepo();
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root, relativePath, text) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

test("assert-project-root accepts the Lariat checkout and rejects the shared Dev root", () => {
  const ok = bashScript("scripts/dev/assert-project-root.sh", ["--check"], {
    cwd: repoRoot,
  });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);

  const rejected = bashScript("scripts/dev/assert-project-root.sh", ["--check"], {
    cwd: path.dirname(repoRoot),
  });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr + rejected.stdout, /project checkout|shared workspace|git/i);
});

test("no-absolute-paths flags committed filesystem paths but permits route-like paths", () => {
  withFixtureRepo((root) => {
    writeFixture(root, "app/routes.js", 'export const route = "/api/inventory";\n');

    const clean = bashScript("scripts/ci/no-absolute-paths.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);

    const absolutePathFixture = `"/${"Users"}/seanburdges/secret"`;
    writeFixture(root, "lib/config.js", `export const bad = ${absolutePathFixture};\n`);

    const dirty = bashScript("scripts/ci/no-absolute-paths.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout + dirty.stderr, /lib\/config\.js/);
  });
});

test("no-cache-artifacts flags Python cache artifacts", () => {
  withFixtureRepo((root) => {
    writeFixture(root, "app/page.js", "export default function Page() { return null; }\n");

    const clean = bashScript("scripts/ci/no-cache-artifacts.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);

    writeFixture(root, "scripts/__pycache__/tool.cpython-312.pyc", "cache");

    const dirty = bashScript("scripts/ci/no-cache-artifacts.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stdout + dirty.stderr, /__pycache__/);
  });
});

test("check-json-order enforces schemaVersion first and canonical intent ordering", () => {
  withFixtureRepo((root) => {
    writeFixture(
      root,
      "schemas/canonical.schema.json",
      '{"seed":"","schemaVersion":"1","text":"","intent":{"harmonic":{},"rhythmic":{},"dynamic":{},"tempo":{}}}\n',
    );

    const bad = pythonScript("scripts/schema/check-json-order.py", ["--check"], {
      cwd: root,
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout + bad.stderr, /schemaVersion.*first|canonical\.schema\.json/i);

    writeFixture(
      root,
      "schemas/canonical.schema.json",
      '{"schemaVersion":"1","seed":"","text":"","intent":{"harmonic":{},"rhythmic":{},"dynamic":{},"tempo":{}}}\n',
    );

    const good = pythonScript("scripts/schema/check-json-order.py", ["--check"], {
      cwd: root,
    });
    assert.equal(good.status, 0, good.stderr || good.stdout);
  });
});

test("audit-runtime-ai permits local Ollama config and flags cloud AI runtime coupling", () => {
  withFixtureRepo((root) => {
    writeFixture(root, "lib/ollama.ts", 'export const url = process.env.LARIAT_OLLAMA_URL;\n');

    const localOnly = bashScript("scripts/security/audit-runtime-ai.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(localOnly.status, 0, localOnly.stderr || localOnly.stdout);

    writeFixture(root, "app/api/assistant/route.js", 'fetch("https://api.openai.com/v1/chat/completions");\n');

    const cloud = bashScript("scripts/security/audit-runtime-ai.sh", ["--check"], {
      cwd: root,
    });
    assert.equal(cloud.status, 1);
    assert.match(cloud.stdout + cloud.stderr, /api\.openai\.com/);
  });
});

test("require-change-declaration requires all governance fields", () => {
  withFixtureRepo((root) => {
    writeFixture(
      root,
      "change.md",
      [
        "Affected subsystem: scripts",
        "Freeze-readiness impact: preflight only",
        "Determinism impact: deterministic read-only checks",
        "Security impact: flags cloud runtime coupling",
        "Runtime coupling introduced: NO",
        "",
      ].join("\n"),
    );

    const good = bashScript("scripts/change/require-change-declaration.sh", ["--check", "change.md"], {
      cwd: root,
    });
    assert.equal(good.status, 0, good.stderr || good.stdout);

    writeFixture(root, "change.md", "Affected subsystem: scripts\nSecurity impact: missing fields\n");

    const bad = bashScript("scripts/change/require-change-declaration.sh", ["--check", "change.md"], {
      cwd: root,
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout + bad.stderr, /Freeze-readiness impact|Determinism impact/);
  });
});

test("check runner exposes a read-only help contract", () => {
  const result = bashScript("scripts/check.sh", ["--help"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /--check/);
  assert.match(result.stdout, /CHANGE_DECLARATION_FILE/);
});
