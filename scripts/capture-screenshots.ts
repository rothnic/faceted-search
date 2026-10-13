import { mkdir, writeFile } from 'node:fs/promises';
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
    env: { ...process.env, HOST: '127.0.0.1', PORT: new URL(baseURL).port || '5173' },
    stdio: 'inherit'
  });
  await waitForServer();
}

async function capture(page: Page, path: string) {
  if (await page.locator('#result-map').count()) await waitForMapTiles(page);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
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

async function waitForMapTiles(page: Page) {
  try {
    await page.waitForFunction(() => {
      const map = document.querySelector<HTMLElement>('#result-map');
      const tiles = [...(map?.querySelectorAll<HTMLImageElement>('.leaflet-tile-container img') ?? [])];
      return map?.dataset.mapState === 'ready' && tiles.length > 0 && tiles.every((tile) => tile.complete && tile.naturalWidth > 0 && Number(getComputedStyle(tile).opacity) >= .99);
    }, undefined, { timeout: 20_000 });
  } catch (error) {
    await mkdir('test-results', { recursive: true });
    const diagnostic = await page.evaluate(() => ({
      url: location.href,
      state: document.querySelector<HTMLElement>('#result-map')?.dataset,
      tiles: [...document.querySelectorAll<HTMLImageElement>('.leaflet-tile-container img')].map((tile) => ({src: tile.currentSrc, complete: tile.complete, width: tile.naturalWidth, opacity: getComputedStyle(tile).opacity})),
      message: document.querySelector('.map-feedback')?.textContent
    }));
    await writeFile('test-results/map-readiness.json', JSON.stringify(diagnostic, null, 2));
    await page.screenshot({path:'test-results/map-readiness-failure.png', fullPage:true});
    throw new Error(`Map tiles did not load; diagnostics: test-results/map-readiness.json. ${String(error)}`);
  }
}

async function main() {
  await ensureServer();
  const browser = await chromium.launch({ headless: process.env.SCREENSHOT_HEADED !== '1', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1366, height: 900 } });

  page.on('requestfailed', (request) => console.error('REQUEST FAILED', request.url(), request.failure()?.errorText));
  page.on('response', (response) => { if (response.url().includes('tile.openstreetmap.org') && !response.ok()) console.error('TILE HTTP',response.status(),response.url()); });
  await page.request.post('/api/seed');

  await goto(page, '/search?mode=keyword&q=hampton%20cove%20garage');
  await waitForSearchReady(page, { loaded: 18, total: 47 });
  await page.locator('.facet-group[data-facet="saved-searches"] input').first().waitFor();
  await page.locator('#system-summary').getByText('CPU model ready', {exact:true}).waitFor();
  await capture(page, 'docs/screenshots/search-results.png');

  await page.locator('.result[data-house-id="target-hampton-cove-garage"]').click();
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor();
  await capture(page, 'docs/screenshots/hit-details.png');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor({ state: 'hidden' });

  await page.getByRole('textbox', { name: 'Search' }).fill('gar');
  await page.getByRole('button', { name: /garage\s+Amenity/i }).waitFor();
  await waitForSearchReady(page, { loaded: 18, total: 35 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const inputBox = await page.getByRole('textbox', { name: 'Search' }).boundingBox();
  const suggestionBox = await page.locator('#search-suggestions').boundingBox();
  if (!inputBox || inputBox.y < 0 || !suggestionBox || suggestionBox.y < inputBox.y || suggestionBox.y + suggestionBox.height > 900) throw new Error('Suggestions screenshot must include the input and suggestion menu in the viewport');
  await capture(page, 'docs/screenshots/search-suggestions.png');

  await goto(page, '/search?mode=keyword');
  await waitForSearchReady(page);
  const saved = page.locator('.facet-group[data-facet="saved-searches"] .facet-option').filter({ hasText: 'Waterfront home near Huntsville' });
  await saved.locator('input').check();
  await page.getByRole('button', { name: /saved: Waterfront home near Huntsville/i }).waitFor();
  await waitForSearchReady(page);
  await capture(page, 'docs/screenshots/saved-search-scope.png');

  await goto(page, '/providers');
  await page.getByRole('heading', { name: 'Provider Comparison' }).waitFor();
  await capture(page, 'docs/screenshots/provider-comparison.png');

  await goto(page, '/system');
  await page.getByRole('heading', { name: 'External indexes' }).waitFor();
  await capture(page, 'docs/screenshots/system-status.png');
  await goto(page, '/schema');
  await page.locator('#schema-count').waitFor();
  await capture(page, 'docs/screenshots/schema-explorer.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, '/search?mode=keyword&q=garage');
  await waitForSearchReady(page);
  await capture(page, 'docs/screenshots/mobile-search.png');

  } finally { await browser.close(); }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server?.kill('SIGTERM');
  });
