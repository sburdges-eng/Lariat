import { test, expect } from '@playwright/test';

test.describe('PWA infrastructure', () => {
  test('manifest.json is valid and has correct fields', async ({ page }) => {
    const res = await page.goto('/manifest.json');
    expect(res?.status()).toBe(200);
    const manifest = await res!.json();
    expect(manifest.name).toBe('Lariat Cockpit');
    expect(manifest.short_name).toBe('Lariat');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#f59e0b');
    expect(manifest.background_color).toBe('#0b0d10');
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  });

  test('layout references manifest and theme-color', async ({ page }) => {
    await page.goto('/');
    const manifest = page.locator('link[rel="manifest"]');
    await expect(manifest).toHaveAttribute('href', '/manifest.json');
    const theme = page.locator('meta[name="theme-color"]');
    await expect(theme).toHaveAttribute('content', '#f59e0b');
  });

  test('service worker registers and becomes active', async ({ page }) => {
    await page.goto('/');
    const swActive = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready;
      return reg.active !== null;
    });
    expect(swActive).toBe(true);
  });

  test('SW excludes /api/auth from caching', async ({ page }) => {
    const sw = await page.goto('/sw.js');
    const text = await sw!.text();
    expect(text).toContain("url.pathname.startsWith('/api/auth/')");
  });
});
