import { defineConfig } from '@playwright/test';

const port = process.env.SEARCHLAB_TEST_PORT ?? '3001';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `PORT=${port} node_modules/.bin/next start --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
