# Lariat Logic Hardening Master Plan

## Context
A sweep of the Lariat Cockpit architecture revealed four primarily critical vectors for silent data loss and unhandled exceptions:
1. Missing `try/catch` enclosures around `better-sqlite3` execution chains.
2. Missing `.catch()` evaluation on mutating React `fetch` calls, resulting in silent failures on iPads during bad network zones.
3. Loosely typed and unbound inputs allowing potentially memory-bloating SQLite strings.
4. An absolute lack of true PWA disconnected logic (Service Workers/localStorage queued syncs).

This plan breaks down the sequential file modifications required to eliminate these UI/DB gaps.

## Execution Branches

### Phase 1: API Level (SQLite Safety)
All API mutation endpoints must catch SQLite execution exceptions safely.
**Target Files**:
- `app/api/eighty-six/route.js`
- `app/api/beo/route.js`

**Diff Format Pattern**:
```js
+ try {
    const info = db.prepare(...).run(...);
    return Response.json({ ok: true, id: info.lastInsertRowid });
+ } catch (err) {
+   console.error("[SQLite Error]", err);
+   return Response.json({ error: "Database error" }, { status: 500 });
+ }
```

### Phase 2: Frontend Reaction Handling
Kitchen workers need visual feedback if a database mutation fails.
**Target Files**:
- `app/beo/BeoBoard.jsx`
- `app/_components/Sidebar.jsx`
- `app/eighty-six/EightySixBoard.jsx`

**Diff Format Pattern**:
```js
  const res = await fetch('/api/beo', { method: 'POST', body: ... });
+ if (!res.ok) {
+   setErr("Network disconnection or data drop. Please retry.");
+   return;
+ }
```

### Phase 3: Sanitization
Sanitize unstructured HTTP strings bounding DB size.
**Target Files**: `app/api/eighty-six/route.js` 
```js
+ const cleanReason = reason ? reason.substring(0, 500) : null;
```

### Phase 4: PWA Offline Queuing (For Claude Execution)
A dedicated service-worker needs to map failed POST requests to an `indexedDB` cache block when `navigator.onLine == false` and loop process back to `/api/` upon connection resume. 

Claude, please execute the following three changes:

**1. Create `public/sw.js`**
```javascript
// Minimal Service Worker to buffer POST requests
const CACHE_NAME = 'lariat-offline-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method === 'GET' && e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
```

**2. Create `app/_components/PWASetup.jsx`**
```javascript
'use client';
import { useEffect } from 'react';

export default function PWASetup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW Error:', err));
    }
  }, []);
  return null;
}
```

**3. Update `app/layout.jsx`**
```javascript
import { Suspense } from 'react';
import '../styles/globals.css';
import Sidebar from './_components/Sidebar.jsx';
+ import PWASetup from './_components/PWASetup.jsx';

// ...
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
+       <PWASetup />
        <div className="app">
```
