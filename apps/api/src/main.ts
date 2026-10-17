import { publicDiagnostics } from './public-diagnostics.js';
import { describeSchema } from './schema.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { House } from '../../../packages/domain/src/house.types.js';
import type { HouseSearchMapHit, HouseSearchRequest, HouseSearchResponse, SearchProviderCapabilities, SearchProviderId } from '../../../packages/search-contracts/src/search-provider.interface.js';
import type { SavedHouseSearch } from '../../../packages/search-contracts/src/saved-search.types.js';
import { RealServices, realServiceConfigFromEnv, validateHousePatch } from './real-services.js';
import { embeddingStatus, EmbeddingUnavailableError } from './embeddings.js';
import { requireRealRuntime } from './runtime-config.js';

const runtime = requireRealRuntime(process.env);
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '127.0.0.1';
const rootDir = normalize(join(dirname(fileURLToPath(import.meta.url)), '../../..'));
const webSourceDir = join(rootDir, 'apps/web-angular/src');
const webDistDir = join(rootDir, 'apps/web-angular/dist');
const realServices = new RealServices(realServiceConfigFromEnv());

type ProviderMeta = {
  id: SearchProviderId;
  label: string;
  capabilities: SearchProviderCapabilities;
  setupNotes: string[];
  syncRequirements: string;
  schemaRequirements: string[];
  knownLimitations: string[];
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
      semanticSearch: 'PostgreSQL: automatic PGMQ CPU embeddings + pgvector SQL',
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
      semanticSearch: 'PostgreSQL: automatic PGMQ CPU embeddings + pgvector SQL',
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

function cityFor(house: House) { return realServices.locationFor(house).city; }
function neighborhoodFor(house: House) { return realServices.locationFor(house).neighborhood; }
function providerMeta(id: SearchProviderId): ProviderMeta {
  const provider = providers.find((candidate) => candidate.id === id);
  if (!provider) throw Object.assign(new Error('Unknown search provider.'), { statusCode: 400 });
  return provider;
}

async function performSearch(request: HouseSearchRequest): Promise<HouseSearchResponse> {
  const started = performance.now();
  const provider = providerMeta(request.provider);
  try {
    const scopeIds = await savedSearchScopeIds(request.savedSearchIds);
    const searchStarted = performance.now();
    const result = await realServices.search(request, scopeIds ? [...scopeIds] : undefined);
    const searchMs = Number((performance.now() - searchStarted).toFixed(1));
    if (result.respondingProvider !== provider.id) throw new Error('Unexpected responding backend.');
    const dataset = await realServices.datasetIdentity(runtime.datasetId);
    const apiMs = Number((performance.now() - started).toFixed(1));
    return {
      provider: provider.id, providerLabel: provider.label, ...result,
      hits: request.mapOnly ? [] : result.hits,
      mapHits: request.includeMap === false ? [] : toMapHits(result.mapHits),
      page: request.page, pageSize: request.pageSize, processingTimeMs: apiMs,
      provenance: {
        selectedProvider: provider.id, respondingProvider: result.respondingProvider,
        storage: 'postgres', execution: result.debug.execution,
        dataset, timing: { apiMs, searchMs, source: 'api-monotonic-clock' },
        observedAt: new Date().toISOString()
      }
    };
  } catch {
    throw Object.assign(new Error('Selected backend is unavailable. No fallback was used.'), {
      statusCode: 503, code: 'BACKEND_UNAVAILABLE', selectedProvider: provider.id
    });
  }
}

async function savedSearchScopeIds(ids: string[] | undefined): Promise<Set<string> | undefined> {
  const uniqueIds = [...new Set(ids ?? [])].filter(Boolean);
  if (!uniqueIds.length) return undefined;
  const searches = (await savedSearches()).filter((search) => uniqueIds.includes(search.id));
  const scopedIds = new Set<string>();
  for (const search of searches) for (const hit of await savedSearchMatches(search)) scopedIds.add(hit.id);
  return scopedIds;
}
async function savedSearchMatches(search: SavedHouseSearch) {
  return (await realServices.search(defaultRequest({ ...search.criteria, savedSearchIds: [] }))).mapHits;
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

async function savedSearches() { return realServices.listSavedSearches(); }
async function savedSearchesWithLiveCounts(): Promise<SavedHouseSearch[]> {
  const searches = await savedSearches();
  return Promise.all(searches.map(async (search) => {
    try {
      return { ...search, currentHitCount: (await savedSearchMatches(search)).length };
    } catch (error) {
      if (!(error instanceof EmbeddingUnavailableError)) throw error;
      return { ...search, currentHitCount: null, evaluationError: error.message };
    }
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

async function persistSavedSearch(search: SavedHouseSearch) { return realServices.insertSavedSearch(search); }
async function persistEvaluatedSavedSearch(search: SavedHouseSearch) { return realServices.updateSavedSearch(search); }
async function syncSummary() { return publicDiagnostics({ ...await realServices.syncSummary(), storageMode: 'postgres', observedAt: new Date().toISOString() }); }
async function backfill(provider: 'meilisearch' | 'typesense') { return realServices.backfill(provider, [], []); }
async function runSyncWorker() { return realServices.runSyncWorker([], []); }

function defaultRequest(body: Partial<HouseSearchRequest>): HouseSearchRequest {
  if (body.q !== undefined && (typeof body.q !== 'string' || body.q.length > 2000)) {
    throw Object.assign(new Error('Search query must be a string of at most 2000 characters.'), { statusCode: 400 });
  }
  if (body.mode !== undefined && !['keyword', 'semantic', 'hybrid'].includes(body.mode)) {
    throw Object.assign(new Error('Search mode must be keyword, semantic, or hybrid.'), { statusCode: 400 });
  }
  const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!providers.some((provider) => provider.id === body.provider)) invalid('Select an explicit supported search provider.');
  if (body.sort !== undefined && !['relevance','distance','price_asc','price_desc','newest'].includes(body.sort)) invalid('Unknown sort order.');
  for (const key of ['includeMap', 'mapOnly'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') invalid(`Invalid \${key} flag.`);
  }
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
    provider: body.provider!,
    q: body.q ?? '',
    mode: body.mode ?? 'keyword',
    filters,
    geo: body.geo,
    viewport: body.viewport,
    sort: body.sort ?? 'relevance',
    page: Number.isFinite(body.page) ? Math.max(1, Math.floor(body.page!)) : 1,
    pageSize: Number.isFinite(body.pageSize) ? Math.max(1, Math.min(50, Math.floor(body.pageSize!))) : 12,
    includeFacets: body.includeFacets ?? true,
    includeMap: body.includeMap ?? true, mapOnly: body.mapOnly ?? false,
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
    return send(res, 200, { providers, catalog: await realServices.catalog(), catalogSource: 'postgres',
      storageMode: 'postgres', dataset: await realServices.datasetIdentity(runtime.datasetId),
      observedAt: new Date().toISOString(), geoPresets: {} });
  }

  if (req.method === 'GET' && pathname === '/api/schema') return send(res, 200, describeSchema('postgres'));

  if (req.method === 'GET' && pathname === '/api/embeddings') return send(res, 200, publicDiagnostics(embeddingStatus()));

  if (req.method === 'GET' && pathname === '/api/embedding-jobs') {
    return send(res, 200, publicDiagnostics(await realServices.embeddingJobs.status()));
  }

  if (req.method === 'POST' && pathname === '/api/embedding-jobs/backfill') {
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
    return send(res, 202, await backfill(body.provider));
  }

  if (req.method === 'POST' && pathname === '/api/sync/worker/run') return send(res, 200, await runSyncWorker());

  const houseMatch = pathname.match(/^\/api\/houses\/([^/]+)$/);
  if (req.method === 'GET' && houseMatch) {
    let id: string;
    try { id = decodeURIComponent(houseMatch[1]); }
    catch { return send(res, 400, { error: 'Invalid house ID encoding' }); }
    // Detail reads are independent of search pagination/ranking. Connected mode
    // reads the current joined PostgreSQL record, never a fixture or cached page.
    const house = (await realServices.loadHouses(id))[0];
    if (!house || house.deletedAt) return send(res, 404, { error: 'House not found' });
    return send(res, 200, { house: { ...house, city: cityFor(house).name, neighborhood: neighborhoodFor(house)?.name } });
  }

  if (req.method === 'PATCH' && houseMatch) {
    const body = await readJson(req);
    validateHousePatch(body);
    const updated = await realServices.updateHouse(houseMatch[1], body);
    if (!updated) return send(res, 404, { error: 'House not found' });
    return send(res, 200, updated);
  }

  return send(res, 404, { error: 'Unknown API route' });
}

await realServices.start();

const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', `http://${host}:${port}`).pathname;
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return await serveStatic(req, res);
  } catch (error) {
    const failure = error as { statusCode?: number; code?: string; selectedProvider?: SearchProviderId };
    const status = failure.statusCode === 400 ? 400 : 503;
    return send(res, status, {
      error: status === 400 ? 'Invalid search request.' : 'Selected backend is unavailable. No fallback was used.',
      code: status === 400 ? 'INVALID_REQUEST' : failure.code ?? 'BACKEND_UNAVAILABLE',
      selectedProvider: failure.selectedProvider
    });
  }
}).listen(port, host, () => {
  const address = server.address();
  const boundPort = address && typeof address === 'object' ? address.port : port;
  console.log(`Searchlab connected API running at http://${host}:${boundPort}/search`);
  process.send?.({ type: 'ready', port: boundPort });
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  await realServices.close();
  server.closeAllConnections();
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
