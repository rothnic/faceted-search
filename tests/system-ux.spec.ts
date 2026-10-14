import { expect, test } from '@playwright/test';
import { describeSchema, DATABASE_SCHEMA_SQL } from '../apps/api/src/schema.js';

const model = { model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, dtype: 'q8', device: 'cpu', state: 'ready', cachedTexts: 12, activeBatches: 0, computedTexts: 12 };
const sync = { storageMode: 'memory', observedAt: '2026-10-13T18:00:00Z', outboxPendingCount: 0, providers: { meilisearch: { documentsIndexed: 0, documentsDeleted: 0, backfillStatus: 'not_started' }, typesense: { documentsIndexed: 0, documentsDeleted: 0, backfillStatus: 'not_started' } }, outbox: [] };

test.beforeEach(async ({ request }) => { await request.post('/api/seed'); });

test('declared schema matches the single initialization source, including relationships and indexes', async ({ request }) => {
  const response = await request.get('/api/schema');
  expect(response.ok()).toBeTruthy();
  const schema = await response.json();
  expect(schema.liveIntrospection).toBe(false);
  expect(schema.source).toBe('application-ddl');
  expect(schema.tables).toEqual(describeSchema('memory').tables);
  expect(schema.tables).toHaveLength(describeSchema('memory').tables.length);
  expect(schema.tables.some((table: {name: string}) => table.name === 'house_embeddings')).toBe(true);
  for (const table of schema.tables) expect(DATABASE_SCHEMA_SQL).toContain(table.ddl);
  const houses = schema.tables.find((table: {name: string}) => table.name === 'houses');
  expect(houses.columns.find((column: {name: string}) => column.name === 'city_id').reference).toBe('cities.id');
  expect(houses.indexes).toHaveLength(5);
  expect(schema.tables.find((table: {name: string}) => table.name === 'house_amenities').columns.every((column: {primaryKey: boolean}) => column.primaryKey)).toBe(true);
  expect(houses.columns.some((column: {name: string}) => column.name === 'embedding')).toBe(false);
});

test('schema explorer searches fields and supports keyboard disclosure, empty state, and recovery', async ({ page }) => {
  await page.goto('/schema');
  await expect(page.getByRole('heading', { name: 'Schema explorer' })).toBeVisible();
  await expect(page.getByText('Application DDL · not live introspection')).toBeVisible();
  await expect(page.locator('#schema-count')).toHaveText(`${describeSchema('memory').tables.length} of ${describeSchema('memory').tables.length} declared tables`);
  await page.getByLabel('Find a table or field').fill('city_id');
  await expect(page.locator('#schema-count')).toHaveText(`2 of ${describeSchema('memory').tables.length} declared tables`);
  await expect(page.getByText('→ cities.id').first()).toBeVisible();
  await page.getByLabel('Find a table or field').fill('not-a-field');
  await expect(page.getByText('No declared table or field matches. Try a shorter name.')).toBeVisible();
  await page.getByLabel('Find a table or field').clear();
  const cities = page.locator('.schema-table').filter({ has: page.locator('summary strong', { hasText: /^cities$/ }) });
  await cities.locator('summary').first().focus(); await page.keyboard.press('Enter');
  await expect(cities).toHaveAttribute('open', '');
  await page.keyboard.press('Enter'); await expect(cities).not.toHaveAttribute('open', '');
});

test('system status distinguishes simulated recorded state from model readiness and inference', async ({ page }) => {
  await page.route('**/api/embeddings', (route) => route.fulfill({ json: { ...model, activeBatches: 2 } }));
  await page.route('**/api/sync/status', (route) => route.fulfill({ json: sync }));
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: 'In-memory demo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Computing embeddings' })).toBeVisible();
  await expect(page.getByText(/counters do not indicate documents in a real search engine/)).toBeVisible();
  await expect(page.getByText(/This demo has no durable worker/)).toBeVisible();
  await expect(page.getByText(/not a backfill completion percentage/)).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('model loading reports only measured per-file download progress and failed status is unknown', async ({ page }) => {
  let fail = false;
  await page.route('**/api/embeddings', (route) => route.fulfill(fail ? { status: 503, json: { error: 'Model status offline' } } : { json: { ...model, state: 'loading', progress: { file: 'model_quantized.onnx', loaded: 10, total: 100 } } }));
  await page.route('**/api/sync/status', (route) => route.fulfill({ status: 503, json: { error: 'Sync offline' } }));
  await page.goto('/system');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '10');
  await expect(page.getByText(/10% of this file/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Storage unknown' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Sync offline');
  fail = true; await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('heading', { name: 'CPU model status unavailable' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('saved evaluation never blocks search and failed counts stay unknown', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/saved-searches', async (route) => { await gate; await route.fulfill({ json: { savedSearches: [{ id: 'failed-count', name: 'Offline saved count', currentHitCount: null, evaluationError: 'Model unavailable' }] } }); });
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible();
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.getByText('Evaluating saved searches…')).toBeVisible();
  const range = page.locator('[data-range="minPrice"]');
  await range.fill('250000');
  release();
  const option = page.locator('.facet-option', { hasText: 'Offline saved count' });
  await expect(option.locator('.count')).toHaveText('?');
  await expect(option.locator('.count')).toHaveAttribute('title', 'Model unavailable');
  await expect(range).toHaveValue('250000');
  await expect(range).toBeFocused();
});

test('semantic error is escaped, preserves query, and permits keyword recovery', async ({ page }) => {
  await page.route('**/api/search', async (route) => {
    if (route.request().postDataJSON().mode !== 'keyword') return route.fulfill({ status: 503, json: { error: '<img src=x onerror=alert(1)> model unavailable' } });
    await route.continue();
  });
  await page.goto('/search?mode=semantic&q=garage');
  await expect(page.getByRole('alert')).toContainText('<img src=x');
  await expect(page.locator('#search-results img')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue('garage');
  await page.getByRole('button', { name: 'Use keyword search' }).click();
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.getByLabel('Mode', { exact: true })).toHaveValue('keyword');
});

test('a late search response cannot replace a newer result', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/search', async (route) => {
    if (route.request().postDataJSON().q === 'garage') { const response = await route.fetch(); await gate; return route.fulfill({ response }); }
    await route.continue();
  });
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.getByText(/Searching… Semantic searches/)).toBeVisible();
  const latestResponse = page.waitForResponse(response => response.url().endsWith('/api/search') && response.request().postDataJSON()?.q === 'condo');
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('condo');
  const latest = await (await latestResponse).json();
  await expect(page.locator('.result').first()).toHaveAttribute('data-house-id', latest.hits[0].id);
  await expect(page.locator('.result-total')).toHaveText(String(latest.totalHits));
  await expect(page.getByRole('button', { name: /q: condo/ })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: /q: garage/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toHaveValue('condo');
  await expect(page.locator('.result').first()).toHaveAttribute('data-house-id', latest.hits[0].id);
  await expect(page.locator('.result-total')).toHaveText(String(latest.totalHits));
});

test('sync action has a single in-flight request and an explicit recoverable failure', async ({ page }) => {
  let count = 0; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/sync/status', (route) => route.fulfill({ json: sync }));
  await page.route('**/api/embeddings', (route) => route.fulfill({ json: model }));
  await page.route('**/api/sync/backfill', async (route) => { count++; await gate; await route.fulfill({ status: 500, json: { error: 'Index unavailable' } }); });
  await page.goto('/system');
  await page.getByRole('button', { name: 'Simulate meilisearch backfill' }).click();
  await expect(page.getByRole('button', { name: 'Simulate meilisearch backfill' })).toBeDisabled();
  await expect(page.getByText(/running in this browser request/)).toBeVisible();
  expect(count).toBe(1); release();
  await expect(page.getByRole('alert')).toContainText('Index unavailable');
  await expect(page.getByRole('button', { name: 'Simulate meilisearch backfill' })).toBeEnabled();
});

test('mobile navigation and filter disclosure are usable without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/search?mode=keyword');
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.locator('#search-filters')).toBeHidden();
  await page.getByRole('button', { name: 'Show or hide filters' }).click();
  await expect(page.locator('#search-filters')).toBeVisible();
  await page.locator('[data-filter="city"]').first().check();
  await expect(page.locator('.refinement-pill')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('.refinement-pill')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show results', exact: true }).click();
  await expect(page.locator('#search-filters')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Schema', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Schema explorer' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toBeVisible();
});


test('direct adapters show a recoverable engine failure rather than blank results', async ({ page }) => {
  await page.route('http://127.0.0.1:8108/**', (route) => route.fulfill({ status: 503, json: { message: 'Test engine offline' } }));
  await page.goto('/search/instant/typesense');
  await expect(page.getByRole('alert')).toContainText('Direct search engine unavailable');
  await expect(page.getByRole('button', { name: 'Retry direct search' })).toBeVisible();
  await page.getByRole('link', { name: 'Use the main search' }).click();
  await expect(page.locator('#result-list-scroll')).toBeVisible();
});

test('failed infinite pagination stops retrying and can resume explicitly', async ({ page }) => {
  let fail = true; let failedRequests = 0;
  await page.route('**/api/search', (route) => {
    if (route.request().postDataJSON().page > 1 && fail) { failedRequests++; return route.fulfill({ status: 503, json: { error: 'Page temporarily unavailable' } }); }
    return route.continue();
  });
  await page.goto('/search?mode=keyword&q=garage');
  const scroller = page.locator('#result-list-scroll');
  await expect(scroller).toBeVisible();
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('[data-virtual-summary]')).toContainText('Could not load more');
  expect(failedRequests).toBe(1);
  fail = false;
  await page.getByRole('button', { name: 'Retry more results' }).click();
  await expect(scroller).toHaveAttribute('data-loaded-count', '35');
});


test('status polling preserves keyboard focus on disclosure, schema links and search actions', async ({ page }) => {
  await page.clock.install();
  let snapshots = 0;
  await page.route('**/api/embeddings', (route) => route.fulfill({ json: model }));
  await page.route('**/api/sync/status', (route) => { snapshots++; return route.fulfill({ json: sync }); });
  await page.goto('/system');
  const summary = page.locator('#system-raw-summary');
  await summary.click();
  await summary.focus();
  let previous = snapshots;
  await page.clock.fastForward(11000);
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(summary).toBeFocused();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
  const schemaLink = page.locator('#system-schema-link');
  await schemaLink.focus(); previous = snapshots;
  await page.clock.fastForward(11000);
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(schemaLink).toBeFocused();
  await page.goto('/search?mode=keyword');
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await page.locator('#system-info-toggle').click();
  const searchLink = page.locator('#summary-schema-link');
  await searchLink.focus(); previous = snapshots;
  await page.clock.fastForward(11000);
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(searchLink).toBeFocused();
  await expect(page.locator('#system-info')).toHaveAttribute('open','');
  await expect(page.locator('#result-info [data-virtual-summary]')).toBeVisible();
  await page.locator('#diagnostics-toggle').click();
  const backfill = page.locator('#debug-backfill-meili');
  await backfill.focus(); previous = snapshots;
  await page.clock.fastForward(11000);
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(backfill).toBeFocused();
  const debugLink = page.locator('#debug-system-link');
  await debugLink.focus(); previous = snapshots;
  await page.clock.fastForward(11000);
  await expect.poll(() => snapshots).toBeGreaterThan(previous);
  await expect(debugLink).toBeFocused();
});

test('map tile failures stay explicit while listing markers remain usable', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort('failed'));
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('#result-map')).toHaveAttribute('data-map-state', 'error');
  await expect(page.locator('.map-feedback')).toContainText('Map tiles unavailable');
  await expect(page.locator('.leaflet-interactive').first()).toBeVisible();
  await expect(page.getByRole('heading', {name: /Waterfront home near Huntsville/}).first()).toBeVisible();
});

test('suggestions retain a visible search input and desktop diagnostics start collapsed', async ({ page }) => {
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('#search-diagnostics')).not.toHaveAttribute('open');
  await expect(page.locator('#toggle-filters')).toBeHidden();
  const input = page.getByRole('textbox', {name:'Search'});
  await input.fill('gar');
  await expect(page.getByRole('button', {name:/garage\s+Amenity/i})).toBeVisible();
  await expect(page.locator('.suggestion-source')).toHaveText('Catalog, saved searches and current listings');
  const boxes = await page.evaluate(() => ['#search-box','#search-suggestions'].map((selector) => {
    const r = document.querySelector(selector)!.getBoundingClientRect();
    return {top:r.top,bottom:r.bottom};
  }));
  expect(boxes[0].top).toBeGreaterThan(0);
  expect(boxes[1].top).toBeGreaterThanOrEqual(boxes[0].bottom);
  expect(boxes[1].bottom).toBeLessThanOrEqual(900);
});

test('small muted text meets WCAG AA contrast against its rendered background', async ({ page }) => {
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('.result-description').first()).toBeVisible();
  const ratios = await page.evaluate(() => {
    const luminance = (channels: number[]) => {
      const linear=channels.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
      return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
    };
    return [['.system-strip','body'], ['.count','#search-filters .panel'], ['.result-description','.result'], ['.hit-chip > .badge','.hit-chip > .badge']].map(([text,background]) => {
      const context=document.createElement('canvas').getContext('2d')!;
      context.fillStyle='#fff'; context.fillRect(0,0,1,1);
      const ancestors:Element[]=[];
      for(let element:Element|null=document.querySelector(background);element;element=element.parentElement) ancestors.unshift(element);
      for(const element of ancestors) { context.fillStyle=getComputedStyle(element).backgroundColor; context.fillRect(0,0,1,1); }
      const bg=luminance([...context.getImageData(0,0,1,1).data]);
      context.fillStyle=getComputedStyle(document.querySelector(text)!).color; context.fillRect(0,0,1,1);
      const fg=luminance([...context.getImageData(0,0,1,1).data]);
      return {selector:text,ratio:(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)};
    });
  });
  for (const {selector,ratio} of ratios) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
});
