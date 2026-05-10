// desktop/server-entry.cjs
//
// Forked into a child by desktop/supervisor.ts. Boots Next.js
// programmatically against the project root (which is the unpacked .app
// Resources/app dir in production, or the repo root in dev).
//
// Required env (set by supervisor):
//   PORT, HOST, NODE_ENV, LARIAT_DATA_DIR
// Optional env:
//   LARIAT_DATA_ROOT (data pack dir), LARIAT_PYTHON, LARIAT_OLLAMA_URL

const path = require('node:path');
const http = require('node:http');
const next = require('next');

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';

// In production the .app's Resources/app/ holds package.json + .next/.
// In dev (npm run desktop:dev) this resolves to the repo root.
const projectDir = path.resolve(__dirname, '..');

const app = next({ dev, dir: projectDir });
const handle = app.getRequestHandler();

let server;

app.prepare()
  .then(() => {
    server = http.createServer((req, res) => handle(req, res));
    server.listen(port, host, () => {
      console.log(`[server-entry] ready on ${host}:${port} (dataDir=${process.env.LARIAT_DATA_DIR})`);
    });
  })
  .catch((err) => {
    console.error('[server-entry] failed to start Next:', err);
    process.exit(1);
  });

// Graceful shutdown — supervisor sends {type:"shutdown"} via IPC
process.on('message', (msg) => {
  if (msg && msg.type === 'shutdown') {
    if (!server) return process.exit(0);
    const forceTimer = setTimeout(() => process.exit(0), 5_000);
    server.close((err) => {
      if (err) console.error('[server-entry] server.close error during shutdown:', err);
      clearTimeout(forceTimer);
      process.exit(0);
    });
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT',  () => process.exit(0));
