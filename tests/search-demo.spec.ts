import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.post('/api/seed');
});

test('keyword search ranks the Hampton Cove garage listing highly', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('textbox', { name: 'Search' }).fill('hampton cove garage');
  await expect(page.getByRole('heading', { name: /Hampton Cove garage home/i })).toBeVisible();
  await expect(page.getByText(/hits from Native PostgreSQL/i)).toBeVisible();
  await expect(page.getByText('garage').first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search' })).toBeFocused();
});

test('debounced search updates results and filters without replacing the focused search box', async ({ page }) => {
  await page.goto('/search');
  const searchBox = page.getByRole('textbox', { name: 'Search' });
  await searchBox.focus();
  await searchBox.pressSequentially('low maintenance condo');

  await expect(page.getByRole('heading', { name: /Low maintenance condo close to restaurants/i })).toBeVisible();
  await expect(searchBox).toBeFocused();
  await expect(page.locator('.facet-group[data-facet="propertyType"]').getByText(/condo/i)).toBeVisible();
});

test('search suggestions appear while typing and can apply a query', async ({ page }) => {
  await page.goto('/search');
  const searchBox = page.getByRole('textbox', { name: 'Search' });
  await searchBox.fill('gar');

  await expect(page.getByRole('button', { name: /garage\s+Amenity/i })).toBeVisible();
  await page.getByRole('button', { name: /garage\s+Amenity/i }).click();
  await expect(searchBox).toHaveValue('garage');
  await expect(page.getByRole('button', { name: /q: garage/i })).toBeVisible();
});

test('provider switcher keeps the same UI while changing debug payloads', async ({ page }) => {
  await page.goto('/search?q=quiet%20home%20near%20good%20schools');
  for (const [value, label] of [
    ['postgres_native', 'Native PostgreSQL'],
    ['pg_search', 'PostgreSQL + pg_search'],
    ['meilisearch', 'PostgreSQL + Meilisearch'],
    ['typesense', 'PostgreSQL + Typesense']
  ]) {
    await page.getByLabel('Provider').selectOption(value);
    await expect(page.locator('.stats', { hasText: label })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Quiet cul-de-sac home/i })).toBeVisible();
  }
  await expect(page.getByText(/collection/i)).toBeVisible();
});

test('facets, range filters, geo radius, and distance sort update results', async ({ page }) => {
  await page.goto('/search?q=home');
  await page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/).check();
  await page.locator('[data-range="minPrice"]').fill('250000');
  await page.locator('[data-range="minPrice"]').press('Enter');
  await page.getByRole('button', { name: '10 mi Madison' }).click();
  await page.getByLabel('Sort').selectOption('distance');

  await expect(page.getByText(/mi away/).first()).toBeVisible();
  await expect(page.getByText(/city: Madison/i)).toBeVisible();
  await expect(page.getByText(/minPrice: 250000/i)).toBeVisible();
});

test('top refinement chips can clear individual filters', async ({ page }) => {
  await page.goto('/search?q=home');
  await page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/).check();
  await expect(page.getByRole('button', { name: /city: Madison/i })).toBeVisible();

  await page.getByRole('button', { name: /city: Madison/i }).click();
  await expect(page.getByRole('button', { name: /city: Madison/i })).toBeHidden();
  await expect(page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/)).not.toBeChecked();
});

test('result map renders and hit amenity chips apply filters', async ({ page }) => {
  await page.goto('/search?q=hampton%20cove%20garage');
  await expect(page.getByRole('img', { name: /Relative map of visible search results/i })).toBeVisible();
  await expect(page.locator('.result-map circle')).not.toHaveCount(0);

  const hampton = page.locator('.result[data-house-id="target-hampton-cove-garage"]');
  await hampton.getByRole('button', { name: 'garage' }).click();
  await expect(page.getByRole('button', { name: /amenities: garage/i })).toBeVisible();
  await expect(page.locator('.facet-group[data-facet="amenities"]').getByLabel(/garage/i)).toBeChecked();
});

test('facet groups are capped by default and can be expanded', async ({ page }) => {
  await page.goto('/search');
  const amenities = page.locator('.facet-group[data-facet="amenities"]');

  await expect(amenities.locator('[data-filter="amenities"]')).toHaveCount(6);
  await amenities.getByRole('button', { name: /Show \d+ more/ }).click();
  await expect(amenities.locator('[data-filter="amenities"]')).toHaveCount(10);
  await amenities.getByRole('button', { name: 'Show fewer' }).click();
  await expect(amenities.locator('[data-filter="amenities"]')).toHaveCount(6);
});

test('zero-hit searches can be saved and evaluated later', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('textbox', { name: 'Search' }).fill('zzzz qqqq xxxx');
  await expect(page.getByText(/No listings match this search/i)).toBeVisible();
  page.once('dialog', async (dialog) => {
    await dialog.accept('Zero-hit waterfront castle');
  });
  await page.getByRole('button', { name: 'Save search' }).click();
  await expect(page).toHaveURL(/\/saved-searches/);
  await expect(page.getByRole('heading', { name: 'Zero-hit waterfront castle' })).toBeVisible();
  const savedRow = page.locator('.saved-row', { has: page.getByRole('heading', { name: 'Zero-hit waterfront castle' }) });
  await expect(savedRow.getByText(/0 current hits/i)).toBeVisible();
  await savedRow.getByRole('button', { name: 'Evaluate now' }).click();
  await expect(savedRow.getByText(/0 current hits/i)).toBeVisible();
});

test('multiple saved searches apply as an OR scope before live filters narrow results', async ({ page, request }) => {
  const hampton = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Hampton Cove scope',
      criteria: { q: 'hampton cove garage', mode: 'hybrid', filters: {}, sort: 'relevance', page: 1, pageSize: 12, includeFacets: true }
    }
  })).json();
  const condo = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Restaurant condo scope',
      criteria: { q: 'low maintenance condo', mode: 'hybrid', filters: {}, sort: 'relevance', page: 1, pageSize: 12, includeFacets: true }
    }
  })).json();

  await page.goto(`/search?savedSearchId=${hampton.id}&savedSearchId=${condo.id}`);
  await expect(page.getByRole('heading', { name: /Hampton Cove garage home/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Low maintenance condo close to restaurants/i })).toBeVisible();
  await expect(page.getByText(/Selected saved searches are ORed together/i)).toBeVisible();

  await page.locator('.facet-group[data-facet="propertyType"]').getByLabel(/condo/i).check();
  await expect(page.getByRole('heading', { name: /Low maintenance condo close to restaurants/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hampton Cove garage home/i })).toBeHidden();
});

test('applying a saved search from the filter panel scopes hits, facets, and its live count', async ({ page, request }) => {
  const saved = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Madison under 350k panel scope',
      criteria: {
        q: '',
        mode: 'hybrid',
        filters: { city: ['Madison'], maxPrice: 350000 },
        sort: 'relevance',
        page: 1,
        pageSize: 12,
        includeFacets: true
      }
    }
  })).json();

  await page.goto('/search');
  await page.locator('.facet-group[data-facet="saved-searches"]').getByLabel(/Madison under 350k panel scope/).check();

  await expect(page.getByText(/10 hits from Native PostgreSQL/i)).toBeVisible();
  const savedScope = page.locator('.facet-group[data-facet="saved-searches"]');
  const savedOption = savedScope.locator('.facet-option', { has: page.getByLabel(/Madison under 350k panel scope/) });
  await expect(savedOption.locator('.count')).toHaveText('10');
  await expect(page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/)).toBeVisible();
  await expect(page.locator('.facet-group[data-facet="city"]').getByLabel(/Huntsville/)).toBeHidden();
  expect(saved.currentHitCount).toBe(10);
});

test('never-evaluated saved searches do not show stale zero counts in the filter rail', async ({ page }) => {
  await page.goto('/search');
  const savedScope = page.locator('.facet-group[data-facet="saved-searches"]');
  await expect(savedScope.getByText('saved').first()).toBeVisible();
  await expect(savedScope.getByText('4+ bedroom house in Madison under $450k with pool 0')).toBeHidden();
});

test('provider comparison page explains capabilities and sync requirements', async ({ page }) => {
  await page.goto('/providers');
  await expect(page.getByRole('heading', { name: 'Provider Comparison' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'PostgreSQL + Meilisearch' })).toBeVisible();
  await expect(page.getByText(/Requires outbox, backfill, and sync worker/i).first()).toBeVisible();
  await expect(page.getByText(/instant search direct adapter/i)).toBeVisible();
});

test('direct InstantSearch.js routes render real adapter widgets for Typesense and Meilisearch', async ({ page }) => {
  await page.goto('/search/instant/typesense');
  await expect(page.getByRole('heading', { name: 'Typesense InstantSearch Demo' })).toBeVisible();
  await expect(page.getByText(/typesense-instantsearch-adapter/i)).toBeVisible();
  await page.locator('#instant-searchbox input').fill('hampton cove garage');
  await expect(page.locator('#instant-hits .ais-Hits-item').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hampton Cove garage/i }).first()).toBeVisible();

  await page.goto('/search/instant/meilisearch');
  await expect(page.getByRole('heading', { name: 'Meilisearch InstantSearch Demo' })).toBeVisible();
  await expect(page.getByText(/@meilisearch\/instant-meilisearch/i)).toBeVisible();
  await page.locator('#instant-searchbox input').fill('hampton cove garage');
  await expect(page.locator('#instant-hits .ais-Hits-item').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Hampton Cove garage/i }).first()).toBeVisible();
});

test('external provider sync demo shows outbox, backfill, and worker processing', async ({ page, request }) => {
  await page.goto('/search?provider=meilisearch&q=madison%20starter%20home');
  await expect(page.getByRole('heading', { name: /Madison starter home/i })).toBeVisible();

  await page.getByRole('button', { name: 'Backfill Meili' }).click();
  await expect(page.getByText(/"backfillStatus": "complete"/i)).toBeVisible();

  await request.patch('/api/houses/target-madison-starter', { data: { price: 279000 } });
  await page.reload();
  await expect(page.getByText(/"outboxPendingCount": 2/i)).toBeVisible();

  await page.getByRole('button', { name: 'Run worker' }).click();
  await expect(page.getByText(/"outboxPendingCount": 0/i)).toBeVisible();
});
