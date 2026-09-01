import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests for the access boundary.
 *
 * Run against the production build rather than `next dev`. The proxy, static
 * generation and caching all behave differently in development, and the boundary
 * is exactly the sort of thing that could pass in dev and fail in production.
 */
export default defineConfig({
  testDir: './e2e',
  // A boundary test that passes because of a race is worse than no test.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // `next start` serves the production build. Locally an already-running
    // server is reused so the suite does not rebuild on every invocation.
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
