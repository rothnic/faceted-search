import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from '@playwright/test';

const baseURL = process.env.SCREENSHOT_BASE_URL;
const outputDir = process.env.SCREENSHOT_OUTPUT_DIR || 'docs/screenshots';

async function requireRealStack() {
  if (!baseURL) throw new Error('SCREENSHOT_BASE_URL must identify an already-running, seeded real service stack.');
  const response = await fetch(`${baseURL}/api/providers`);
  if (!response.ok) throw new Error(`Provider status failed: ${response.status}`);
  const status = await response.json();
  if (status.storageMode !== 'postgres') throw new Error('Acceptance screenshots require PostgreSQL and actual search appliances; memory demo is not accepted.');
}

const executionEvidence: unknown[] = [];
async function capture(page: Page, path: string) {
  if (await page.locator('#search-diagnostics').count()) {
    await page.waitForFunction(() => {
      try { return Boolean(JSON.parse(document.querySelector('#search-diagnostics pre')?.textContent || '{}').debug?.execution); } catch { return false; }
    });
    const diagnostic = JSON.parse((await page.locator('#search-diagnostics pre').first().textContent())!);
    const {provider,mode,q} = diagnostic.request;
    const external = ['meilisearch','typesense'].includes(provider);
    const expected = !q || mode === 'keyword' ? external ? 'external-keyword' : provider === 'pg_search' ? 'postgres-bm25' : 'postgres-fts' : external ? `external-${mode}` : mode === 'semantic' ? 'postgres-vector' : 'postgres-hybrid';
    if (diagnostic.debug?.execution !== expected) throw new Error(`Refusing ${path}: expected ${expected}, observed ${diagnostic.debug?.execution}`);
    if (diagnostic.debug?.warnings?.length) throw new Error(`Refusing ${path}: search returned warnings: ${diagnostic.debug.warnings.join('; ')}`);
    executionEvidence.push({path,request:diagnostic.request,debug:diagnostic.debug});
  }
  if (await page.locator('#result-map').isVisible()) await waitForMapTiles(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: false });
  await writeFile(`${outputDir}/native-execution-evidence.json`, JSON.stringify(executionEvidence, null, 2));
  console.log(`captured ${path}`);
}

const layoutEvidence: unknown[] = [];
async function recordLayout(page: Page) {
  layoutEvidence.push(await page.evaluate(() => {
    const list = document.querySelector('#result-list-scroll')!.getBoundingClientRect();
    const cards = [...document.querySelectorAll('.result')].map((card) => card.getBoundingClientRect());
    const top = Math.max(0,list.top), bottom = Math.min(innerHeight,list.bottom);
    return {url:location.href,viewport:{width:innerWidth,height:innerHeight},firstResultY:cards[0]?.y,
      fullyVisible:cards.filter((r)=>r.top>=top&&r.bottom<=bottom).length,
      partiallyVisible:cards.filter((r)=>r.top<bottom&&r.bottom>top).length,
      warnings:[...document.querySelectorAll('.execution-warning')].map((element)=>element.textContent),
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth};
  }));
  await writeFile(`${outputDir}/native-layout-evidence.json`, JSON.stringify(layoutEvidence, null, 2));
}

async function goto(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

async function waitForSearchReady(page: Page, expected?: { loaded?: number; total?: number }) {
  if (await page.locator('#result-map').isVisible()) {
    await page.locator('.leaflet-container').waitFor();
    await page.locator('.leaflet-interactive').first().waitFor();
  }
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
  await requireRealStack();
  await mkdir(outputDir, {recursive:true});
  const browser = await chromium.launch({ headless: process.env.SCREENSHOT_HEADED !== '1', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  try {
  const page = await browser.newPage({ baseURL, viewport: { width: 1366, height: 900 } });

  page.on('requestfailed', (request) => console.error('REQUEST FAILED', request.url(), request.failure()?.errorText));
  page.on('response', (response) => { if (response.url().includes('tile.openstreetmap.org') && !response.ok()) console.error('TILE HTTP',response.status(),response.url()); });

  await goto(page, '/search?provider=postgres_native&mode=keyword&q=garage');
  await waitForSearchReady(page);
  await capture(page, `${outputDir}/compact-desktop-search.png`);
  await recordLayout(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await goto(page, '/search?mode=keyword&q=garage');
  await waitForSearchReady(page);
  await capture(page, `${outputDir}/mobile-search.png`);
  await recordLayout(page);
  const mobileUrl = page.url();
  await page.getByRole('button', {name:'Show map',exact:true}).click();
  await waitForMapTiles(page);
  await capture(page, `${outputDir}/mobile-map.png`);
  await page.getByRole('button', {name:'Show list',exact:true}).click();
  if (page.url() !== mobileUrl) throw new Error('Map/List toggle changed the search criteria');
  await page.setViewportSize({ width: 1366, height: 900 });

  await goto(page, '/search?mode=keyword&q=hampton%20cove%20garage');
  await waitForSearchReady(page);
  await page.locator('.facet-group[data-facet="saved-searches"] input').first().waitFor();
  await capture(page, `${outputDir}/search-results.png`);

  await page.locator('.result[data-house-id="target-hampton-cove-garage"]').click();
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor();
  await capture(page, `${outputDir}/hit-details.png`);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: /Hampton Cove garage home/i }).waitFor({ state: 'hidden' });

  // Meilisearch's native keyword prefix matching supplies real results for 'gar'.
  // PostgreSQL English FTS correctly does not treat this as a prefix query.
  await goto(page, '/search?provider=meilisearch&mode=keyword&q=garage');
  await waitForSearchReady(page);
  const suggestionsSearch = page.waitForResponse((response) => response.url().endsWith('/api/search') && response.request().postDataJSON()?.q === 'gar' && response.ok());
  await page.getByRole('textbox', { name: 'Search' }).fill('gar');
  await suggestionsSearch;
  await page.getByRole('button', { name: /garage\s+Amenity/i }).waitFor();
  await waitForSearchReady(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  const inputBox = await page.getByRole('textbox', { name: 'Search' }).boundingBox();
  const suggestionBox = await page.locator('#search-suggestions').boundingBox();
  if (!inputBox || inputBox.y < 0 || !suggestionBox || suggestionBox.y < inputBox.y || suggestionBox.y + suggestionBox.height > 900) throw new Error('Suggestions screenshot must include the input and suggestion menu in the viewport');
  await capture(page, `${outputDir}/search-suggestions.png`);

  await goto(page, '/search?mode=keyword');
  await waitForSearchReady(page);
  const saved = page.locator('.facet-group[data-facet="saved-searches"] .facet-option').filter({ hasText: 'Waterfront home near Huntsville' });
  await saved.locator('input').check();
  await page.getByRole('button', { name: /saved: Waterfront home near Huntsville/i }).waitFor();
  await waitForSearchReady(page);
  await capture(page, `${outputDir}/saved-search-scope.png`);

  for (const {provider,mode,q} of [
    {provider:'postgres_native',mode:'semantic',q:'effortless upkeep condominium beside eateries'},
    {provider:'pg_search',mode:'keyword',q:'garage'},
    {provider:'meilisearch',mode:'semantic',q:'effortless upkeep condominium beside eateries'},
    {provider:'typesense',mode:'hybrid',q:'garage'}
  ]) {
    await goto(page, `/search?${new URLSearchParams({provider,mode,q})}`);
    await waitForSearchReady(page);
    await capture(page, `${outputDir}/native-${provider}.png`);
  }

  await goto(page, '/providers');
  await page.getByRole('heading', { name: 'Provider Comparison' }).waitFor();
  await capture(page, `${outputDir}/provider-comparison.png`);

  await goto(page, '/system');
  await page.getByRole('heading', { name: 'External indexes' }).waitFor();
  await capture(page, `${outputDir}/system-status.png`);
  await page.locator('#embedding-pipeline').getByText('Durable PostgreSQL queue', {exact:true}).waitFor();
  await page.locator('#embedding-pipeline').screenshot({path:`${outputDir}/embedding-pipeline.png`});
  await goto(page, '/schema');
  await page.locator('#schema-count').waitFor();
  await capture(page, `${outputDir}/schema-explorer.png`);

  } finally { await browser.close(); }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
