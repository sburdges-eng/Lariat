#!/usr/bin/env node
// Pre-commit guard: refuse commits when HEAD has drifted from the
// branch this worktree was locked to via SESSION_BRANCH.
//
// SESSION_BRANCH is written by scripts/worktree.sh into the current
// worktree's git-dir (see `git rev-parse --git-dir`). Linked worktrees
// each get their own. The main checkout has no lock by default —
// `scripts/worktree.sh lock <branch>` opts it in for an ad-hoc batch.
//
// The guard exists because concurrent AI sessions can call
// `git checkout` mid-batch and the next commit lands on the wrong
// branch without the operator noticing. With this guard, the batch
// fails loudly instead of silently scattering commits.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function git(args) {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

const gitDir = git('rev-parse --git-dir');
const sessionFile = join(gitDir, 'SESSION_BRANCH');

if (!existsSync(sessionFile)) process.exit(0);

const expected = readFileSync(sessionFile, 'utf8').trim();
if (!expected) process.exit(0);

let current;
try {
    current = git('symbolic-ref --short HEAD');
} catch {
    console.error('✗ refusing to commit: HEAD is detached, cannot verify SESSION_BRANCH');
    process.exit(1);
}

if (expected !== current) {
    console.error(`✗ refusing to commit: SESSION_BRANCH expected "${expected}" but HEAD is on "${current}"`);
    console.error('  another session likely switched branches in this worktree.');
    console.error(`  to fix:  git switch ${expected}`);
    console.error(`  or:      rm ${sessionFile}   (disables the guard for this worktree)`);
    process.exit(1);
}
