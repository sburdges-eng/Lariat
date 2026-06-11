import { test, expect } from '@playwright/test';

const PIN = process.env.LARIAT_PIN || '1234';

test.describe('Gold-stars optimistic delete', () => {
  const COOK = '__E2E_GoldStarCook_' + Date.now();

  // DELETE /api/gold-stars/[id] is PIN-gated (requirePin). Authenticate the
  // context up front so the browser's fetch carries lariat_pin_ok — without
  // it the optimistic removal correctly rolls back on the 401.
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/auth/pin', { data: { pin: PIN } });
    expect(res.ok()).toBe(true);
  });

  test('delete removes row optimistically, row stays gone after server confirms', async ({ page }) => {
    // Create a gold star via API first
    const createRes = await page.request.post('/api/gold-stars', {
      data: { cook_name: COOK, reason: 'E2E test', stars: 2 },
    });
    expect(createRes.ok()).toBe(true);
    const { id } = await createRes.json();
    expect(id).toBeTruthy();

    // Navigate to page
    await page.goto('/gold-stars');
    await page.waitForLoadState('networkidle');

    // Verify our entry is visible
    const card = page.locator(`text=${COOK}`);
    await expect(card).toBeVisible({ timeout: 5000 });

    // Click the Remove button on our entry and accept the confirmation.
    const row = page.locator('.gs-row', { hasText: COOK });
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Remove this Gold Star');
      await dialog.accept();
    });
    const deleteBtn = row.getByRole('button', { name: 'Remove' });
    await deleteBtn.click();

    // Row should disappear immediately (optimistic)
    await expect(card).not.toBeVisible({ timeout: 3000 });

    // Wait for server roundtrip to settle
    await page.waitForTimeout(1000);

    // Refresh — row should still be gone (server confirmed)
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator(`text=${COOK}`)).not.toBeVisible({ timeout: 3000 });
  });

  test('create + view in leaderboard', async ({ page }) => {
    const cook2 = '__E2E_LeaderCook_' + Date.now();
    await page.request.post('/api/gold-stars', {
      data: { cook_name: cook2, reason: 'Leaderboard test', stars: 3 },
    });

    await page.goto('/gold-stars');
    await page.waitForLoadState('networkidle');

    // Switch to leaderboard view
    await page.locator('button:has-text("Leaderboard")').click();

    // Should show the cook with star count — scope to this cook's row;
    // leftover rows from other runs may carry the same star total.
    const lbRow = page.locator('.gs-lb-row', { hasText: cook2 });
    await expect(lbRow).toBeVisible({ timeout: 5000 });
    await expect(lbRow.locator('text=3 ★')).toBeVisible();

    // Clean up
    const listRes = await page.request.get('/api/gold-stars');
    const stars = await listRes.json();
    for (const s of stars) {
      if (s.cook_name.startsWith('__E2E_')) {
        await page.request.delete(`/api/gold-stars/${s.id}`);
      }
    }
  });
});
