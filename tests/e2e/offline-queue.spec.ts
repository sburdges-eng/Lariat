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
    expect(text).toMatch(/offline/i);
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

    const exists = await page.evaluate(() => {
      return new Promise((resolve) => {
        const req = indexedDB.open('lariat-sw', 1);
        req.onsuccess = () => {
          const db = req.result;
          resolve(db.objectStoreNames.contains('mutation-queue'));
        };
        req.onerror = () => resolve(false);
      });
    });

    expect(exists).toBe(true);
  });

  // Full offline round-trip — partially closes the §8 P1 spec acceptance
  // criterion (docs/superpowers/specs/2026-05-02-sw-replay-idempotency-design.md):
  //   "queue → throttle online → replay → exactly one row written, even
  //    when the original POST is artificially 'lost-after-commit'."
  //
  // What this test does:
  //   Two POSTs with the same idempotency-key + body hit the live server.
  //   The wrapper's cache catches the second request without re-running the
  //   handler. Proves the dedup contract end to end against a real Next.js
  //   server, complementing the unit-level tests in
  //   tests/js/test-idempotency-wrapper.mjs.
  //
  // What's still TODO:
  //   The full SW-queue → replay round-trip (force the SW's first fetch to
  //   fail via context.route().abort, then signal replay) is more involved
  //   to wire up reliably. A first attempt at that test exists locally but
  //   ran into a debug-needed failure in the replay path; not committed.
  //   Tracked as follow-up.

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
