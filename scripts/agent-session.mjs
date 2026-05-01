import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SESSION_DIR = path.join(REPO_ROOT, '.agent-sessions');

/**
 * scripts/agent-session.mjs
 * 
 * Management utility for multi-agent coordination.
 * 
 * Commands:
 *   update --status <status> --claimed <file1,file2> --branch <branch> --tool <tool>
 *   list
 *   claim <file1,file2>
 */

function getGitContext() {
  try {
    const branch = execSync('git symbolic-ref --short HEAD', { encoding: 'utf8' }).trim();
    const worktree = REPO_ROOT;
    return { branch, worktree };
  } catch {
    return { branch: 'unknown', worktree: REPO_ROOT };
  }
}

function updateSession(args) {
  const tool = args.tool || process.env.AGENT_NAME || 'gemini';
  const sessionPath = path.join(SESSION_DIR, `${tool}.json`);
  
  let session = {};
  if (fs.existsSync(sessionPath)) {
    session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  }

  const { branch, worktree } = getGitContext();

  session.agent = tool;
  session.branch = args.branch || session.branch || branch;
  session.worktree = args.worktree || session.worktree || worktree;
  session.status = args.status || session.status || 'active';
  session.lastUpdate = new Date().toISOString();
  
  if (args.claimed) {
    const newClaims = args.claimed.split(',').map(f => f.trim());
    session.claimedFiles = [...new Set([...(session.claimedFiles || []), ...newClaims])];
  }

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  console.log(`✓ Updated session for ${tool}: ${session.status} on ${session.branch}`);
}

function listSessions() {
  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No active agent sessions.');
    return;
  }

  console.log('\nACTIVE AGENT SESSIONS');
  console.log('=====================');
  files.forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), 'utf8'));
    console.log(`\nAgent:    ${data.agent}`);
    console.log(`Status:   ${data.status}`);
    console.log(`Branch:   ${data.branch}`);
    console.log(`Worktree: ${data.worktree}`);
    console.log(`Claims:   ${(data.claimedFiles || []).join(', ') || 'none'}`);
    console.log(`Updated:  ${data.lastUpdate}`);
  });
}

const cmd = process.argv[2];
const args = {};
process.argv.slice(3).forEach((val, index, array) => {
  if (val.startsWith('--')) {
    args[val.slice(2)] = array[index + 1];
  }
});

switch (cmd) {
  case 'update':
    updateSession(args);
    break;
  case 'list':
    listSessions();
    break;
  default:
    console.log('usage: node scripts/agent-session.mjs update|list [--tool name] [--status s] [--claimed f1,f2]');
}
