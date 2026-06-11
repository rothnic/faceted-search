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
import { RealServices, realServiceConfigFromEnv } from './real-services.js';

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '127.0.0.1';
const rootDir = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../..'));
const webSourceDir = join(rootDir, 'apps/web-angular/src');
const webDistDir = join(rootDir, 'apps/web-angular/dist');
const dataDir = join(rootDir, 'data');
const savedSearchPath = join(dataDir, 'saved-searches.json');
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
      geoRadius: 'PostGIS ST_DWithin',
      geoSort: true,
      semanticSearch: 'pgvector in production; simulated locally',
      hybridSearch: 'custom SQL ranking',
      instantSearchDirectAdapter: false,
      requiresExternalSync: false,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Enable PostGIS and pgvector', 'Create tsvector, GIN, vector, and geography indexes'],
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
      geoRadius: 'PostGIS ST_DWithin',
      geoSort: true,
      semanticSearch: 'pgvector in production; simulated locally',
      hybridSearch: 'pg_search BM25 plus vector rank',
      instantSearchDirectAdapter: false,
      requiresExternalSync: false,
      supportsSavedSearchEvaluation: true
    },
    setupNotes: ['Use a Postgres image with the ParadeDB pg_search extension', 'Keep PostGIS and pgvector enabled for geo and semantic search'],
    syncRequirements: 'No external sync. Search indexes live inside Postgres.',
    schemaRequirements: ['pg_search index over flattened fields', 'geography index', 'vector embedding column'],
    knownLimitations: ['Requires extension-aware Postgres deployment and SQL adapter work']
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
      semanticSearch: 'Meilisearch embedders in production; simulated locally',
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
      semanticSearch: 'Typesense vector field or auto-embedding in production; simulated locally',
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
  return cities.find((city) => city.id === house.cityId)!;
}

function neighborhoodFor(house: House): Neighborhood | undefined {
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

const semanticExpansions: Record<string, string[]> = {
  quiet: ['quiet', 'cul-de-sac', 'screened_porch', 'family-friendly'],
  family: ['family-friendly', 'fenced_yard', 'good schools', 'playroom', 'cul-de-sac'],
  growing: ['family-friendly', 'fenced_yard', '4 bedroom', 'spacious'],
  retirees: ['low-maintenance', 'single-level', 'condo', 'walkable'],
  starter: ['starter-home', 'affordable', 'madison city schools'],
  modern: ['new-construction', 'smart_home', 'near-restaurants'],
  restaurants: ['near-restaurants', 'walkable', 'five points'],
  schools: ['madison city schools', 'mountain gap schools', 'good schools'],
  mountain: ['mountain-view', 'hampton cove'],
  research: ['research-park-commute', 'research park', 'redstone arsenal']
};

function semanticNeedles(query: string | undefined): string[] {
  const terms = tokenize(query);
  return [...new Set([...terms, ...terms.flatMap((term) => semanticExpansions[term] ?? [])])];
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

function filterHouses(request: HouseSearchRequest, searchableHouses: House[], scopeIds?: Set<string>): HouseSearchHit[] {
  const q = request.q?.trim();
  const terms = tokenize(q);
  const semanticTerms = semanticNeedles(q);

  return searchableHouses
    .filter((house) => !house.deletedAt && (!scopeIds || scopeIds.has(house.id)))
    .map((house): HouseSearchHit => {
      const city = cityFor(house);
      const neighborhood = neighborhoodFor(house);
      const semanticText = buildSemanticText(house, city, neighborhood);
      const keywordMatches = terms.filter((term) => semanticText.includes(term));
      const semanticMatches = semanticTerms.filter((term) => semanticText.includes(term));
      const keywordScore = terms.length ? keywordMatches.length / terms.length : 0.2;
      const semanticScore = semanticTerms.length ? semanticMatches.length / semanticTerms.length : 0.2;
      const modeScore =
        request.mode === 'keyword'
          ? keywordScore
          : request.mode === 'semantic'
            ? semanticScore
            : keywordScore * 0.55 + semanticScore * 0.45;
      return {
        ...house,
        city: city.name,
        neighborhood: neighborhood?.name,
        distanceMiles: request.geo ? distanceMiles(request.geo.lat, request.geo.lng, house.lat, house.lng) : undefined,
        score: Number((modeScore * 100).toFixed(2)),
        semanticText,
        matchedTerms: [...new Set([...keywordMatches, ...semanticMatches])]
      };
    })
    .filter((hit) => {
      const filters = request.filters ?? {};
      const textPasses = !q || hit.score > 0;
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
      return textPasses && fieldPasses && geoPasses && viewportPasses;
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
  if (provider.id === 'postgres_native') {
    return {
      sql: `SELECT houses.*, ts_rank(search_vector, plainto_tsquery($1)) AS keyword_rank FROM houses WHERE filters_match AND ST_DWithin(geog, point, radius) ORDER BY hybrid_rank DESC LIMIT ${request.pageSize};`,
      warnings: request.mode === 'semantic' || request.mode === 'hybrid' ? ['Local demo simulates pgvector semantic rank.'] : []
    };
  }
  if (provider.id === 'pg_search') {
    return {
      sql: `SELECT * FROM houses WHERE id @@@ paradedb.match('semantic_text', $1) AND filters_match ORDER BY paradedb.score(id) DESC LIMIT ${request.pageSize};`,
      warnings: request.mode === 'semantic' || request.mode === 'hybrid' ? ['Local demo simulates pg_search + pgvector hybrid rank.'] : []
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
  const scopeIds = await savedSearchScopeIds(request.savedSearchIds);
  const mapHits = await mapHitsForRequest(request, scopeIds);
  if (scopeIds) {
    return localSearchResponse(request, provider, started, scopeIds, [
      'Saved-search scopes are ORed together, then the active query and filters narrow that scoped result set.'
    ]);
  }
  if (realServices && (request.provider === 'meilisearch' || request.provider === 'typesense')) {
    try {
      const external = await realServices.searchExternal(request.provider, request, cities, neighborhoods);
      return {
        provider: provider.id,
        providerLabel: provider.label,
        hits: external.hits,
        mapHits,
        totalHits: external.totalHits,
        page: Math.max(1, request.page || 1),
        pageSize: Math.max(1, Math.min(50, request.pageSize || 12)),
        facets: request.includeFacets ? external.facets : {},
        processingTimeMs: Number((performance.now() - started).toFixed(1)),
        debug: external.debug
      };
    } catch (error) {
      const fallback = await localSearchResponse(request, provider, started);
      fallback.debug = {
        ...fallback.debug,
        warnings: [
          ...(fallback.debug?.warnings ?? []),
          `${provider.label} engine was unavailable, so this response fell back to Postgres-backed local scoring: ${error instanceof Error ? error.message : String(error)}`
        ]
      };
      return fallback;
    }
  }
  return localSearchResponse(request, provider, started);
}

async function savedSearchScopeIds(ids: string[] | undefined): Promise<Set<string> | undefined> {
  const uniqueIds = [...new Set(ids ?? [])].filter(Boolean);
  if (!uniqueIds.length) return undefined;

  const searches = (await savedSearches()).filter((search) => uniqueIds.includes(search.id));
  if (!searches.length) return undefined;
  const scopedIds = new Set<string>();
  const searchableHouses = await currentHouses();
  for (const search of searches) {
    for (const hit of savedSearchMatches(search, searchableHouses)) scopedIds.add(hit.id);
  }
  return scopedIds;
}

function savedSearchMatches(search: SavedHouseSearch, searchableHouses: House[]) {
  const criteria = defaultRequest({ ...search.criteria, savedSearchIds: [] });
  return filterHouses(criteria, searchableHouses);
}

function toMapHits(hits: HouseSearchHit[]): HouseSearchMapHit[] {
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    lat: hit.lat,
    lng: hit.lng,
    price: hit.price,
    city: hit.city,
    neighborhood: hit.neighborhood
  }));
}

async function mapHitsForRequest(request: HouseSearchRequest, scopeIds?: Set<string>) {
  return toMapHits(sortedHits(filterHouses(request, await currentHouses(), scopeIds), request));
}

async function localSearchResponse(
  request: HouseSearchRequest,
  provider: ProviderMeta,
  started: number,
  scopeIds?: Set<string>,
  warnings: string[] = []
): Promise<HouseSearchResponse> {
  const allMatches = filterHouses(request, await currentHouses(), scopeIds);
  const sorted = sortedHits(allMatches, request);
  const page = Math.max(1, request.page || 1);
  const pageSize = Math.max(1, Math.min(50, request.pageSize || 12));
  const hits = sorted.slice((page - 1) * pageSize, page * pageSize);
  const debug = debugFor(provider, request, allMatches.length);
  return {
    provider: provider.id,
    providerLabel: provider.label,
    hits,
    mapHits: toMapHits(sorted),
    totalHits: allMatches.length,
    page,
    pageSize,
    facets: request.includeFacets ? buildFacets(allMatches) : {},
    processingTimeMs: Number((performance.now() - started).toFixed(1)),
    debug: { ...debug, warnings: [...(debug.warnings ?? []), ...warnings] }
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
  return searches.map((search) => ({
    ...search,
    currentHitCount: savedSearchMatches(search, searchableHouses).length
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
  const hitIds = response.hits.map((hit) => hit.id);
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
  if (realServices) return realServices.syncSummary();
  return {
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
  return {
    provider: body.provider ?? 'postgres_native',
    q: body.q ?? '',
    mode: body.mode ?? 'hybrid',
    filters: body.filters ?? {},
    geo: body.geo,
    viewport: body.viewport,
    sort: body.sort ?? 'relevance',
    page: body.page ?? 1,
    pageSize: body.pageSize ?? 12,
    includeFacets: body.includeFacets ?? true,
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
    return send(res, 200, { providers, fixtureCatalog, geoPresets: { huntsville: cities[0], madison: cities[1], redstoneArsenal } });
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
      seenHouseIds: response.hits.map((hit) => hit.id),
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
    return send(res, 200, await backfill(body.provider));
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
  if (req.method === 'PATCH' && houseMatch) {
    const body = await readJson(req);
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

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
}).listen(port, host, () => {
  console.log(`Search options demo running at http://${host}:${port}/search`);
});
