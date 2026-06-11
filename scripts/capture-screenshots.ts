import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';

const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5173';
let server: ChildProcess | undefined;

async function isReachable() {
  try {
    const response = await fetch(`${baseURL}/search`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await isReachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseURL}`);
}

async function ensureServer() {
  if (await isReachable()) return;
  server = spawn('npm', ['run', 'dev'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '5173' },
    stdio: 'inherit'
  });
  await waitForServer();
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => {
    document.querySelectorAll('.stats').forEach((element) => {
      element.textContent = element.textContent?.replace(/ in \d+(\.\d+)? ms/g, ' in 0.0 ms') ?? '';
    });
  });
  await page.screenshot({ path, fullPage: false });
  console.log(`captured ${path}`);
}

async function main() {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, viewport: { width: 1366, height: 900 } });

  await page.request.post('/api/seed');

  await page.goto('/search?q=hampton%20cove%20garage');
  await page.locator('.leaflet-container').waitFor();
  await page.waitForTimeout(1000);
  await capture(page, 'docs/screenshots/search-results.png');

  await page.getByRole('textbox', { name: 'Search' }).fill('gar');
  await page.getByRole('button', { name: /garage\s+Amenity/i }).waitFor();
  await page.getByText(/35 hits from Native PostgreSQL/i).waitFor();
  await page.getByText(/18 of 35 loaded/i).waitFor();
  await page.waitForTimeout(300);
  await capture(page, 'docs/screenshots/search-suggestions.png');

  await page.goto('/search?q=hampton%20cove%20garage');
  await page.locator('.result[data-house-id="target-hampton-cove-garage"]').click();
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor();
  await capture(page, 'docs/screenshots/hit-details.png');

  await page.goto('/search');
  const saved = page.locator('.facet-group[data-facet="saved-searches"] .facet-option').filter({ hasText: 'Waterfront home near Huntsville' });
  await saved.locator('input').check();
  await page.getByRole('button', { name: /saved: Waterfront home near Huntsville/i }).waitFor();
  await page.waitForTimeout(1000);
  await capture(page, 'docs/screenshots/saved-search-scope.png');

  await page.goto('/providers');
  await page.waitForTimeout(500);
  await capture(page, 'docs/screenshots/provider-comparison.png');

  await browser.close();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.kill('SIGTERM');
  });
