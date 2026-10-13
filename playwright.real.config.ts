import { defineConfig, devices } from '@playwright/test';
if (!process.env.DEMO_URL || process.env.FACETED_OWNED_API !== '1') throw new Error('Set DEMO_URL to the owned, seeded real comparison stack.');
export default defineConfig({
  testDir: './tests-real', outputDir: 'test-results/browser-native', timeout: 60_000, expect: { timeout: 15_000 }, workers: 1,
  use: { baseURL: process.env.DEMO_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium-real-services', use: { ...devices['Desktop Chrome'] } }]
});
