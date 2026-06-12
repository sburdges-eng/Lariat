import { test, expect } from '@playwright/test';

test.describe('Offline indicator + SW queue infrastructure', () => {
  test('OfflineIndicator shows when navigator.onLine is false', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Force navigator.onLine = false and fire 'offline' event
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      window.dispatchEvent(new Event('offline'));
    });

    const indicator = page.locator('[role="status"]');
    await expect(indicator).toBeVisible({ timeout: 5000 });
    const text = await indicator.textContent();
    // OfflineIndicator copy was updated in #115 (Section 7 P3 UI-copy sweep)
    // from "Offline" → "No connection" per docs/UI_COPY_RULES.md kitchen-verb
    // rule. Match the current copy.
    expect(text).toMatch(/no connection/i);
  });

  test('OfflineIndicator hides when back online with empty queue', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Go offline
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 5000 });

    // Go back online (queue is empty)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { value: true, writable: true });
      window.dispatchEvent(new Event('online'));
    });

    // With zero queued items and online, indicator should hide
    await expect(page.locator('[role="status"]')).not.toBeVisible({ timeout: 5000 });
  });

  test('SW responds to queueSize message', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => await navigator.serviceWorker.ready);

    const size = await page.evaluate(() => {
      return new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'queueSizeResult') {
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve(e.data.size);
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller!.postMessage({ type: 'queueSize' });
        setTimeout(() => resolve(-1), 5000);
      });
    });

    expect(size).toBe(0);
  });

  test('SW IndexedDB mutation-queue store exists', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => await navigator.serviceWorker.ready);

    // The store is created lazily by the SW's own openDB() (public/sw.js)
    // on its first queue operation. Opening 'lariat-sw' v1 from the page
    // context BEFORE the SW has done so creates an empty version-1 DB with
    // no stores — an order-dependent flake in full-suite runs. Force the
    // SW's openDB() first via the queueSize message, then probe.
    const exists = await page.evaluate(() => {
      return new Promise((resolve) => {
        const probe = () => {
          const req = indexedDB.open('lariat-sw', 1);
          req.onsuccess = () => {
            const db = req.result;
            const found = db.objectStoreNames.contains('mutation-queue');
            db.close();
            resolve(found);
          };
          req.onerror = () => resolve(false);
        };
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'queueSizeResult') {
            navigator.serviceWorker.removeEventListener('message', handler);
            probe();
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller!.postMessage({ type: 'queueSize' });
        setTimeout(() => resolve(false), 5000);
      });
    });

    expect(exists).toBe(true);
  });

  // Full offline round-trip — closes the §8 P1 spec acceptance criterion
  // (docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md):
  //   "queue → throttle online → replay → exactly one row written, even
  //    when the original POST is artificially 'lost-after-commit'."
  //
  // We can't use context.setOffline() — it doesn't catch SW-initiated fetch.
  // Instead use context.route() to abort only the FIRST POST hitting the
  // SW's network leg; the route handler then lets replay POSTs through.
  // Target /api/eighty-six because it's a tiny POST with no PIN gate, no
  // unique constraints, retrofitted in PR #129.
  //
  // Pairs with the SW body-preservation fix in this same PR — see
  // public/sw.js handleMutation(). Without that fix, the queue stored an
  // empty body and the replay POST returned 500.

  test('SW queue + replay preserves idempotency-key — exactly one row server-side', async ({ page, context }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5_000 });

    // Abort only the FIRST POST so the SW's fetch fails and the request gets
    // enqueued. Subsequent calls (the replay) pass through.
    let aborted = false;
    await context.route('**/api/eighty-six', (route) => {
      if (!aborted && route.request().method() === 'POST') {
        aborted = true;
        return route.abort('failed');
      }
      return route.continue();
    });

    const idemKey = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const itemName = `e2e-roundtrip-${Date.now()}`;
    const reqBody = {
      item: itemName,
      reason: 'sw replay roundtrip e2e',
      cook_id: 'e2e-test',
      location_id: 'e2e-test',
    };

    // 1. POST → SW catches the route.abort failure, enqueues with key intact,
    //    returns synthetic 202.
    const queuedResp = await page.evaluate(
      async ({ key, body }) => {
        const r = await fetch('/api/eighty-six', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      { key: idemKey, body: reqBody },
    );
    expect(queuedResp.status).toBe(202);
    expect(queuedResp.body?.queued).toBe(true);

    // 2. Trigger replay; wait for the SW broadcast.
    const replayed = await page.evaluate(() => {
      return new Promise<{ replayed: number; failed: number; size: number } | null>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'mutationReplayed') {
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve({ replayed: e.data.replayed, failed: e.data.failed, size: e.data.size });
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        navigator.serviceWorker.controller!.postMessage({ type: 'replayQueue' });
        setTimeout(() => resolve(null), 15_000);
      });
    });
    expect(replayed).not.toBeNull();
    expect(replayed!.replayed).toBe(1);
    expect(replayed!.failed).toBe(0);
    expect(replayed!.size).toBe(0);

    // 3. Verify exactly one row exists server-side. Filter by the unique
    //    generated `itemName` so any pre-existing e2e-test pollution
    //    doesn't make the test flaky.
    const rows = await page.evaluate(async (item: string) => {
      const r = await fetch('/api/eighty-six?location=e2e-test', { method: 'GET' });
      const data = await r.json();
      return ((data.active as Array<{ item: string }>) || []).filter((x) => x.item === item);
    }, itemName);
    expect(rows).toHaveLength(1);
  });

  test('idempotency-key reuse: cached response returned, no second insert', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    const result = await page.evaluate(async () => {
      const key = `e2e-cache-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const item = `e2e-cache-${Date.now()}`;
      const body = JSON.stringify({
        item,
        reason: 'idempotency cache e2e',
        cook_id: 'e2e-test',
        location_id: 'e2e-test',
      });
      const headers = { 'content-type': 'application/json', 'idempotency-key': key };
      const r1 = await fetch('/api/eighty-six', { method: 'POST', headers, body });
      const j1 = await r1.json();
      const r2 = await fetch('/api/eighty-six', { method: 'POST', headers, body });
      const j2 = await r2.json();
      return {
        s1: r1.status, s2: r2.status,
        j1, j2, key, item,
      };
    });

    // First POST creates the row.
    expect(result.s1).toBe(200);
    expect(result.j1.ok).toBe(true);
    expect(typeof result.j1.id).toBe('number');

    // Second POST hits the wrapper cache — same status, identical body,
    // crucially the same `id` (no fresh insert).
    expect(result.s2).toBe(200);
    expect(result.j2.id).toBe(result.j1.id);
    expect(result.j2).toEqual(result.j1);
  });

});
