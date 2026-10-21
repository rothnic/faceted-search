import { expect, test } from '@playwright/test';

const providers = ['postgres_native', 'pg_search', 'meilisearch', 'typesense'] as const;
test.beforeAll(async ({ request }) => {
  const meta = await (await request.get('/api/providers')).json();
  expect(meta.storageMode).toBe('postgres');
  const jobs = await (await request.get('/api/embedding-jobs')).json();
  expect(jobs.durable).toBe(true);
  expect(jobs.queue.backend).toBe('pgmq');
  expect(jobs.documents.pending).toBe(0);
  expect(jobs.documents.projectionPending).toBe(0);
});
for (const provider of providers) {
  for (const mode of ['keyword', 'semantic', 'hybrid'] as const) {
    test(`${provider} ${mode}: real browser to selected backend, facets, maps and saved scope`, async ({ page, request }) => {
      const q = mode === 'keyword' ? 'garage' : 'effortless upkeep condominium beside eateries';
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/search') && response.request().method() === 'POST' && response.request().postDataJSON()?.provider === provider);
      await page.goto(`/search?provider=${provider}&mode=${mode}&q=${encodeURIComponent(q)}`);
      const response = await responsePromise;
      expect(response.ok(), await response.text()).toBe(true);
      const result = await response.json();
      const execution = provider === 'postgres_native' || provider === 'pg_search'
        ? mode === 'keyword' ? provider === 'pg_search' ? 'postgres-bm25' : 'postgres-fts' : mode === 'semantic' ? 'postgres-vector' : 'postgres-hybrid'
        : `external-${mode}`;
      expect(result.debug.execution).toBe(execution);
      expect(result.totalHits).toBeGreaterThan(0);
      expect(result.mapHits).toHaveLength(result.totalHits);
      expect(result.facets.city.reduce((sum: number, bucket: {count: number}) => sum + bucket.count, 0)).toBe(result.totalHits);
      expect(JSON.stringify(result.debug)).not.toMatch(/illustrative|fell back|local keyword scoring/i);
      await expect(page.locator('#result-list-scroll')).toHaveAttribute('data-total-count', String(result.totalHits));
      await expect(page.locator('#result-map .leaflet-interactive')).toHaveCount(result.mapHits.length);
      await expect(page.getByRole('alert')).toHaveCount(0);
      const savedResponse = await request.post('/api/saved-searches', { data: { name: `Real ${provider} ${mode}`, criteria: { provider, q, mode, filters: {}, sort: 'relevance', page: 1, pageSize: 1, includeFacets: true } } });
      expect(savedResponse.ok()).toBe(true);
      const saved = await savedResponse.json();
      expect(saved.seenHouseIds).toHaveLength(result.totalHits);
      const scoped = await request.post('/api/search', { data: { provider, q: '', mode: 'keyword', filters: {}, sort: 'relevance', page: 1, pageSize: 3, includeFacets: true, savedSearchIds: [saved.id] } });
      expect(scoped.ok(), await scoped.text()).toBe(true);
      const scopedResult = await scoped.json();
      expect(scopedResult.totalHits).toBe(result.totalHits);
      expect(new Set(scopedResult.mapHits.map((hit: {id: string}) => hit.id))).toEqual(new Set(saved.seenHouseIds));
      // Actual UI refinement must submit a backend filter, never filter an old page locally.
      const filteredResponse = page.waitForResponse((response) => response.url().endsWith('/api/search') && response.request().postDataJSON()?.filters?.city?.length === 1);
      await page.locator('.facet-group[data-facet="city"] input[type="checkbox"]').first().check();
      const filtered = await filteredResponse;
      expect(filtered.ok(), await filtered.text()).toBe(true);
      const filteredResult = await filtered.json();
      expect(filteredResult.debug.execution).toBe(execution);
      // InstantSearch keeps the group's native alternatives while applying its selection to hits.
      expect(filteredResult.facets.city).toEqual(result.facets.city);
      const selectedCity = filtered.request().postDataJSON().filters.city[0];
      expect(filteredResult.facets.city.find((bucket: {value: string}) => bucket.value === selectedCity).count).toBe(filteredResult.totalHits);
      await expect(page.locator('.facet-group[data-facet=city] input[type=checkbox]')).toHaveCount(result.facets.city.length);
      expect(filteredResult.mapHits).toHaveLength(filteredResult.totalHits);
      await expect(page.locator('#result-list-scroll')).toHaveAttribute('data-total-count', String(filteredResult.totalHits));
    });
  }
}
