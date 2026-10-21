import algoliasearchHelper from 'algoliasearch-helper';
import { FACET_FIELDS } from './facets.js';
import type { FacetBucket, HouseSearchHit, HouseSearchRequest } from '../../../packages/search-contracts/src/search-provider.interface.js';

type NativePage = { hits: HouseSearchHit[]; totalHits: number; facets: Record<string, FacetBucket[]> };
type HelperQuery = { indexName: string; params: { query?: string; page?: number; hitsPerPage?: number; facetFilters?: Array<string | string[]>; facets?: string | string[] } };

// Transport translation only: InstantSearch chooses the AND/OR grouping and
// generates each query's facetFilters. Preserve non-facet context on every query.
// No application code removes "this group's" filter or plans facet requests.
function nativeRequest(request: HouseSearchRequest, params: HelperQuery['params']): HouseSearchRequest {
  const filters = { ...request.filters };
  for (const { key } of FACET_FIELDS) delete filters[key];
  for (const term of params.facetFilters ?? []) {
    const values = (Array.isArray(term) ? term : [term]).map(value => {
      const separator = value.indexOf(':');
      if (separator < 1) throw new Error('Invalid library facet filter.');
      return { key: value.slice(0, separator), value: value.slice(separator + 1).replace(/^\\-/, '-') };
    });
    const field = FACET_FIELDS.find(field => field.key === values[0]?.key);
    if (!field || values.some(value => value.key !== field.key) || filters[field.key] !== undefined) throw new Error('Unsupported library facet filter group.');
    if (field.key === 'bedrooms') filters.bedrooms = values.map(value => Number(value.value));
    else filters[field.key] = values.map(value => value.value);
  }
  return { ...request, filters, q: params.query ?? request.q, page: (params.page ?? 0) + 1, pageSize: params.hitsPerPage ?? request.pageSize, includeFacets: Boolean(params.facets?.length) };
}

export async function libraryFacetSearch(request: HouseSearchRequest, execute: (request: HouseSearchRequest, facetOnly: boolean) => Promise<NativePage>) {
  const queries: HelperQuery[] = [];
  const client = { search: async (batch: HelperQuery[]) => {
    queries.push(...batch);
    const run = async (query: HelperQuery, index: number) => {
      const fields = typeof query.params.facets === 'string' ? [query.params.facets] : query.params.facets ?? [];
      const started = performance.now();
      const result = await execute(nativeRequest(request, query.params), index > 0);
      return {
        hits: result.hits.map(hit => ({ ...hit, objectID: hit.id })),
        nbHits: result.totalHits, nbPages: query.params.hitsPerPage ? Math.ceil(result.totalHits / query.params.hitsPerPage) : 0,
        page: query.params.page ?? 0, hitsPerPage: query.params.hitsPerPage ?? request.pageSize,
        processingTimeMS: performance.now() - started, query: query.params.query ?? '', exhaustiveFacetsCount: false,
        facets: Object.fromEntries(fields.map(key => [key, Object.fromEntries((result.facets[key] ?? []).map(bucket => [bucket.value, bucket.count]))]))
      };
    };
    // Execute the primary transport first so provider readiness/currentness checks
    // finish before the helper's facet-only transports. Counts stay native.
    const primary = await run(batch[0], 0);
    // Drain the complete transport batch before a snapshot owner can roll back
    // and release its DB client. A rejected Promise.all would leave work alive.
    const secondary = await Promise.allSettled(batch.slice(1).map((query, index) => run(query, index + 1)));
    const failure = secondary.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return { results: [primary, ...secondary.map(result => {
      if (result.status !== 'fulfilled') throw new Error('Unsettled facet transport.');
      return result.value;
    })] };
  } };
  const helper = algoliasearchHelper(client as Parameters<typeof algoliasearchHelper>[0], 'houses', {
    query: request.q ?? '', page: Math.max(0, request.page - 1), hitsPerPage: request.pageSize,
    disjunctiveFacets: FACET_FIELDS.map(field => field.key), maxValuesPerFacet: 20,
    disjunctiveFacetsRefinements: Object.fromEntries(FACET_FIELDS.flatMap(({ key }) => {
      const values = request.filters[key];
      return values?.length ? [[key, values.map(String)]] : [];
    }))
  });
  const { content } = await helper.searchOnce({});
  const facets = Object.fromEntries(FACET_FIELDS.map(({ key }) => {
    const values = content.getFacetValues(key, {});
    if (!Array.isArray(values)) throw new Error('Unexpected library facet response.');
    return [key, values.map(value => ({ value: value.name, count: value.count }))];
  }));
  return { facets, queries };
}
