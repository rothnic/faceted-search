import { describeSchema } from './schema.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { City, Neighborhood } from '../../../packages/domain/src/city.types.js';
import type { House } from '../../../packages/domain/src/house.types.js';
import type {
  FacetBucket,
  HouseSearchHit,
  HouseSearchMapHit,
  HouseSearchRequest,
  HouseSearchResponse,
  SearchProviderCapabilities,
  SearchProviderId
} from '../../../packages/search-contracts/src/search-provider.interface.js';
import type { SavedHouseSearch } from '../../../packages/search-contracts/src/saved-search.types.js';
import { buildSemanticText } from '../../../packages/search-transform/src/house-search-document.js';
import { toMeiliDocument } from '../../../packages/search-transform/src/to-meili-document.js';
import { toTypesenseDocument } from '../../../packages/search-transform/src/to-typesense-document.js';
import { toHouseSearchDocument } from '../../../packages/search-transform/src/house-search-document.js';
import { cities, neighborhoods, redstoneArsenal } from '../../../packages/test-fixtures/src/cities.fixture.js';
import { fixtureCatalog, houses as fixtureHouses } from '../../../packages/test-fixtures/src/houses.fixture.js';
import { seedSavedSearches } from '../../../packages/test-fixtures/src/saved-searches.fixture.js';
import { RealServices, realServiceConfigFromEnv, validateHousePatch } from './real-services.js';
import { cosineSimilarity, embedTexts, embeddingStatus, EmbeddingUnavailableError, EMBEDDING_MODEL, EMBEDDING_MODEL_KEY, EMBEDDING_SOURCE_FIELDS, MIN_SEMANTIC_SIMILARITY } from './embeddings.js';

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '127.0.0.1';
const rootDir = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../..'));
const webSourceDir = join(rootDir, 'apps/web-angular/src');
const webDistDir = join(rootDir, 'apps/web-angular/dist');
const dataDir = process.env.DEMO_DATA_DIR ?? join(rootDir, 'data');
const savedSearchPath = join(dataDir, 'saved-searches.json');
if (!process.env.DATABASE_URL && process.env.DEMO_MEMORY !== '1') {
  throw new Error('Real comparison requires DATABASE_URL. Run npm run dev for the Compose stack. DEMO_MEMORY=1 is an explicit internal fixture mode.');
}
const realServices = process.env.DATABASE_URL ? new RealServices(realServiceConfigFromEnv()) : undefined;

type ProviderMeta = {
  id: SearchProviderId;
  label: string;
  capabilities: SearchProviderCapabilities;
  setupNotes: string[];
  syncRequirements: string;
  schemaRequirements: string[];
  knownLimitations: string[];
};

type OutboxEvent = {
  id: string;
  provider: Extract<SearchProviderId, 'meilisearch' | 'typesense'>;
  houseId: string;
  action: 'upsert' | 'delete';
  status: 'pending' | 'processed' | 'failed';
  createdAt: string;
  processedAt?: string;
  error?: string;
};

const providers: ProviderMeta[] = [
  {
    id: 'postgres_native',
    label: 'Native PostgreSQL',
    capabilities: {
      keywordSearch: true,
      faceting: 'manual SQL aggregation',
      rangeFacets: true,
      geoRadius: 'PostgreSQL SQL haversine radius',
      geoSort: true,
      semanticSearch: 'PostgreSQL: automatic PGMQ CPU embeddings + pgvector SQL; memory demo: local CPU scan',
      hybridSearch: 'Native SQL lexical rank + pgvector cosine',
      instantSearchDirectAdapter: false,
      requiresExternalSync: false,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Enable pgvector and PGMQ', 'Transactional tsvector projection with a GIN index; SQL facets and geo distance'],
    syncRequirements: 'No external sync. PostgreSQL is the source of truth and the search index host.',
    schemaRequirements: ['houses table', 'cities table', 'neighborhoods table', 'saved_searches table'],
    knownLimitations: ['Facet and hybrid ranking SQL must be maintained by the application']
  },
  {
    id: 'pg_search',
    label: 'PostgreSQL + pg_search',
    capabilities: {
      keywordSearch: true,
      faceting: true,
      rangeFacets: true,
      geoRadius: 'PostgreSQL SQL haversine radius',
      geoSort: true,
      semanticSearch: 'PostgreSQL: automatic PGMQ CPU embeddings + pgvector SQL; memory demo: local CPU scan',
      hybridSearch: 'Native SQL lexical rank + pgvector cosine',
      instantSearchDirectAdapter: false,
      requiresExternalSync: false,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Pinned ParadeDB pg_search extension is installed and preloaded by Compose', 'PGMQ and pgvector support automatic vectors; SQL haversine handles geo'],
    syncRequirements: 'No external sync. Search indexes live inside Postgres.',
    schemaRequirements: ['Transactional flattened source projection with a native BM25 index', 'vector(384) embedding column'],
    knownLimitations: ['Requires the pinned pg_search extension/preload; scores differ naturally from native FTS']
  },
  {
    id: 'meilisearch',
    label: 'PostgreSQL + Meilisearch',
    capabilities: {
      keywordSearch: true,
      faceting: true,
      rangeFacets: true,
      geoRadius: true,
      geoSort: true,
      semanticSearch: 'Connected Meilisearch generates MiniLM document/query embeddings natively',
      hybridSearch: true,
      instantSearchDirectAdapter: true,
      requiresExternalSync: true,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Configure filterable and sortable attributes', 'Backfill from PostgreSQL before serving external search traffic'],
    syncRequirements: 'Requires outbox, backfill, and sync worker to keep flattened documents current.',
    schemaRequirements: ['houses index', 'filterable attributes', '_geo field', 'document template for semantic embedding'],
    knownLimitations: ['External index is eventually consistent with PostgreSQL']
  },
  {
    id: 'typesense',
    label: 'PostgreSQL + Typesense',
    capabilities: {
      keywordSearch: true,
      faceting: true,
      rangeFacets: true,
      geoRadius: true,
      geoSort: true,
      semanticSearch: 'Connected Typesense 28 generates MiniLM document/query embeddings natively',
      hybridSearch: true,
      instantSearchDirectAdapter: true,
      requiresExternalSync: true,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Define collection schema with facet fields', 'Use location geopoint and semantic_text embedding source fields'],
    syncRequirements: 'Requires outbox, backfill, and sync worker to keep flattened documents current.',
    schemaRequirements: ['houses collection', 'facet fields', 'location geopoint', 'semantic_text embed.from fields'],
    knownLimitations: ['Schema changes require coordinated reindexing']
  }
];

let houses: House[] = structuredClone(fixtureHouses);
let outbox: OutboxEvent[] = [];
let syncState = {
  meilisearch: { documentsIndexed: 0, documentsDeleted: 0, lastSyncTime: undefined as string | undefined, lastSyncError: undefined as string | undefined, backfillStatus: 'not_started' },
  typesense: { documentsIndexed: 0, documentsDeleted: 0, lastSyncTime: undefined as string | undefined, lastSyncError: undefined as string | undefined, backfillStatus: 'not_started' }
};

function cityFor(house: House): City {
  if (realServices) return realServices.locationFor(house).city;
  return cities.find((city) => city.id === house.cityId)!;
}

function neighborhoodFor(house: House): Neighborhood | undefined {
  if (realServices) return realServices.locationFor(house).neighborhood;
  return neighborhoods.find((neighborhood) => neighborhood.id === house.neighborhoodId);
}

function providerMeta(id: SearchProviderId): ProviderMeta {
  return providers.find((provider) => provider.id === id) ?? providers[0];
}

function tokenize(value: string | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const earthRadiusMiles = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function valueMatches<T extends string | number>(actual: T | undefined, expected: T[] | undefined) {
  return !expected?.length || (actual !== undefined && expected.includes(actual));
}

async function currentHouses(): Promise<House[]> {
  return realServices ? realServices.loadHouses() : houses;
}

const nativeDebug = new WeakMap<HouseSearchHit[], NonNullable<HouseSearchResponse['debug']>>();

async function filterHouses(request: HouseSearchRequest, searchableHouses: House[], scopeIds?: Set<string>): Promise<HouseSearchHit[]> {
  const q = request.q?.trim();
  const terms = tokenize(q);

  const candidates = searchableHouses
    .filter((house) => !house.deletedAt && (!scopeIds || scopeIds.has(house.id)))
    .map((house): HouseSearchHit => {
      const city = cityFor(house);
      const neighborhood = neighborhoodFor(house);
      const semanticText = buildSemanticText(house, city, neighborhood);
      const keywordMatches = terms.filter((term) => semanticText.includes(term));
      const keywordScore = terms.length ? keywordMatches.length / terms.length : 0.2;
      return {
        ...house,
        city: city.name,
        neighborhood: neighborhood?.name,
        distanceMiles: request.geo ? distanceMiles(request.geo.lat, request.geo.lng, house.lat, house.lng) : undefined,
        score: Number((keywordScore * 100).toFixed(2)),
        semanticText,
        matchedTerms: keywordMatches
      };
    })
    .filter((hit) => {
      const filters = request.filters ?? {};
      const fieldPasses =
        valueMatches(hit.city, filters.city) &&
        valueMatches(hit.bedrooms, filters.bedrooms) &&
        valueMatches(hit.neighborhood, filters.neighborhood) &&
        valueMatches(hit.schoolDistrict, filters.schoolDistrict) &&
        valueMatches(hit.propertyType, filters.propertyType) &&
        valueMatches(hit.listingStatus, filters.listingStatus) &&
        (!filters.minPrice || hit.price >= filters.minPrice) &&
        (!filters.maxPrice || hit.price <= filters.maxPrice) &&
        (!filters.minBedrooms || hit.bedrooms >= filters.minBedrooms) &&
        (!filters.minBathrooms || hit.bathrooms >= filters.minBathrooms) &&
        (!filters.minSquareFeet || hit.squareFeet >= filters.minSquareFeet) &&
        (!filters.minYearBuilt || (hit.yearBuilt ?? 0) >= filters.minYearBuilt) &&
        (!filters.maxYearBuilt || (hit.yearBuilt ?? 0) <= filters.maxYearBuilt) &&
        (!filters.minLotSize || (hit.lotSizeAcres ?? 0) >= filters.minLotSize) &&
        (!filters.maxLotSize || (hit.lotSizeAcres ?? 0) <= filters.maxLotSize) &&
        (!filters.amenities?.length || filters.amenities.every((amenity) => hit.amenities.includes(amenity)));
      const geoPasses = !request.geo || (hit.distanceMiles ?? Infinity) <= request.geo.radiusMiles;
      const viewportPasses =
        !request.viewport ||
        (hit.lat >= request.viewport.minLat &&
          hit.lat <= request.viewport.maxLat &&
          hit.lng >= request.viewport.minLng &&
          hit.lng <= request.viewport.maxLng);
      return fieldPasses && geoPasses && viewportPasses;
    });
  if (!q) return candidates;
  if (request.mode === 'keyword') return candidates.filter((hit) => hit.matchedTerms.length > 0);
  if (!candidates.length) return [];
  const [queryVector, ...documentVectors] = await embedTexts([q, ...candidates.map((hit) => hit.semanticText)]);
  return candidates.flatMap((hit, index) => {
    const similarity = cosineSimilarity(queryVector, documentVectors[index]);
    const semanticMatch = similarity >= MIN_SEMANTIC_SIMILARITY;
    const keywordMatch = hit.matchedTerms.length > 0;
    if (request.mode === 'semantic' ? !semanticMatch : !semanticMatch && !keywordMatch) return [];
    const score = request.mode === 'semantic' ? similarity * 100 : hit.score * 0.55 + Math.max(0, similarity) * 45;
    return [{ ...hit, score: Number(score.toFixed(2)), semanticScore: similarity }];
  });
}

function facetBuckets(hits: HouseSearchHit[], field: keyof HouseSearchHit | 'amenities'): FacetBucket[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    const values = field === 'amenities' ? hit.amenities : [hit[field]];
    for (const value of values) {
      if (typeof value === 'string' || typeof value === 'number') {
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 20);
}

function buildFacets(hits: HouseSearchHit[]) {
  return {
    city: facetBuckets(hits, 'city'),
    neighborhood: facetBuckets(hits, 'neighborhood'),
    schoolDistrict: facetBuckets(hits, 'schoolDistrict'),
    propertyType: facetBuckets(hits, 'propertyType'),
    bedrooms: facetBuckets(hits, 'bedrooms'),
    amenities: facetBuckets(hits, 'amenities'),
    listingStatus: facetBuckets(hits, 'listingStatus')
  };
}

function sortedHits(hits: HouseSearchHit[], request: HouseSearchRequest) {
  const result = [...hits];
  result.sort((a, b) => {
    if (request.sort === 'distance') return (a.distanceMiles ?? Infinity) - (b.distanceMiles ?? Infinity);
    if (request.sort === 'price_asc') return a.price - b.price;
    if (request.sort === 'price_desc') return b.price - a.price;
    if (request.sort === 'newest') return b.updatedAt.localeCompare(a.updatedAt);
    return b.score - a.score || b.updatedAt.localeCompare(a.updatedAt);
  });
  return result;
}

function debugFor(provider: ProviderMeta, request: HouseSearchRequest, totalHits: number) {
  if (request.mode !== 'keyword' && request.q?.trim()) {
    return {
      rawRequest: { requestedProvider: provider.id, collection: 'houses', q: request.q, mode: request.mode, filters: request.filters },
      rawResponse: { found: totalHits },
      warnings: [realServices ? 'Persisted document vectors are scored with the pgvector cosine operator in PostgreSQL. Only the query embedding runs in Node.' : 'Exact cosine scan over local CPU embeddings; no database or external vector index is queried.']
    };
  }
  if (provider.id === 'postgres_native') {
    return {
      sql: `SELECT houses.*, ts_rank(search_vector, plainto_tsquery($1)) AS keyword_rank FROM houses WHERE filters_match AND ST_DWithin(geog, point, radius) ORDER BY hybrid_rank DESC LIMIT ${request.pageSize};`,
      warnings: ['SQL is illustrative; this response uses local keyword scoring, not a PostgreSQL search index.']
    };
  }
  if (provider.id === 'pg_search') {
    return {
      sql: `SELECT * FROM houses WHERE id @@@ paradedb.match('semantic_text', $1) AND filters_match ORDER BY paradedb.score(id) DESC LIMIT ${request.pageSize};`,
      warnings: ['SQL is illustrative; this response uses local keyword scoring, not a pg_search index.']
    };
  }
  if (provider.id === 'meilisearch') {
    return {
      rawRequest: {
        index: 'houses',
        q: request.q,
        filter: request.filters,
        hybrid: request.mode === 'hybrid',
        vector: request.mode !== 'keyword' ? 'semanticText embedder' : undefined,
        sort: request.sort,
        geo: request.geo
      },
      rawResponse: { estimatedTotalHits: totalHits },
      warnings: ['Local demo simulates Meilisearch ranking; production uses the Meilisearch API and configured embedders.']
    };
  }
  return {
    rawRequest: {
      collection: 'houses',
      q: request.q || '*',
      query_by: 'title,description,city,neighborhood,amenities,tags,semantic_text',
      filter_by: request.filters,
      vector_query: request.mode !== 'keyword' ? 'semantic_text:([], k:100)' : undefined,
      sort_by: request.sort,
      geo: request.geo
    },
    rawResponse: { found: totalHits },
    warnings: ['Local demo simulates Typesense ranking; production uses collection schema, facets, geopoint, and vector query.']
  };
}

async function performSearch(request: HouseSearchRequest): Promise<HouseSearchResponse> {
  const started = performance.now();
  const provider = providerMeta(request.provider);
  const searchableHouses = await currentHouses();
  const scopeIds = await savedSearchScopeIds(request.savedSearchIds, searchableHouses);
  if (realServices) {
    const result = await realServices.search(request, scopeIds ? [...scopeIds] : undefined);
    return { provider: provider.id, providerLabel: provider.label, ...result,
      totalInventory: result.totalInventory ?? searchableHouses.length,
      hits: request.mapOnly ? [] : result.hits, mapHits: toMapHits(result.mapHits), page: request.page, pageSize: request.pageSize,
      processingTimeMs: Number((performance.now()-started).toFixed(1)) };
  }
  return localSearchResponse(request, provider, started, searchableHouses, scopeIds, ['Explicit in-memory fixture mode; this is not a real-provider comparison.']);
}

async function savedSearchScopeIds(ids: string[] | undefined, searchableHouses: House[]): Promise<Set<string> | undefined> {
  const uniqueIds = [...new Set(ids ?? [])].filter(Boolean);
  if (!uniqueIds.length) return undefined;

  const searches = (await savedSearches()).filter((search) => uniqueIds.includes(search.id));
  if (!searches.length) return new Set<string>();
  const scopedIds = new Set<string>();
  for (const search of searches) {
    for (const hit of await savedSearchMatches(search, searchableHouses)) scopedIds.add(hit.id);
  }
  return scopedIds;
}

async function savedSearchMatches(search: SavedHouseSearch, searchableHouses: House[]) {
  const criteria = defaultRequest({ ...search.criteria, savedSearchIds: [] });
  return realServices ? (await realServices.search(criteria)).mapHits : filterHouses(criteria, searchableHouses);
}

function toMapHits(hits: HouseSearchMapHit[]): HouseSearchMapHit[] {
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    lat: hit.lat,
    lng: hit.lng,
    price: hit.price,
    city: hit.city,
    neighborhood: hit.neighborhood,
    propertyType: hit.propertyType,
    listingStatus: hit.listingStatus
  }));
}

async function localSearchResponse(
  request: HouseSearchRequest,
  provider: ProviderMeta,
  started: number,
  searchableHouses: House[],
  scopeIds?: Set<string>,
  warnings: string[] = []
): Promise<HouseSearchResponse> {
  const allMatches = await filterHouses(request, searchableHouses, scopeIds);
  const sorted = sortedHits(allMatches, request);
  const page = Math.max(1, request.page || 1);
  const pageSize = Math.max(1, Math.min(50, request.pageSize || 12));
  const hits = sorted.slice((page - 1) * pageSize, page * pageSize);
  const engineDebug = nativeDebug.get(allMatches);
  const debug = engineDebug ?? debugFor(provider, request, allMatches.length);
  return {
    provider: provider.id,
    providerLabel: provider.label,
    hits: request.mapOnly ? [] : hits,
    mapHits: request.includeMap === false ? [] : toMapHits(sorted),
    totalHits: allMatches.length,
    totalInventory: searchableHouses.length,
    page,
    pageSize,
    facets: request.includeFacets ? buildFacets(allMatches) : {},
    processingTimeMs: Number((performance.now() - started).toFixed(1)),
    debug: {
      ...debug,
      execution: engineDebug?.execution ?? (request.mode !== 'keyword' && request.q?.trim() ? realServices ? 'postgres-vector' : 'local-cpu' : 'local-keyword'),
      embedding: !engineDebug && request.mode !== 'keyword' && request.q?.trim() ? embeddingStatus() : undefined,
      ...(realServices && !engineDebug && request.mode !== 'keyword' && request.q?.trim() ? { sql: 'SELECT house_id, 1 - (embedding <=> $1::vector) AS similarity FROM house_embeddings WHERE house_id = ANY($2) AND model_key = $3' } : {}),
      warnings: [...(debug.warnings ?? []), ...warnings]
    }
  };
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function send(res: ServerResponse, status: number, data: unknown, contentType = 'application/json') {
  const payload = contentType === 'application/json' ? JSON.stringify(data, null, 2) : String(data);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(payload);
}

async function savedSearches(): Promise<SavedHouseSearch[]> {
  if (realServices) return realServices.listSavedSearches();
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(savedSearchPath)) {
    await writeSavedSearches(seededSavedSearches());
  }
  return JSON.parse(await readFile(savedSearchPath, 'utf8')) as SavedHouseSearch[];
}

async function savedSearchesWithLiveCounts(): Promise<SavedHouseSearch[]> {
  const searches = await savedSearches();
  const searchableHouses = await currentHouses();
  return Promise.all(searches.map(async (search) => {
    try {
      return { ...search, currentHitCount: (await savedSearchMatches(search, searchableHouses)).length };
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) throw error;
      return { ...search, currentHitCount: null, evaluationError: error.message };
    }
  }));
}

async function writeSavedSearches(searches: SavedHouseSearch[]) {
  if (realServices) return;
  await mkdir(dataDir, { recursive: true });
  await writeFile(savedSearchPath, JSON.stringify(searches, null, 2));
}

function seededSavedSearches(): SavedHouseSearch[] {
  const now = new Date().toISOString();
  return seedSavedSearches.map((search, index) => ({
    ...search,
    id: `saved-${index + 1}`,
    createdAt: now,
    updatedAt: now
  }));
}

async function evaluateSavedSearch(search: SavedHouseSearch) {
  const response = await performSearch({ ...search.criteria, page: 1, pageSize: 50, includeFacets: true });
  const hitIds = response.mapHits.map((hit) => hit.id);
  const newMatches = hitIds.filter((id) => !search.seenHouseIds.includes(id));
  return {
    ...search,
    currentHitCount: response.totalHits,
    newMatchesSinceLastEvaluation: newMatches.length,
    seenHouseIds: [...new Set([...search.seenHouseIds, ...hitIds])],
    lastEvaluatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } satisfies SavedHouseSearch;
}

async function persistSavedSearch(search: SavedHouseSearch) {
  if (realServices) return realServices.insertSavedSearch(search);
  const searches = await savedSearches();
  searches.unshift(search);
  await writeSavedSearches(searches);
}

async function persistEvaluatedSavedSearch(search: SavedHouseSearch) {
  if (realServices) return realServices.updateSavedSearch(search);
  const searches = await savedSearches();
  const index = searches.findIndex((candidate) => candidate.id === search.id);
  if (index !== -1) {
    searches[index] = search;
    await writeSavedSearches(searches);
  }
}

async function enqueueExternalSync(houseId: string, action: 'upsert' | 'delete') {
  if (realServices) return realServices.enqueueExternalSync(houseId, action);
  const now = new Date().toISOString();
  for (const provider of ['meilisearch', 'typesense'] as const) {
    outbox.push({
      id: `evt-${outbox.length + 1}-${provider}`,
      provider,
      houseId,
      action,
      status: 'pending',
      createdAt: now
    });
  }
}

async function syncSummary() {
  if (realServices) return { ...await realServices.syncSummary(), storageMode: 'postgres', observedAt: new Date().toISOString() };
  return {
    storageMode: 'memory',
    observedAt: new Date().toISOString(),
    outboxPendingCount: outbox.filter((event) => event.status === 'pending').length,
    outbox,
    providers: syncState
  };
}

async function backfill(provider: Extract<SearchProviderId, 'meilisearch' | 'typesense'>) {
  if (realServices) return realServices.backfill(provider, cities, neighborhoods);
  const now = new Date().toISOString();
  const docs = houses.filter((house) => !house.deletedAt).map((house) => toHouseSearchDocument(house, cityFor(house), neighborhoodFor(house)));
  const transformed = provider === 'meilisearch' ? docs.map(toMeiliDocument) : docs.map(toTypesenseDocument);
  syncState[provider] = {
    ...syncState[provider],
    documentsIndexed: transformed.length,
    lastSyncTime: now,
    lastSyncError: undefined,
    backfillStatus: 'complete'
  };
  return { provider, indexed: transformed.length, lastSyncTime: now };
}

async function runSyncWorker() {
  if (realServices) return realServices.runSyncWorker(cities, neighborhoods);
  const pending = outbox.filter((event) => event.status === 'pending');
  const now = new Date().toISOString();
  for (const event of pending) {
    event.status = 'processed';
    event.processedAt = now;
    if (event.action === 'delete') syncState[event.provider].documentsDeleted += 1;
    else syncState[event.provider].documentsIndexed += 1;
    syncState[event.provider].lastSyncTime = now;
    syncState[event.provider].lastSyncError = undefined;
  }
  return { processed: pending.length, lastSyncTime: now };
}

function defaultRequest(body: Partial<HouseSearchRequest>): HouseSearchRequest {
  if (body.q !== undefined && (typeof body.q !== 'string' || body.q.length > 2000)) {
    throw Object.assign(new Error('Search query must be a string of at most 2000 characters.'), { statusCode: 400 });
  }
  if (body.mode !== undefined && !['keyword', 'semantic', 'hybrid'].includes(body.mode)) {
    throw Object.assign(new Error('Search mode must be keyword, semantic, or hybrid.'), { statusCode: 400 });
  }
  if (body.includeMap !== undefined && typeof body.includeMap !== 'boolean') {
    throw Object.assign(new Error('includeMap must be a boolean.'), { statusCode: 400 });
  }
  if (body.mapOnly !== undefined && typeof body.mapOnly !== 'boolean') {
    throw Object.assign(new Error('mapOnly must be a boolean.'), { statusCode: 400 });
  }
  const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (body.provider !== undefined && !providers.some((provider) => provider.id === body.provider)) invalid('Unknown search provider.');
  if (body.sort !== undefined && !['relevance','distance','price_asc','price_desc','newest'].includes(body.sort)) invalid('Unknown sort order.');
  const filters = body.filters ?? {};
  if (typeof filters !== 'object' || Array.isArray(filters)) invalid('Search filters must be an object.');
  const strings = ['city','neighborhood','schoolDistrict','propertyType','listingStatus','amenities'];
  const numbers = ['minPrice','maxPrice','minBedrooms','minBathrooms','minSquareFeet','minYearBuilt','maxYearBuilt','minLotSize','maxLotSize'];
  for (const [field,value] of Object.entries(filters)) {
    if (strings.includes(field)) { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 500)) invalid(`Invalid ${field} filter.`); }
    else if (field === 'bedrooms') { if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isInteger(item) || item < 0)) invalid('Invalid bedrooms filter.'); }
    else if (numbers.includes(field)) { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(`Invalid ${field} filter.`); }
    else invalid(`Unknown filter ${field}.`);
  }
  if (body.geo && (![body.geo.lat,body.geo.lng,body.geo.radiusMiles].every(Number.isFinite) || Math.abs(body.geo.lat)>90 || Math.abs(body.geo.lng)>180 || body.geo.radiusMiles<0)) invalid('Invalid geographic radius.');
  if (body.viewport && !Object.values(body.viewport).every(Number.isFinite)) invalid('Invalid map viewport.');
  if (body.savedSearchIds && (!Array.isArray(body.savedSearchIds) || body.savedSearchIds.some((id)=>typeof id !== 'string'))) invalid('Invalid saved-search scope.');
  return {
    provider: body.provider ?? 'postgres_native',
    q: body.q ?? '',
    mode: body.mode ?? 'hybrid',
    filters,
    geo: body.geo,
    viewport: body.viewport,
    sort: body.sort ?? 'relevance',
    page: Number.isFinite(body.page) ? Math.max(1, Math.floor(body.page!)) : 1,
    pageSize: Number.isFinite(body.pageSize) ? Math.max(1, Math.min(50, Math.floor(body.pageSize!))) : 12,
    includeFacets: body.includeFacets ?? true,
    includeMap: body.includeMap ?? true,
    mapOnly: body.mapOnly ?? false,
    savedSearchIds: body.savedSearchIds ?? []
  };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const rawPath = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;
  const pathname = rawPath === '/' ? '/search' : rawPath;
  const webDir = existsSync(join(webDistDir, 'index.html')) ? webDistDir : webSourceDir;
  const filePath =
    pathname.startsWith('/assets/') || pathname.endsWith('.js') || pathname.endsWith('.css')
      ? join(webDir, pathname.slice(1))
      : join(webDir, 'index.html');
  if (!normalize(filePath).startsWith(normalize(webDir))) return send(res, 404, { error: 'Not found' });
  try {
    const data = await readFile(filePath);
    const type = extname(filePath) === '.css' ? 'text/css' : extname(filePath) === '.js' ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && pathname === '/api/providers') {
    return send(res, 200, { providers, fixtureCatalog: realServices ? await realServices.catalog() : fixtureCatalog, catalogSource: realServices ? 'postgres' : 'fixture', storageMode: realServices ? 'postgres' : 'memory', observedAt: new Date().toISOString(), geoPresets: { huntsville: cities[0], madison: cities[1], redstoneArsenal } });
  }

  if (req.method === 'GET' && pathname === '/api/schema') return send(res, 200, describeSchema(realServices ? 'postgres' : 'memory'));

  if (req.method === 'GET' && pathname === '/api/embeddings') return send(res, 200, embeddingStatus());

  if (req.method === 'GET' && pathname === '/api/embedding-jobs') {
    return send(res, 200, realServices ? await realServices.embeddingJobs.status() : {
      storageMode: 'memory', durable: false, enabled: false, observedAt: new Date().toISOString(),
      model: { ...EMBEDDING_MODEL, key: EMBEDDING_MODEL_KEY }, sourceFields: EMBEDDING_SOURCE_FIELDS,
      queue: null, documents: null, recentFailures: [],
      note: 'In-memory demo uses on-demand CPU embeddings. Set DATABASE_URL to use durable PGMQ generation and pgvector storage.'
    });
  }
  if (req.method === 'POST' && pathname === '/api/embedding-jobs/backfill') {
    if (!realServices) return send(res, 400, { error: 'Durable embedding backfill requires PostgreSQL.' });
    return send(res, 202, await realServices.embeddingJobs.backfill());
  }

  if (req.method === 'POST' && pathname === '/api/search') {
    const body = await readJson(req);
    return send(res, 200, await performSearch(defaultRequest(body)));
  }

  if (req.method === 'GET' && pathname === '/api/saved-searches') {
    return send(res, 200, { savedSearches: await savedSearchesWithLiveCounts() });
  }

  if (req.method === 'POST' && pathname === '/api/saved-searches') {
    const body = await readJson(req);
    const now = new Date().toISOString();
    const criteria = defaultRequest(body.criteria ?? body);
    const response = await performSearch(criteria);
    const saved: SavedHouseSearch = {
      id: `saved-${Date.now()}`,
      name: body.name || criteria.q || 'Untitled saved search',
      provider: criteria.provider,
      criteria,
      currentHitCount: response.totalHits,
      lastEvaluatedAt: now,
      newMatchesSinceLastEvaluation: response.totalHits,
      seenHouseIds: response.mapHits.map((hit) => hit.id),
      createdAt: now,
      updatedAt: now
    };
    await persistSavedSearch(saved);
    return send(res, 201, saved);
  }

  const evaluateMatch = pathname.match(/^\/api\/saved-searches\/([^/]+)\/evaluate$/);
  if (req.method === 'POST' && evaluateMatch) {
    const searches = await savedSearches();
    const index = searches.findIndex((search) => search.id === evaluateMatch[1]);
    if (index === -1) return send(res, 404, { error: 'Saved search not found' });
    const evaluated = await evaluateSavedSearch(searches[index]);
    await persistEvaluatedSavedSearch(evaluated);
    return send(res, 200, evaluated);
  }

  if (req.method === 'GET' && pathname === '/api/sync/status') return send(res, 200, await syncSummary());

  if (req.method === 'POST' && pathname === '/api/sync/backfill') {
    const body = await readJson(req);
    if (body.provider !== 'meilisearch' && body.provider !== 'typesense') return send(res, 400, { error: 'provider must be meilisearch or typesense' });
    return send(res, realServices ? 202 : 200, await backfill(body.provider));
  }

  if (req.method === 'POST' && pathname === '/api/sync/worker/run') return send(res, 200, await runSyncWorker());

  if (req.method === 'POST' && pathname === '/api/seed') {
    if (realServices) {
      await realServices.seed(cities, neighborhoods, fixtureHouses, seededSavedSearches());
    } else {
      houses = structuredClone(fixtureHouses);
      outbox = [];
      syncState = {
        meilisearch: { documentsIndexed: 0, documentsDeleted: 0, lastSyncTime: undefined, lastSyncError: undefined, backfillStatus: 'not_started' },
        typesense: { documentsIndexed: 0, documentsDeleted: 0, lastSyncTime: undefined, lastSyncError: undefined, backfillStatus: 'not_started' }
      };
      await writeSavedSearches(seededSavedSearches());
    }
    return send(res, 200, { houses: houses.length });
  }

  const houseMatch = pathname.match(/^\/api\/houses\/([^/]+)$/);
  if (req.method === 'GET' && houseMatch) {
    let id: string;
    try { id = decodeURIComponent(houseMatch[1]); }
    catch { return send(res, 400, { error: 'Invalid house ID encoding' }); }
    // Detail reads are independent of search pagination/ranking. Connected mode
    // reads the current joined PostgreSQL record, never a fixture or cached page.
    const house = realServices ? (await realServices.loadHouses(id))[0] : houses.find((entry) => entry.id === id);
    if (!house || house.deletedAt) return send(res, 404, { error: 'House not found' });
    return send(res, 200, { house: { ...house, city: cityFor(house).name, neighborhood: neighborhoodFor(house)?.name } });
  }

  if (req.method === 'PATCH' && houseMatch) {
    const body = await readJson(req);
    validateHousePatch(body);
    if (realServices) {
      const updated = await realServices.updateHouse(houseMatch[1], body);
      if (!updated) return send(res, 404, { error: 'House not found' });
      return send(res, 200, updated);
    }
    const index = houses.findIndex((house) => house.id === houseMatch[1]);
    if (index === -1) return send(res, 404, { error: 'House not found' });
    houses[index] = { ...houses[index], ...body, updatedAt: new Date().toISOString(), deletedAt: body.deleted ? new Date().toISOString() : houses[index].deletedAt };
    await enqueueExternalSync(houses[index].id, body.deleted || body.listingStatus === 'sold' ? 'delete' : 'upsert');
    return send(res, 200, houses[index]);
  }

  return send(res, 404, { error: 'Unknown API route' });
}

if (realServices) await realServices.start();

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return send(res, error instanceof EmbeddingUnavailableError ? 503 : (error as { statusCode?: number }).statusCode ?? 500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
}).listen(port, host, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(`Search options demo running at http://${host}:${boundPort}/search`);
  process.send?.({ type: 'ready', port: boundPort });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await realServices?.close();
  server.closeAllConnections();
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
