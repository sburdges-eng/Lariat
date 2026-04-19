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

  // Full offline round-trip (POST while offline → queue → online → replay → persisted)
  // requires real network disconnection — Playwright's context.setOffline() doesn't
  // block SW-initiated fetches. Test manually via DevTools > Network > Offline.
  test.skip('full offline POST → queue → replay (manual only)', async () => {});
});
