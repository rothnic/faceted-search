import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  webServer: {
    command: 'npm run web:build && PORT=5189 npm run test:fixture-server',
    url: 'http://127.0.0.1:5189/search',
    reuseExistingServer: false
  },
  use: {
    baseURL: 'http://127.0.0.1:5189',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
