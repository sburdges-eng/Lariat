// @ts-check
/* Lariat service worker — GET /api/* cache + BackgroundSync-like queue for POST/DELETE /api/*.
 *
 * Runs in ServiceWorkerGlobalScope (not a Window). The repo tsconfig loads only the `dom`
 * lib and excludes `public/**` (as does eslint.config.js), so this file is not part of the
 * type-checked program and the ambient ServiceWorker* / Fetch* / Extendable* types are absent.
 * To keep the file self-checking under `// @ts-check` — should it ever be included, or checked
 * standalone — the SW-scope types it actually uses are declared as minimal local typedefs
 * below, rather than pulling in the `webworker` lib (which collides with `dom`).
 * Migrated off the pre-#250 @ts-nocheck baseline. See GH #250 / docs/checkjs-migration.md.
 */

/**
 * A controlled/uncontrolled window client this SW can message.
 * @typedef {Object} SWClient
 * @property {(message: unknown) => void} postMessage
 */
/**
 * The `clients` registry on the SW global scope.
 * @typedef {Object} SWClients
 * @property {(options?: { includeUncontrolled?: boolean, type?: string }) => Promise<SWClient[]>} matchAll
 * @property {() => Promise<void>} claim
 */
/**
 * Base lifecycle event exposing `waitUntil`.
 * @typedef {Object} ExtendableEvent
 * @property {(promise: Promise<unknown>) => void} waitUntil
 */
/**
 * `fetch` event.
 * @typedef {ExtendableEvent & { request: Request, respondWith: (response: Response | Promise<Response>) => void }} FetchEvent
 */
/**
 * `message` event delivered to the SW. `data` is untyped by the platform (matches lib.webworker).
 * @typedef {ExtendableEvent & { data: any, source: SWClient | null }} ExtendableMessageEvent
 */
/**
 * Minimal view of the ServiceWorkerGlobalScope members this file touches.
 * @typedef {Object} ServiceWorkerScope
 * @property {SWClients} clients
 * @property {() => Promise<void>} skipWaiting
 * @property {(type: string, listener: (event: any) => void) => void} addEventListener
 */

/**
 * A mutation as enqueued (no key yet — IndexedDB assigns the autoIncrement `id`).
 * @typedef {Object} NewQueueEntry
 * @property {string} url
 * @property {string} method
 * @property {Record<string, string>} headers
 * @property {string} body
 * @property {number} queuedAt
 */
/**
 * A stored mutation read back from the queue (always carries its assigned key).
 * @typedef {NewQueueEntry & { id: IDBValidKey }} QueueEntry
 */
/**
 * Messages this SW broadcasts to clients.
 * @typedef {{ type: 'mutationQueued', id: IDBValidKey, size: number }
 *   | { type: 'mutationReplayed', replayed: number, failed: number, size: number }} OutgoingMessage
 */

/** The SW global scope, typed. `self` is `Window`-typed by the `dom` lib, so route SW-only members through this. */
const sw = /** @type {ServiceWorkerScope} */ (/** @type {unknown} */ (self));

const CACHE_NAME = 'lariat-api-v1';
const PAGE_CACHE = 'lariat-pages-v1';
// v2: v1 holds line-book chunks that carried the manager sheets. The
// activate sweep only deletes caches outside OWNED_CACHES, so renaming
// this is what evicts the already-leaked bytes from devices that have
// opened /boh.
const ASSET_CACHE = 'lariat-assets-v2';
const DB_NAME = 'lariat-sw';
const DB_VERSION = 1;
const STORE_NAME = 'mutation-queue';

/** Caches this version of the worker owns. Anything else is swept on activate. */
const OWNED_CACHES = [CACHE_NAME, PAGE_CACHE, ASSET_CACHE];

/**
 * Line-book pages kept on the device so they open with the wifi down.
 *
 * These are the cook-tier sheets: the printed ops packet, which is
 * reference paper — fixed text, no live data, no PIN. A cook who loses
 * the network mid-shift still gets their station SOP and day plan.
 *
 * The four manager sheets are deliberately absent and must stay absent.
 * They carry vendor pricing, order history and sign-offs, and they are
 * PIN-gated in middleware. A cached copy would serve that to anyone
 * holding the phone with no PIN in the way, which is worse than not
 * having them offline at all. tests/js/test-boh-pin-coverage.mjs asserts
 * this list is exactly the cook tier and shares nothing with the manager
 * tier, so it cannot drift as sheets are added.
 *
 * Live-ops surfaces (86 board, stations, prep) are also absent on
 * purpose: a stale 86 board read off a cache is worse than no 86 board.
 */
const OFFLINE_PAGES = [
  '/boh',
  '/boh/dinner-day-plan',
  '/boh/sunday-day-plan',
  '/boh/deep-clean',
  '/boh/prep-par',
  '/boh/sop-grille',
  '/boh/sop-fry-garde',
  '/boh/sop-expo-dish',
  '/boh/recipe-index',
];

/** @param {string} pathname */
function isOfflinePage(pathname) {
  // Exact match only. A prefix test would sweep in /boh/sysco-count.
  return OFFLINE_PAGES.indexOf(pathname) !== -1;
}

sw.addEventListener('install', /** @param {ExtendableEvent} e */ (e) => {
  // Warm the line book at install rather than on first visit: the point
  // is the sheet a cook did not think to open before the wifi dropped.
  // Individual failures are tolerated — a half-warmed book still beats
  // refusing to install the worker.
  e.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((c) => Promise.allSettled(OFFLINE_PAGES.map((p) => c.add(p))))
      .catch(() => undefined)
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', /** @param {ExtendableEvent} e */ (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => OWNED_CACHES.indexOf(k) === -1).map((k) => caches.delete(k)),
        ),
      )
      .catch(() => undefined)
      .then(() => sw.clients.claim()),
  );
});

/* ---------- IndexedDB helpers ---------- */

/** @returns {Promise<IDBDatabase>} */
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

/**
 * @param {IDBDatabase} db
 * @param {IDBTransactionMode} mode
 * @returns {IDBObjectStore}
 */
function tx(db, mode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

/**
 * @param {NewQueueEntry} entry
 * @returns {Promise<IDBValidKey>}
 */
async function enqueue(entry) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<QueueEntry[]>} */
async function peekAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(/** @type {QueueEntry[]} */ (req.result || []));
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBValidKey} id
 * @returns {Promise<void>}
 */
async function remove(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<number>} */
async function queueSize() {
  return (await peekAll()).length;
}

/**
 * @param {OutgoingMessage} msg
 * @returns {Promise<void>}
 */
async function broadcast(msg) {
  const clients = await sw.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

/* ---------- Fetch handler ---------- */

sw.addEventListener('fetch', /** @param {FetchEvent} event */ (event) => {
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

  // Build assets: cache-first. They are content-hashed, so a hit is
  // always correct, and without them a cached page renders but never
  // hydrates — the boxes would draw and not tick.
  if (request.method === 'GET' && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Line-book pages: network-first so a cook on the wifi always sees the
  // current sheet, cache only as the fallback for when there is no wifi.
  if (request.method === 'GET' && isOfflinePage(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(url.pathname, clone));
          }
          return res;
        })
        .catch(() =>
          caches
            .open(PAGE_CACHE)
            .then((c) => c.match(url.pathname))
            .then(
              (r) =>
                r ||
                new Response(
                  '<!doctype html><meta charset="utf-8">' +
                    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                    '<title>Line book</title>' +
                    '<body style="font:16px/1.5 system-ui;padding:24px">' +
                    '<h1 style="font-size:20px">No wifi, and this sheet is not on the phone yet.</h1>' +
                    '<p>Use the paper packet.</p>',
                  { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
                ),
            ),
        ),
    );
    return;
  }
});

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
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
  /** @type {Record<string, string>} */
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

/** @returns {Promise<void>} */
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

sw.addEventListener('message', /** @param {ExtendableMessageEvent} event */ (event) => {
  if (event.data && event.data.type === 'replayQueue') {
    event.waitUntil(replay());
  } else if (event.data && event.data.type === 'queueSize') {
    event.waitUntil((async () => {
      const size = await queueSize();
      if (event.source) event.source.postMessage({ type: 'queueSizeResult', size });
    })());
  }
});
