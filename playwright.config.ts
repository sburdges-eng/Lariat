import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

// Specs read LARIAT_PIN to drive login flows (shows.spec.ts, gold-stars.spec.ts).
// Next.js loads .env.local into the server on its own, but the Playwright
// process does not — without this the specs fall back to a placeholder PIN
// and every auth-gated flow fails.
dotenv.config({ path: '.env.local' });

// Allow LARIAT_E2E_PORT to override the dev-server port for runs against an
// alternate localhost. Useful when port 3000 is held by another process
// (an MCP server, another Next.js instance, etc.). Defaults to 3000 to
// preserve the historical command shape (`npm run test:e2e`).
const PORT = Number(process.env.LARIAT_E2E_PORT) || 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `next dev -H 0.0.0.0 -p ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
