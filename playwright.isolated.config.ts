import { defineConfig } from '@playwright/test';

// Static frontend component checks: no app server, provider, seed or preview access.
export default defineConfig({
  testDir: './tests/isolated', workers: 1, timeout: 15000,
  use: { browserName: 'chromium', launchOptions: {
    chromiumSandbox: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
  } }
});
