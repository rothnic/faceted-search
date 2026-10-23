import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HouseSearchHit, HouseSearchRequest } from '../../../packages/search-contracts/src/search-provider.interface.js';
import { RealServices } from '../src/real-services.js';

const request = (includeMap: boolean): HouseSearchRequest => ({
  provider: 'meilisearch', q: 'garage', mode: 'keyword', filters: {}, sort: 'relevance',
  page: 1, pageSize: 18, includeFacets: false, includeMap
});

const hit = (id: string) => ({ id }) as HouseSearchHit;

function serviceWithStaticExternalSearch(totalHits = 2) {
  const services = new RealServices({
    databaseUrl: 'postgres://test:test@127.0.0.1/searchlab_test',
    meiliHost: 'http://meili.test', meiliKey: '',
    typesenseHost: 'http://typesense.test', typesenseKey: '', syncProviders: ['meilisearch']
  });
  const calls: HouseSearchRequest[] = [];
  const internals = services as unknown as {
    appliances: { ensure(provider: string, signal: AbortSignal): Promise<boolean> };
    nativeSourceSnapshot(): Promise<{ total: number; pending: number; version: string }>;
  };
  internals.appliances.ensure = async () => false;
  internals.nativeSourceSnapshot = async () => ({ total: totalHits, pending: 0, version: 'test-version' });
  (services.embeddingJobs as unknown as { assertProjectionCurrent(): Promise<void> }).assertProjectionCurrent = async () => {};
  services.searchExternal = async (_provider, criteria) => {
    calls.push(criteria);
    const offset = (criteria.page - 1) * criteria.pageSize;
    const count = Math.min(criteria.pageSize, Math.max(totalHits - offset, 0));
    return {
      hits: Array.from({ length: count }, (_, index) => hit(`house-${offset + index + 1}`)),
      totalHits, facets: {}, debug: { rawRequest: { page: criteria.page, pageSize: criteria.pageSize }, rawResponse: {} }
    };
  };
  return { services, calls };
}

describe('external search hydration and map work', () => {
  it('hydrates only IDs returned by either engine, preserving engine order', async () => {
    for (const provider of ['meilisearch', 'typesense'] as const) {
      const services = new RealServices({
        databaseUrl: 'postgres://test:test@127.0.0.1/searchlab_test',
        meiliHost: 'http://meili.test', meiliKey: '',
        typesenseHost: 'http://typesense.test', typesenseKey: ''
      });
      const queryCalls: Array<{ sql: string; values: unknown[] }> = [];
      const internal = services as unknown as {
        schemaReady?: Promise<void>;
        pool: { query(sql: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
        meili(path: string, init?: RequestInit): Promise<unknown>;
        typesense(path: string, init?: RequestInit): Promise<unknown>;
      };
      internal.schemaReady = Promise.resolve();
      internal.pool.query = async (sql, values) => {
        queryCalls.push({ sql, values });
        return { rows: [houseRow('house-1'), houseRow('house-2')] };
      };
      const orderedIds = ['house-2', 'house-1'];
      internal.meili = async () => ({
        hits: orderedIds.map((id) => ({ id, _rankingScore: 0.9 })), estimatedTotalHits: 2, facetDistribution: {}
      });
      internal.typesense = async () => ({
        hits: orderedIds.map((id) => ({ document: { id }, text_match_info: { score: '100' } })), found: 2, facet_counts: []
      });

      const result = await services.searchExternal(provider, { ...request(false), provider }, [], []);

      assert.equal(queryCalls.length, 1);
      assert.match(queryCalls[0].sql, /h\.id = ANY\(\$1::text\[\]\)/);
      assert.deepEqual(queryCalls[0].values, [orderedIds]);
      assert.deepEqual(result.hits.map(({ id }) => id), orderedIds);
      await services.close();
    }
  });

  it('does not make full-result map requests for a list search that excludes map data', async () => {
    const { services, calls } = serviceWithStaticExternalSearch();

    const result = await services.search({ ...request(false), includeFacets: false });

    assert.equal(calls.length, 1);
    assert.deepEqual(result.mapHits, []);
    assert.deepEqual(result.debug.rawRequest, [{ page: 1, pageSize: 18 }]);
    await services.close();
  });

  it('reuses the first page when it already contains every map result', async () => {
    const { services, calls } = serviceWithStaticExternalSearch();

    const result = await services.search({ ...request(true), includeFacets: false });

    assert.equal(calls.length, 1);
    assert.equal(result.mapHits.length, 2);
    await services.close();
  });

  it('fetches the complete bounded set when the page does not include every map result', async () => {
    const { services, calls } = serviceWithStaticExternalSearch(35);

    const result = await services.search({ ...request(true), includeFacets: false });

    assert.equal(calls.length, 2);
    assert.equal(calls[1].pageSize, 250);
    assert.equal(result.mapHits.length, 35);
    await services.close();
  });
});

function houseRow(id: string) {
  return {
    id, title: `Home ${id}`, description: 'Garage house', city_id: 'city-1', neighborhood_id: null,
    address_line_1: '1 Test Street', zip_code: '35801', lat: 34.73, lng: -86.59, price: 300_000,
    bedrooms: 3, bathrooms: 2, square_feet: 1500, lot_size_acres: null, year_built: null,
    property_type: 'single_family', listing_status: 'active', school_district: null,
    amenities: ['garage'], tags: [], created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z',
    deleted_at: null,
    city_record: { id: 'city-1', name: 'Huntsville', state: 'AL', county: null, center_lat: 34.73, center_lng: -86.59 },
    neighborhood_record: null
  };
}
