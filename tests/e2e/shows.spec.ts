import { test, expect } from '@playwright/test';

const PIN = process.env.LARIAT_PIN || '1234';

test('shows surfaces — login → booking → playbook → archive', async ({ page }) => {
  // Log in via PIN.
  await page.goto('/login-pin');
  await page.fill('input[name="pin"]', PIN);
  await page.click('button[type="submit"]');

  // Booking.
  await page.goto('/booking');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/calendar/i);

  // Click first artist link → playbook.
  const firstLink = page.getByRole('link').filter({ hasText: /^[a-z]/i }).first();
  if (await firstLink.count()) {
    await firstLink.click();
    await expect(page).toHaveURL(/\/playbook\?show=\d+/);
  }

  // Archive.
  await page.goto('/shows/archive');
  await expect(page.getByText(/past/i)).toBeVisible();
});
