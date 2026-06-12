import { test, expect } from '@playwright/test';

const PIN = process.env.LARIAT_PIN || '1234';

test('shows surfaces — login → booking → playbook → archive', async ({ page }) => {
  // Log in via PIN. Wait for the auth POST to land before navigating —
  // the form sets lariat_pin_ok via fetch, and a goto issued before the
  // response arrives races the cookie and bounces back to the gate.
  await page.goto('/login-pin');
  await page.fill('input[name="pin"]', PIN);
  const authResponse = page.waitForResponse(
    (r) => r.url().includes('/api/auth/pin') && r.request().method() === 'POST',
  );
  await page.click('button[type="submit"]');
  expect((await authResponse).ok()).toBe(true);

  // Booking.
  await page.goto('/booking');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/calendar/i);

  // Click first artist link → playbook. Match on the playbook href —
  // text-based filters also catch chrome like the a11y skip-link.
  const firstLink = page.locator('a[href*="/playbook?show="]').first();
  if (await firstLink.count()) {
    await firstLink.click();
    await expect(page).toHaveURL(/\/playbook\?show=\d+/);
  }

  // Archive. Assert the page heading — bare getByText also matches the
  // "Past shows" nav link and trips strict mode.
  await page.goto('/shows/archive');
  await expect(page.getByRole('heading', { name: /past/i })).toBeVisible();
});
