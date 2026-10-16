import { expect, test } from '@playwright/test';

const searchResult = {
  provider: 'postgres_native',
  providerLabel: 'Native PostgreSQL',
  hits: [{
    id: 'house-1', title: 'Hampton Cove home with mountain views', description: 'A welcoming home with a garage and fenced yard.',
    price: 525000, bedrooms: 4, bathrooms: 3, squareFeet: 3100, lat: 34.73, lng: -86.58,
    city: 'Huntsville', neighborhood: 'Hampton Cove', propertyType: 'single_family', listingStatus: 'active', amenities: ['garage', 'fenced_yard']
  }],
  mapHits: [{ id: 'house-1', title: 'Hampton Cove home with mountain views', price: 525000, lat: 34.73, lng: -86.58, city: 'Huntsville', neighborhood: 'Hampton Cove', propertyType: 'single_family', listingStatus: 'active' }],
  totalHits: 1, totalInventory: 1240, page: 1, pageSize: 18,
  facets: { city: [{ value: 'Huntsville', count: 1 }], bedrooms: [{ value: '4', count: 1 }], amenities: [{ value: 'garage', count: 1 }, { value: 'fenced_yard', count: 1 }] },
  processingTimeMs: 3
};

test('mobile uses the same filter state and keeps query and facet chips independent', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/search', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    await route.fulfill({ json: { ...searchResult, hits: body.mapOnly ? [] : searchResult.hits, page: Number(body.page ?? 1) } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?provider=postgres_native&mode=keyword&q=garage');

  await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
  await expect(page.getByText('1 of 1,240')).toBeVisible();
  await expect(page.getByRole('button', { name: /Filters \(0\)/ })).toBeVisible();
  await expect(page.locator('.map-canvas')).toHaveCount(0);
  await expect.poll(() => bodies.some((body) => body.q === 'garage' && body.mapOnly === false)).toBe(true);
  expect(bodies.every((body) => body.provider === 'postgres_native' && body.mode === 'keyword')).toBe(true);

  await page.getByRole('button', { name: /Filters/ }).click();
  await expect(page.getByRole('dialog', { name: 'Refine results' })).toBeVisible();
  await page.getByLabel('garage', { exact: false }).check();
  await expect(page.getByRole('button', { name: 'Remove Amenities: Garage' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Filters \(1\)/ })).toBeVisible();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Clear search query' }).click();
  await expect(page.getByRole('button', { name: 'Remove Amenities: Garage' })).toBeVisible();
  await expect(page.locator('input[type="search"]')).toHaveValue('');
});

test('map JavaScript and map payload load only after opening the map', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  const mapChunks: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/_next/static/') && request.url().endsWith('.js')) mapChunks.push(request.url());
  });
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/search', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    await route.fulfill({ json: { ...searchResult, hits: body.mapOnly ? [] : searchResult.hits } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Homes' })).toBeVisible();
  await expect.poll(() => bodies.some((body) => body.mapOnly === false)).toBe(true);
  expect(bodies.some((body) => body.mapOnly === true)).toBe(false);
  expect(mapChunks.some((url) => /map-panel|leaflet/i.test(url))).toBe(false);
  const initialChunkCount = mapChunks.length;

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.map-canvas')).toBeVisible();
  await expect.poll(() => bodies.some((body) => body.mapOnly === true)).toBe(true);
  expect(mapChunks.length).toBeGreaterThan(initialChunkCount);
});

for (const width of [320, 375, 390, 768, 1024, 1280, 1440]) {
  test(`responsive shell aligns and has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.route('**/api/search', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { ...searchResult, hits: body.mapOnly ? [] : searchResult.hits } });
    });
    await page.setViewportSize({ width, height: 820 });
    await page.goto('/');
    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page.getByTestId('results-heading')).toBeVisible();
    await expect(page.getByTestId('results-count')).toHaveText('1 of 1,240');
    await expect(page.getByTestId('save-search')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `document overflow at ${width}px`).toBeLessThanOrEqual(1);
    const [heading, count, save] = await Promise.all([
      page.getByTestId('results-heading').boundingBox(),
      page.getByTestId('results-count').boundingBox(),
      page.getByTestId('save-search').boundingBox()
    ]);
    expect(heading).not.toBeNull();
    expect(count).not.toBeNull();
    expect(save).not.toBeNull();
    const centerY = (box: { y: number; height: number } | null) => box!.y + box!.height / 2;
    expect(Math.abs(centerY(heading) - centerY(count))).toBeLessThanOrEqual(4);
    expect(Math.abs(centerY(heading) - centerY(save))).toBeLessThanOrEqual(4);
  });
}

test('search response does not move shell anchors or create measurable CLS', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.addInitScript(() => {
    const target = window as Window & { __searchlabShifts?: number[] };
    target.__searchlabShifts = [];
    if (!PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) return;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) target.__searchlabShifts!.push(shift.value);
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.route('**/api/search', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (!body.mapOnly) await gate;
    await route.fulfill({ json: { ...searchResult, hits: body.mapOnly ? [] : searchResult.hits } });
  });
  await page.setViewportSize({ width: 375, height: 820 });
  await page.goto('/');
  await expect(page.locator('.result-skeletons')).toBeVisible();
  const anchors = async () => Promise.all([
    page.getByTestId('search-toolbar').boundingBox(),
    page.getByTestId('results-heading').boundingBox(),
    page.getByTestId('results-count').boundingBox(),
    page.getByTestId('save-search').boundingBox()
  ]);
  const before = await anchors();
  release();
  await expect(page.locator('[data-house-id="house-1"]')).toBeVisible();
  const after = await anchors();
  for (let i = 0; i < before.length; i += 1) {
    expect(before[i]).not.toBeNull();
    expect(after[i]).not.toBeNull();
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(Math.abs(after[i]![key] - before[i]![key]), `anchor ${i} ${key}`).toBeLessThanOrEqual(4);
    }
  }
  await page.waitForTimeout(250);
  const shifts = await page.evaluate(() => (window as Window & { __searchlabShifts?: number[] }).__searchlabShifts ?? []);
  expect(shifts.reduce((total, value) => total + value, 0)).toBeLessThanOrEqual(0.01);
});

test('Back and Forward restore query, facets and provider settings', async ({ page }) => {
  await page.route('**/api/search', (route) => route.fulfill({ json: searchResult }));
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.goto('/search?q=garage');
  await expect(page.locator('[data-house-id="house-1"]')).toBeVisible();
  await page.getByLabel('garage', { exact: false }).check();
  await expect(page).toHaveURL(/amenities=garage/);
  await page.getByRole('button', { name: 'Clear search query' }).click();
  await expect(page.getByTestId('search-input')).toHaveValue('');
  await page.goBack();
  await expect(page.getByTestId('search-input')).toHaveValue('garage');
  await expect(page.getByRole('button', { name: 'Remove Amenities: Garage' })).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('search-input')).toHaveValue('garage');
  await expect(page.getByRole('button', { name: 'Remove Amenities: Garage' })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Remove Amenities: Garage' })).toBeVisible();
});

test('desktop also defers map work until Split or Map is selected', async ({ page }) => {
  const requests: Array<{mapOnly: boolean}> = [];
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort());
  await page.route('**/api/search', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: searchResult });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-house-id="house-1"]')).toBeVisible();
  expect(requests.some((request) => request.mapOnly)).toBe(false);
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.locator('.leaflet-interactive')).toHaveCount(1);
  await page.locator('.leaflet-interactive').click();
  await expect(page.locator('.map-preview')).toBeVisible();
  await expect(page.locator('[data-house-id="house-1"]')).toHaveClass(/is-selected/);
});

test('typing disables pagination before debounce can append a new query to old hits', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/search', (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    return route.fulfill({ json: { ...searchResult, totalHits: 50 } });
  });
  await page.goto('/search?q=garage');
  const more = page.getByRole('button', { name: 'Show more homes' });
  await expect(more).toBeEnabled();
  await page.getByTestId('search-input').fill('pool');
  await expect(more).toBeDisabled();
  await expect.poll(() => bodies.some((body) => body.q === 'pool')).toBe(true);
  expect(bodies.filter((body) => body.q === 'pool').every((body) => body.page === 1)).toBe(true);
  await expect(page.locator('[data-house-id]')).toHaveCount(1);
});

test('failed replacement query cannot append pages to the previous results', async ({ page }) => {
  await page.route('**/api/search', (route) => {
    const body = route.request().postDataJSON();
    return body.q === 'pool'
      ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } })
      : route.fulfill({ json: { ...searchResult, totalHits: 50 } });
  });
  await page.goto('/search?q=garage');
  await expect(page.getByRole('button', { name: 'Show more homes' })).toBeEnabled();
  await page.getByTestId('search-input').fill('pool');
  await expect(page.locator('.search-error')).toContainText('Temporarily unavailable');
  await expect(page.locator('[data-house-id]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show more homes' })).toHaveCount(0);
});
