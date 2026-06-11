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

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

async function waitForSearchReady(page: Page, expected?: { loaded?: number; total?: number }) {
  await page.locator('.leaflet-container').waitFor();
  await page.locator('.leaflet-interactive').first().waitFor();
  await page.locator('#result-list-scroll').waitFor();
  await page.waitForFunction(
    ({ loaded: expectedLoaded, total: expectedTotal }) => {
      const element = document.querySelector('#result-list-scroll');
      const loaded = Number(element?.getAttribute('data-loaded-count') ?? 0);
      const total = Number(element?.getAttribute('data-total-count') ?? 0);
      if (!loaded || !total) return false;
      if (expectedLoaded !== undefined && loaded !== expectedLoaded) return false;
      if (expectedTotal !== undefined && total !== expectedTotal) return false;
      return true;
    },
    expected ?? {}
  );
}

async function main() {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL, viewport: { width: 1366, height: 900 } });

  await page.request.post('/api/seed');

  await goto(page, '/search?q=hampton%20cove%20garage');
  await waitForSearchReady(page, { loaded: 18, total: 47 });
  await capture(page, 'docs/screenshots/search-results.png');

  await page.locator('.result[data-house-id="target-hampton-cove-garage"]').click();
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor();
  await capture(page, 'docs/screenshots/hit-details.png');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor({ state: 'hidden' });

  await page.getByRole('textbox', { name: 'Search' }).fill('gar');
  await page.getByRole('button', { name: /garage\s+Amenity/i }).waitFor();
  await waitForSearchReady(page, { loaded: 18, total: 35 });
  await capture(page, 'docs/screenshots/search-suggestions.png');

  await goto(page, '/search');
  await waitForSearchReady(page);
  const saved = page.locator('.facet-group[data-facet="saved-searches"] .facet-option').filter({ hasText: 'Waterfront home near Huntsville' });
  await saved.locator('input').check();
  await page.getByRole('button', { name: /saved: Waterfront home near Huntsville/i }).waitFor();
  await waitForSearchReady(page, { loaded: 18, total: 23 });
  await capture(page, 'docs/screenshots/saved-search-scope.png');

  await goto(page, '/providers');
  await page.getByRole('heading', { name: 'Provider Comparison' }).waitFor();
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
