import { test, expect } from '@playwright/test';

const E2E_NAME = '__E2E_TestOven_' + Date.now();
const PAST_WARRANTY = '2024-06-15';

test.describe('Equipment warranty UI', () => {
  test('add equipment with past warranty shows expired flag', async ({ page }) => {
    await page.goto('/equipment');
    await page.waitForLoadState('networkidle');

    // Open the add form
    await page.locator('button:has-text("Add Equipment")').click();

    // Fill required fields
    await page.locator('input[placeholder*="Rational"]').fill(E2E_NAME);
    await page.locator('input[type="number"]').fill('5000');

    // Fill warranty with a past date
    const warrantyInput = page.locator('input[type="date"]').last();
    await warrantyInput.fill(PAST_WARRANTY);

    // Submit
    await page.locator('button[type="submit"]:has-text("Save")').click();

    // Wait for form to close (success state)
    await expect(page.locator('input[placeholder*="Rational"]')).not.toBeVisible({ timeout: 5000 });

    // The row should render with warranty + expired marker
    const row = page.locator('.card', { hasText: E2E_NAME });
    await expect(row).toBeVisible();
    await expect(row.locator('text=Warranty:')).toBeVisible();
    await expect(row.locator('text=expired')).toBeVisible();

    // The "expired" text should be styled red
    const expiredEl = row.locator(':text("expired")').first();
    const color = await expiredEl.evaluate((el) => getComputedStyle(el).color);
    // var(--red) resolves to some red — just ensure it's not the default text color
    expect(color).not.toBe('rgb(241, 245, 249)'); // --text color
  });

  test('warranty in the future does not show expired', async ({ page }) => {
    await page.goto('/equipment');
    await page.waitForLoadState('networkidle');

    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    const futureISO = futureDate.toISOString().split('T')[0]!;

    const futureName = '__E2E_FutureWarranty_' + Date.now();

    await page.locator('button:has-text("Add Equipment")').click();
    await page.locator('input[placeholder*="Rational"]').fill(futureName);
    await page.locator('input[type="number"]').fill('3000');
    const warrantyInput = page.locator('input[type="date"]').last();
    await warrantyInput.fill(futureISO);
    await page.locator('button[type="submit"]:has-text("Save")').click();
    await expect(page.locator('input[placeholder*="Rational"]')).not.toBeVisible({ timeout: 5000 });

    const row = page.locator('.card', { hasText: futureName });
    await expect(row).toBeVisible();
    await expect(row.locator('text=Warranty:')).toBeVisible();
    await expect(row.locator('text=expired')).not.toBeVisible();
  });
});
