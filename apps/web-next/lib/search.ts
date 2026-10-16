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

export type SearchResponse = {
  provider: SearchProvider;
  providerLabel: string;
  hits: SearchHit[];
  mapHits: Array<Pick<SearchHit, 'id' | 'title' | 'lat' | 'lng' | 'price' | 'city' | 'neighborhood' | 'propertyType' | 'listingStatus'>>;
  totalHits: number;
  totalInventory?: number | null;
  page: number;
  pageSize: number;
  facets: Record<string, Array<{ value: string; count: number }>>;
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

  function schedule(request: SearchRequest, callbacks: SearchCallbacks<T>) {
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
    }, delayMs);
    return cancel;
  }

  return { schedule, cancel };
}

export async function postSearch(request: SearchRequest, signal: AbortSignal): Promise<SearchResponse> {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  return body as SearchResponse;
}
