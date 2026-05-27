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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function git(args) {
    return execSync(`git ${args}`, { encoding: 'utf8' }).trim();
}

const gitDir = git('rev-parse --git-dir');
const sessionFile = join(gitDir, 'SESSION_BRANCH');

// Branch-naming rule (binding — see AGENTS.md "Branch naming"). Allow
// only feat/ fix/ chore/ wip/. The guard sits before the SESSION_BRANCH
// check so a fresh branch with a bad name fails loudly on the first
// commit, not after the operator has stacked five of them. Override
// for legacy-fixup work via LARIAT_ALLOW_ANY_BRANCH=1.
const ALLOWED_BRANCH_PREFIXES = ['feat/', 'fix/', 'chore/', 'wip/'];

let _currentBranch = null;
function currentBranch() {
    if (_currentBranch !== null) return _currentBranch;
    try {
        _currentBranch = git('symbolic-ref --short HEAD');
    } catch {
        _currentBranch = '';
    }
    return _currentBranch;
}

if (!process.env.LARIAT_ALLOW_ANY_BRANCH) {
    const branch = currentBranch();
    // Skip the check on main / detached HEAD; main is the merge target,
    // detached HEAD is its own (different) failure mode handled below.
    if (branch && branch !== 'main' && branch !== 'master') {
        const ok = ALLOWED_BRANCH_PREFIXES.some((p) => branch.startsWith(p));
        if (!ok) {
            console.error(`✗ refusing to commit: branch "${branch}" violates AGENTS.md naming rule.`);
            console.error('  Use one of: feat/<short-name>, fix/<short-name>, chore/<short-name>, wip/<short-name>.');
            console.error(`  To fix:    git branch -m feat/${branch}   (or fix/, chore/, wip/)`);
            console.error('  Override:  LARIAT_ALLOW_ANY_BRANCH=1 git commit ...   (legacy-fixup only)');
            process.exit(1);
        }
    }
}

// 1. Check Branch Lock
if (existsSync(sessionFile)) {
    const expected = readFileSync(sessionFile, 'utf8').trim();
    if (expected) {
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
    }
}

// 2. Check Agent File Claims
const STALE_THRESHOLD_MS = 30 * 60 * 1000;
const REPO_ROOT = git('rev-parse --show-toplevel');
const SESSION_DIR = join(REPO_ROOT, '.agent-sessions');

if (existsSync(SESSION_DIR)) {
    const currentAgent = process.env.AGENT_NAME || process.env.TOOL_NAME || 'gemini';
    const stagedFiles = git('diff --cached --name-only').split('\n').filter(Boolean);

    if (stagedFiles.length > 0) {
        const sessionFiles = readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
        const conflicts = [];

        for (const f of sessionFiles) {
            try {
                const data = JSON.parse(readFileSync(join(SESSION_DIR, f), 'utf8'));
                if (data.agent === currentAgent) continue;

                const lastUpdate = Date.parse(data.lastUpdate);
                if (isNaN(lastUpdate) || (Date.now() - lastUpdate) > STALE_THRESHOLD_MS) continue;

                const claimedFiles = data.claimedFiles || [];
                const overlapping = stagedFiles.filter(file => claimedFiles.includes(file));

                if (overlapping.length > 0) {
                    conflicts.push({ agent: data.agent, files: overlapping, updated: data.lastUpdate });
                }
            } catch (e) {
                // Ignore malformed session files
            }
        }

        if (conflicts.length > 0) {
            console.error('✗ refusing to commit: file claim conflict detected');
            for (const c of conflicts) {
                console.error(`  Agent "${c.agent}" claimed these files (last active ${c.updated}):`);
                for (const f of c.files) {
                    console.error(`    - ${f}`);
                }
            }
            console.error('  Coordination required. Ask the user or wait for claims to expire (30m).');
            process.exit(1);
        }
    }
}

process.exit(0);
