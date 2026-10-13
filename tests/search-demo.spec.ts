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
  await page.goto('/search?mode=keyword&q=hampton%20cove%20garage');
  await expect(page.locator('.leaflet-container')).toBeVisible();

  const searchBox = page.getByRole('textbox', { name: 'Search' });
  await searchBox.fill('gar');

  const garageSuggestion = page.getByRole('button', { name: /garage\s+Amenity/i });
  await expect(garageSuggestion).toBeVisible();
  await expect.poll(async () => garageSuggestion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      inSuggestions: Boolean(target?.closest('.suggestions')),
      inLeaflet: Boolean(target?.closest('.leaflet-container'))
    };
  })).toEqual({ inSuggestions: true, inLeaflet: false });

  await garageSuggestion.click();
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

test('top refinement chips can clear individual filters when their text is clicked', async ({ page, request }) => {
  const saved = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Garage homes chip scope',
      criteria: { q: 'garage', mode: 'hybrid', filters: {}, sort: 'relevance', page: 1, pageSize: 12, includeFacets: true }
    }
  })).json();

  await page.goto('/search?q=home');
  await page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/).check();
  await page.locator('.facet-group[data-facet="saved-searches"]').getByLabel(/Garage homes chip scope/).check();

  await expect(page.getByRole('button', { name: /q: home/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /city: Madison/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /saved: Garage homes chip scope/i })).toBeVisible();

  await page.getByRole('button', { name: /city: Madison/i }).getByText(/city: Madison/i).click();
  await expect(page.getByRole('button', { name: /city: Madison/i })).toBeHidden();
  await expect(page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/)).not.toBeChecked();

  await page.getByRole('button', { name: /saved: Garage homes chip scope/i }).getByText(/saved: Garage homes chip scope/i).click();
  await expect(page.getByRole('button', { name: /saved: Garage homes chip scope/i })).toBeHidden();
  await expect(page.locator('.facet-group[data-facet="saved-searches"]').getByLabel(/Garage homes chip scope/)).not.toBeChecked();

  await page.getByRole('button', { name: /q: home/i }).getByText(/q: home/i).click();
  await expect(page.getByRole('button', { name: /q: home/i })).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Search' })).toHaveValue('');
  expect(saved.currentHitCount).toBeGreaterThan(0);
});

test('result map renders and hit amenity chips apply filters', async ({ page }) => {
  await page.goto('/search?mode=keyword&q=hampton%20cove%20garage');
  await expect(page.getByRole('img', { name: /Interactive map of matching search results/i })).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.leaflet-interactive')).toHaveCount(47);
  await expect(page.locator('.map-legend')).toContainText('Single family');
  await expect(page.locator('.map-legend')).toContainText('Land');
  const markerColors = await page.locator('.leaflet-interactive').evaluateAll((markers) => [...new Set(markers.map((marker) => marker.getAttribute('fill')))]);
  expect(markerColors.length).toBeGreaterThan(1);
  const scroller = page.locator('#result-list-scroll');
  await expect(scroller).toBeVisible();
  await expect(scroller).toHaveAttribute('data-loaded-count', '18');
  await expect(scroller).toHaveAttribute('data-total-count', '47');
  const renderedRows = await page.locator('.virtual-row').count();
  expect(renderedRows).toBeLessThan(18);

  const hampton = page.locator('.result[data-house-id="target-hampton-cove-garage"]');
  await hampton.getByRole('button', { name: 'garage' }).click();
  await expect(page.getByRole('button', { name: /amenities: garage/i })).toBeVisible();
  await expect(page.locator('.facet-group[data-facet="amenities"]').getByLabel(/garage/i)).toBeChecked();
});

test('virtualized results append pages with infinite scroll', async ({ page }) => {
  await page.goto('/search?mode=keyword&q=hampton%20cove%20garage');
  const scroller = page.locator('#result-list-scroll');
  await expect(scroller).toHaveAttribute('data-loaded-count', '18');

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(scroller).toHaveAttribute('data-loaded-count', '36');

  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(scroller).toHaveAttribute('data-loaded-count', '47');
  await expect(page.locator('[data-virtual-summary]')).toContainText('All 47 matching listings loaded');
  const renderedRows = await page.locator('.virtual-row').count();
  expect(renderedRows).toBeLessThan(47);
});

test('clicking a hit opens a structured details overlay', async ({ page }) => {
  await page.goto('/search?mode=keyword&q=hampton%20cove%20garage');

  await page.locator('.result[data-house-id="target-hampton-cove-garage"]').click();
  const dialog = page.getByRole('dialog', { name: /Hampton Cove garage home/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Structured details')).toBeVisible();
  await expect(dialog.getByText('Location')).toBeVisible();
  await expect(dialog.getByText('Structured JSON')).toBeVisible();
  await expect(dialog.locator('pre')).toContainText('"propertyType": "single_family"');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
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

test('zero-hit searches can be saved in place and applied from the filter rail', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('textbox', { name: 'Search' }).fill('zzzz qqqq xxxx');
  await expect(page.getByText(/No listings match this search/i)).toBeVisible();
  page.once('dialog', async (dialog) => {
    await dialog.accept('Zero-hit waterfront castle');
  });
  await page.getByRole('button', { name: 'Save search' }).click();
  await expect(page).toHaveURL(/\/search/);
  const savedScope = page.locator('.facet-group[data-facet="saved-searches"]');
  const savedOption = savedScope.locator('.facet-option', { has: page.getByLabel(/Zero-hit waterfront castle/) });
  await expect(savedOption.locator('[data-saved-search]')).toBeChecked();
  await expect(savedOption.locator('.count')).toHaveText('0');
  await expect(page.getByRole('button', { name: /saved: Zero-hit waterfront castle/i })).toBeVisible();
  await expect(page.getByText(/No listings match this search/i)).toBeVisible();
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

test('saved search counts are live and multiple applied saved searches OR to the displayed hit total', async ({ page, request }) => {
  const hampton = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Hampton Cove garage scope',
      criteria: { q: 'hampton cove garage', mode: 'hybrid', filters: {}, sort: 'relevance', page: 1, pageSize: 12, includeFacets: true }
    }
  })).json();
  const condo = await (await request.post('/api/saved-searches', {
    data: {
      name: 'Low maintenance condo scope',
      criteria: { q: 'low maintenance condo', mode: 'hybrid', filters: {}, sort: 'relevance', page: 1, pageSize: 12, includeFacets: true }
    }
  })).json();
  const union = await (await request.post('/api/search', {
    data: {
      provider: 'postgres_native',
      q: '',
      mode: 'hybrid',
      filters: {},
      sort: 'relevance',
      page: 1,
      pageSize: 12,
      includeFacets: true,
      savedSearchIds: [hampton.id, condo.id]
    }
  })).json();

  await page.goto('/search');
  const savedScope = page.locator('.facet-group[data-facet="saved-searches"]');
  await expect(savedScope.getByText('Saved Searches')).toBeVisible();
  const hamptonOption = savedScope.locator('.facet-option', { has: page.getByLabel(/Hampton Cove garage scope/) });
  const condoOption = savedScope.locator('.facet-option', { has: page.getByLabel(/Low maintenance condo scope/) });
  await expect(hamptonOption.locator('.count')).toHaveText(String(hampton.currentHitCount));
  await expect(condoOption.locator('.count')).toHaveText(String(condo.currentHitCount));
  expect(hampton.currentHitCount).toBeGreaterThan(0);
  expect(condo.currentHitCount).toBeGreaterThan(0);

  await savedScope.getByLabel(/Hampton Cove garage scope/).check();
  await expect(page.getByText(new RegExp(`${hampton.currentHitCount} hits from Native PostgreSQL`, 'i'))).toBeVisible();
  await expect(savedScope.locator('.facet-title')).toContainText(`${hampton.currentHitCount} matches`);

  await savedScope.getByLabel(/Low maintenance condo scope/).check();
  await expect(page.getByText(new RegExp(`${union.totalHits} hits from Native PostgreSQL`, 'i'))).toBeVisible();
  await expect(savedScope.locator('.facet-title')).toContainText(`${union.totalHits} matches`);
  await expect(page.getByRole('heading', { name: /Hampton Cove garage home/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Low maintenance condo close to restaurants/i })).toBeVisible();
});

test('saving manual filters adds and applies the new saved search without leaving the search page', async ({ page }) => {
  await page.goto('/search');
  await page.locator('.facet-group[data-facet="city"]').getByLabel(/Madison/).check();
  await page.locator('[data-range="maxPrice"]').fill('350000');
  await page.locator('[data-range="maxPrice"]').press('Enter');
  await expect(page.getByText(/10 hits from Native PostgreSQL/i)).toBeVisible();

  page.once('dialog', async (dialog) => {
    await dialog.accept('Madison under 350k saved in place');
  });
  await page.getByRole('button', { name: 'Save search' }).click();

  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole('button', { name: /saved: Madison under 350k saved in place/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /city: Madison/i })).toBeHidden();
  await expect(page.getByRole('button', { name: /maxPrice: 350000/i })).toBeHidden();
  await expect(page.getByText(/10 hits from Native PostgreSQL/i)).toBeVisible();

  const savedScope = page.locator('.facet-group[data-facet="saved-searches"]');
  const savedOption = savedScope.locator('.facet-option', { has: page.getByLabel(/Madison under 350k saved in place/) });
  await expect(savedOption.locator('[data-saved-search]')).toBeChecked();
  await expect(savedOption.locator('.count')).toHaveText('10');
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
