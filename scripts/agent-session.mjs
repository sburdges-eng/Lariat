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
  session.role = args.role || session.role || 'none';
  session.lastUpdate = new Date().toISOString();
  
  if (args.claimed) {
    const newClaims = args.claimed.split(',').map(f => f.trim());
    session.claimedFiles = [...new Set([...(session.claimedFiles || []), ...newClaims])];
  }

  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  console.log(`✓ Updated session for ${tool}: ${session.status} (${session.role}) on ${session.branch}`);
}

function listSessions() {
  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No active agent sessions.');
    return;
  }

  const sessions = files.map(f => JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), 'utf8')));
  const roles = [...new Set(sessions.map(s => s.role))].sort();

  console.log('\nACTIVE AGENT SESSIONS');
  console.log('=====================');

  roles.forEach(role => {
    const roleSessions = sessions.filter(s => s.role === role);
    console.log(`\n[ ROLE: ${role.toUpperCase()} ]`);
    roleSessions.forEach(data => {
      console.log(`  Agent:    ${data.agent}`);
      console.log(`  Status:   ${data.status}`);
      console.log(`  Branch:   ${data.branch}`);
      console.log(`  Worktree: ${data.worktree}`);
      console.log(`  Claims:   ${(data.claimedFiles || []).join(', ') || 'none'}`);
      console.log(`  Updated:  ${data.lastUpdate}`);
    });
  });
}

function handoff(args) {
  const target = args.to;
  if (!target) {
    console.error('usage: node scripts/agent-session.mjs handoff --to <target-tool>');
    process.exit(1);
  }

  const currentTool = args.tool || process.env.AGENT_NAME || 'gemini';
  const currentPath = path.join(SESSION_DIR, `${currentTool}.json`);
  
  if (!fs.existsSync(currentPath)) {
    console.error(`✗ No active session found for current tool: ${currentTool}`);
    process.exit(1);
  }

  const session = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
  if (session.status === 'idle') {
    console.log(`! Current tool ${currentTool} is already idle. Nothing to hand off.`);
    process.exit(0);
  }

  // 1. Update Target Tool
  const targetPath = path.join(SESSION_DIR, `${target}.json`);
  let targetSession = {};
  if (fs.existsSync(targetPath)) {
    targetSession = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  }

  targetSession.agent = target;
  targetSession.branch = session.branch;
  targetSession.worktree = session.worktree;
  targetSession.status = `Handoff from ${currentTool}: ${session.status}`;
  targetSession.claimedFiles = [...(session.claimedFiles || [])];
  targetSession.lastUpdate = new Date().toISOString();

  fs.writeFileSync(targetPath, JSON.stringify(targetSession, null, 2));

  // 2. Reset Current Tool
  session.status = 'idle';
  session.claimedFiles = [];
  session.lastUpdate = new Date().toISOString();
  fs.writeFileSync(currentPath, JSON.stringify(session, null, 2));

  console.log(`✓ Context handed off from ${currentTool} to ${target}`);
  console.log(`  Branch: ${targetSession.branch}`);
  console.log(`  Files:  ${targetSession.claimedFiles.join(', ') || 'none'}`);
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
  case 'handoff':
    handoff(args);
    break;
  case 'claim':
    args.claimed = args.claimed || process.argv[3]; // support simple claim <f>
    updateSession(args);
    break;
  default:
    console.log('usage: node scripts/agent-session.mjs update|list|handoff|claim');
}
