export type SearchProvider = 'postgres_native' | 'pg_search' | 'meilisearch' | 'typesense';
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';
export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';
export type FacetValue = string | number;
export type SearchFilters = Record<string, FacetValue[] | number | undefined>;

export type SearchState = {
  provider: SearchProvider;
  mode: SearchMode;
  q: string;
  filters: SearchFilters;
  sort: SearchSort;
  page: number;
  savedSearchIds: string[];
};

export type SearchRequest = SearchState & {
  pageSize: number;
  includeFacets: boolean;
  includeMap: boolean;
  mapOnly: boolean;
};

export type SearchHit = {
  id: string;
  title: string;
  description: string;
  addressLine1?: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lat: number;
  lng: number;
  city: string;
  neighborhood?: string;
  propertyType: string;
  listingStatus: string;
  amenities: string[];
  distanceMiles?: number;
};

export type SearchProvenance = {
  selectedProvider: SearchProvider;
  respondingProvider: SearchProvider;
  storage: 'postgres';
  execution: string;
  dataset: { id: string; databaseFingerprint: string; revision: string; count: number; countSource: 'postgres-active-houses'; observedAt: string };
  timing: { apiMs: number; searchMs: number; source: 'api-monotonic-clock' };
  observedAt: string;
};
export type SearchResponse = {
  provenance?: SearchProvenance;
  gatewayTimingMs?: number;
  browserFetchMs?: number;
  provider: SearchProvider;
  providerLabel: string;
  hits: SearchHit[];
  mapHits: Array<Pick<SearchHit, 'id' | 'title' | 'lat' | 'lng' | 'price' | 'city' | 'neighborhood' | 'propertyType' | 'listingStatus'>>;
  totalHits: number;
  totalInventory?: number | null;
  page: number;
  pageSize: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
  facetDefinitions?: Array<{ key: string; label: string; valueType: 'string' | 'number' }>;
  processingTimeMs: number;
  debug?: { warnings?: string[] };
};

export const emptySearchState = (): SearchState => ({
  provider: 'postgres_native',
  mode: 'keyword',
  q: '',
  filters: {},
  sort: 'relevance',
  page: 1,
  savedSearchIds: []
});

export function readSearchState(params: URLSearchParams): SearchState {
  const initial = emptySearchState();
  const provider = params.get('provider');
  if (provider && ['postgres_native', 'pg_search', 'meilisearch', 'typesense'].includes(provider)) initial.provider = provider as SearchProvider;
  const mode = params.get('mode');
  if (mode && ['keyword', 'semantic', 'hybrid'].includes(mode)) initial.mode = mode as SearchMode;
  const sort = params.get('sort');
  if (sort && ['relevance', 'price_asc', 'price_desc', 'newest'].includes(sort)) initial.sort = sort as SearchSort;
  const page = Number(params.get('page'));
  if (Number.isSafeInteger(page) && page > 1) initial.page = Math.min(page, 100_000);
  initial.q = params.get('q') ?? '';
  for (const key of ['city', 'neighborhood', 'schoolDistrict', 'propertyType', 'bedrooms', 'amenities', 'listingStatus']) {
    const values = params.getAll(key);
    if (values.length) initial.filters[key] = key === 'bedrooms' ? values.map(Number).filter(Number.isFinite) : values;
  }
  for (const key of ['minPrice', 'maxPrice', 'minBathrooms', 'minSquareFeet', 'minYearBuilt', 'maxYearBuilt', 'minLotSize', 'maxLotSize']) {
    const raw = params.get(key);
    if (raw && Number.isFinite(Number(raw))) initial.filters[key] = Number(raw);
  }
  initial.savedSearchIds = params.getAll('savedSearchId');
  return initial;
}

/** Stable, shareable URL for a server-rendered results page. UI-only state is omitted. */
export function buildSearchUrl(state: SearchState, page = state.page): string {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.provider !== 'postgres_native') params.set('provider', state.provider);
  if (state.mode !== 'keyword') params.set('mode', state.mode);
  if (state.sort !== 'relevance') params.set('sort', state.sort);
  for (const [key, value] of Object.entries(state.filters).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? [...new Set(value.map(String))].sort() : [String(value)];
    for (const item of values) params.append(key, item);
  }
  for (const id of [...state.savedSearchIds].sort()) params.append('savedSearchId', id);
  if (page > 1) params.set('page', String(Math.min(Math.floor(page), 100_000)));
  const query = params.toString();
  return `/search${query ? `?${query}` : ''}`;
}

export function buildSearchRequest(state: SearchState, options: { page?: number; mapOnly?: boolean } = {}): SearchRequest {
  const filters = Object.fromEntries(
    Object.entries(state.filters).filter(([, value]) =>
      value !== undefined && (!Array.isArray(value) || value.length > 0)
    )
  ) as SearchFilters;

  return {
    ...state,
    filters,
    page: options.page ?? state.page,
    pageSize: options.mapOnly ? 50 : 18,
    includeFacets: !options.mapOnly,
    includeMap: options.mapOnly ?? false,
    mapOnly: options.mapOnly ?? false
  };
}

export function activeFilterCount(filters: SearchFilters): number {
  return Object.values(filters).reduce<number>((total, value) => {
    if (value === undefined) return total;
    return total + (Array.isArray(value) ? value.length : 1);
  }, 0);
}

export type TimerPort = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(id: unknown): void;
};

type SearchCallbacks<T> = {
  onStart?: () => void;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
};

export function createLatestSearch<T>(
  run: (request: SearchRequest, signal: AbortSignal) => Promise<T>,
  delayMs = 180,
  timers: TimerPort = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>)
  }
) {
  let timer: unknown;
  let controller: AbortController | undefined;
  let generation = 0;

  function cancel() {
    generation += 1;
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  }

  function schedule(request: SearchRequest, callbacks: SearchCallbacks<T>, waitMs = delayMs) {
    cancel();
    const current = generation;
    timer = timers.setTimeout(() => {
      timer = undefined;
      const active = new AbortController();
      controller = active;
      callbacks.onStart?.();
      void run(request, active.signal).then((value) => {
        if (generation === current && !active.signal.aborted) callbacks.onSuccess(value);
      }).catch((error: unknown) => {
        if (generation === current && !active.signal.aborted) callbacks.onError(error);
      });
    }, waitMs);
    return cancel;
  }

  return { schedule, cancel };
}

export async function postSearch(request: SearchRequest, signal: AbortSignal): Promise<SearchResponse> {
  const started = performance.now();
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return { ...body, browserFetchMs: Number((performance.now() - started).toFixed(1)) } as SearchResponse;
}
