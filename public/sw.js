// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
/* Lariat service worker — GET /api/* cache + BackgroundSync-like queue for POST/DELETE /api/* */

const CACHE_NAME = 'lariat-api-v1';
const DB_NAME = 'lariat-sw';
const DB_VERSION = 1;
const STORE_NAME = 'mutation-queue';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* ---------- IndexedDB helpers ---------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

async function enqueue(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function peekAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function queueSize() {
  return (await peekAll()).length;
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

/* ---------- Fetch handler ---------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache or queue auth endpoints — must always be live
  if (url.pathname.startsWith('/api/auth/')) return;

  // GET /api/*: stale-while-revalidate
  if (request.method === 'GET' && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } }))),
    );
    return;
  }

  // POST / DELETE /api/*: try network, queue on failure
  if ((request.method === 'POST' || request.method === 'DELETE') && url.pathname.startsWith('/api/')) {
    event.respondWith(handleMutation(request.clone()));
    return;
  }
});

async function handleMutation(request) {
  // Capture body + headers BEFORE the network attempt. `fetch(request)`
  // consumes the request body stream; if we wait until the catch branch
  // to read it via `request.text()`, we get an empty string — and the
  // replay-fetch later sends an empty body, which the server rejects as
  // SyntaxError → 500 → the entry stays queued forever in the 5xx
  // branch of replay() and grows the queue indefinitely.
  // NOTE: captures whatever headers the fetch API exposes. Do not add
  // Authorization/bearer tokens without auditing — replayed requests
  // would resend them. Cookies are browser-managed, not captured here.
  let bodyText = '';
  try { bodyText = await request.clone().text(); } catch {}
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  try {
    const res = await fetch(request);
    return res;
  } catch {
    // Network failure — queue and return synthetic 202
    const id = await enqueue({
      url: request.url,
      method: request.method,
      headers,
      body: bodyText,
      queuedAt: Date.now(),
    });
    await broadcast({ type: 'mutationQueued', id, size: await queueSize() });
    return new Response(
      JSON.stringify({ queued: true, queueId: id, ok: true }),
      { status: 202, headers: { 'content-type': 'application/json' } },
    );
  }
}

/* ---------- Replay queue on signal ---------- */

async function replay() {
  const entries = await peekAll();
  let replayed = 0;
  let failed = 0;
  for (const e of entries) {
    try {
      const res = await fetch(e.url, {
        method: e.method,
        headers: e.headers,
        body: e.body || undefined,
      });
      if (res.ok) {
        await remove(e.id);
        replayed++;
      } else if (res.status >= 400 && res.status < 500) {
        // Client error — server rejected; retrying won't help. Drop from queue.
        await remove(e.id);
        failed++;
      } else {
        // 5xx or other transient — leave in queue for next replay.
        failed++;
      }
    } catch {
      failed++;
    }
  }
  await broadcast({ type: 'mutationReplayed', replayed, failed, size: await queueSize() });
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'replayQueue') {
    event.waitUntil(replay());
  } else if (event.data && event.data.type === 'queueSize') {
    event.waitUntil((async () => {
      const size = await queueSize();
      if (event.source) event.source.postMessage({ type: 'queueSizeResult', size });
    })());
  }
});
