import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/unit/**'], // Node-only contracts run with node --test tests/unit/*.test.mjs
  timeout: 30_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: 'npm run demo:memory',
    url: 'http://127.0.0.1:5173/search',
    reuseExistingServer: !process.env.CI
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
