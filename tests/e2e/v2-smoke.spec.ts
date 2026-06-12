import { test, expect } from '@playwright/test';

// Stage-0 smoke for the v2 cutover plan (docs/V2_CUTOVER_PLAN.md).
// One shift-style pass: cook tier (today board → KDS punch → 86 round
// trip → station boards) and manager tier (command / management /
// analytics) — proving the v2 wrappers exercise the same operational
// truth as v1. The 86 flow writes and resolves a real row through the
// live API, mirroring how cooks will use it mid-shift.

const PIN = process.env.LARIAT_PIN || '1234';
const E2E_ITEM = '__E2E_V2Smoke_' + Date.now();

test.describe('v2 Stage-0 smoke — shift-style pass', () => {
  test.beforeEach(async ({ page, context }) => {
    // The /v2 tree is preview-cookie gated (app/v2/layout.jsx).
    await context.addCookies([
      { name: 'lariat_v2', value: '1', domain: 'localhost', path: '/' },
    ]);
    // Manager-tier v2 routes are PIN-gated by middleware; authenticate
    // the context so cook AND manager flows run in one pass.
    const res = await page.request.post('/api/auth/pin', { data: { pin: PIN } });
    expect(res.ok()).toBe(true);
  });

  test('gate: /v2 is closed without the preview cookie', async ({ browser }) => {
    const cleanContext = await browser.newContext();
    const page = await cleanContext.newPage();
    await page.goto('/v2/today');
    await expect(page.getByRole('heading', { name: /preview is off/i })).toBeVisible();
    await cleanContext.close();
  });

  test('cook: today board renders live line state', async ({ page }) => {
    await page.goto('/v2/today');
    await expect(page.getByRole('heading', { name: 'Line now' })).toBeVisible();
    // The three stat cards are the board's live pulse.
    for (const label of ['Ready', 'Flagged', '86 now']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // Jump cards route deeper into the cook tier.
    await expect(page.locator('a[href^="/v2/kds/punch"]')).toBeVisible();
    await expect(page.locator('a[href^="/v2/eighty-six"]')).toBeVisible();
  });

  test('cook: KDS punch surface embeds the live ticket form', async ({ page }) => {
    await page.goto('/v2/kds/punch');
    await expect(page.getByRole('heading', { name: 'Send to line' })).toBeVisible();
    // The embedded PunchTicketPage (live v1 component) must render its
    // real inputs — ticket number and table — not a stub.
    await expect(page.locator('input[placeholder="1042"]')).toBeVisible();
    await expect(page.locator('input[placeholder="T12, Bar, Togo"]')).toBeVisible();
  });

  test('cook: 86 round trip — add on /v2/eighty-six, see it on /v2/today, resolve', async ({ page }) => {
    await page.goto('/v2/eighty-six');
    await expect(page.getByRole('heading', { name: "What's out" })).toBeVisible();

    // Add through the embedded live board (same form cooks use in v1).
    await page.locator('input[placeholder*="Pork Chop"]').fill(E2E_ITEM);
    await page.getByRole('button', { name: new RegExp(`Mark ${E2E_ITEM} as 86'd`) }).click();
    await expect(
      page.locator('[aria-label="Currently 86\'d items"]').getByText(E2E_ITEM),
    ).toBeVisible({ timeout: 5000 });

    // Same truth propagates to the today board.
    await page.goto('/v2/today');
    await expect(page.getByText(E2E_ITEM)).toBeVisible();

    // Resolve it back in stock and confirm it leaves the active list.
    await page.goto('/v2/eighty-six');
    await page.getByRole('button', { name: `Mark ${E2E_ITEM} as back in stock` }).click();
    await expect(
      page.locator('[aria-label="Currently 86\'d items"]').getByText(E2E_ITEM),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('cook: station boards list stations and open a board', async ({ page }) => {
    await page.goto('/v2/stations');
    // Embedded StationsPage with basePath=/v2/stations keeps navigation
    // inside the v2 tree.
    const stationLink = page.locator('a[href^="/v2/stations/"]').first();
    await expect(stationLink).toBeVisible();
    await stationLink.click();
    await expect(page).toHaveURL(/\/v2\/stations\/[^/]+/);
  });

  test('manager: command, management, analytics render with consistent location', async ({ page }) => {
    await page.goto('/v2/command?location=default');
    await expect(page.getByRole('heading', { name: 'Open the day' })).toBeVisible();

    await page.goto('/v2/management?location=default');
    await expect(page.getByRole('heading', { name: 'Check the whole house' })).toBeVisible();

    await page.goto('/v2/analytics?location=default');
    await expect(page.getByRole('heading', { name: 'Sales numbers' })).toBeVisible();
    await expect(page.locator('a[href^="/v2/management"]').first()).toBeVisible();
  });
});
