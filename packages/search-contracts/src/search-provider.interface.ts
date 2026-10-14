import type { House } from '../../domain/src/house.types.js';

export type SearchProviderId = 'postgres_native' | 'pg_search' | 'meilisearch' | 'typesense';
export type SearchMode = 'keyword' | 'semantic' | 'hybrid';
export type SortMode = 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest';

export type SearchProviderCapabilities = {
  keywordSearch: boolean;
  faceting: boolean | string;
  rangeFacets: boolean;
  geoRadius: boolean | string;
  geoSort: boolean;
  semanticSearch: boolean | string;
  hybridSearch: boolean | string;
  instantSearchDirectAdapter: boolean;
  requiresExternalSync: boolean;
  supportsSavedSearchEvaluation: boolean;
};

export type HouseSearchRequest = {
  provider: SearchProviderId;
  q?: string;
  mode: SearchMode;
  filters: {
    city?: string[];
    bedrooms?: number[];
    neighborhood?: string[];
    schoolDistrict?: string[];
    propertyType?: string[];
    listingStatus?: string[];
    minPrice?: number;
    maxPrice?: number;
    minBedrooms?: number;
    minBathrooms?: number;
    minSquareFeet?: number;
    minYearBuilt?: number;
    maxYearBuilt?: number;
    minLotSize?: number;
    maxLotSize?: number;
    amenities?: string[];
  };
  geo?: {
    lat: number;
    lng: number;
    radiusMiles: number;
  };
  viewport?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  sort: SortMode;
  page: number;
  pageSize: number;
  includeFacets: boolean;
  savedSearchIds?: string[];
};

export type FacetBucket = {
  value: string;
  count: number;
};

export type HouseSearchHit = House & {
  city: string;
  neighborhood?: string;
  distanceMiles?: number;
  score: number;
  semanticScore?: number;
  semanticText: string;
  matchedTerms: string[];
};

export type HouseSearchMapHit = Pick<HouseSearchHit, 'id' | 'title' | 'lat' | 'lng' | 'price' | 'city' | 'neighborhood' | 'propertyType' | 'listingStatus'>;

export type HouseSearchResponse = {
  provider: SearchProviderId;
  providerLabel: string;
  hits: HouseSearchHit[];
  mapHits: HouseSearchMapHit[];
  totalHits: number;
  page: number;
  pageSize: number;
  facets: Record<string, FacetBucket[]>;
  processingTimeMs: number;
  debug?: {
    execution?: 'local-cpu' | 'local-keyword' | 'external-keyword' | 'postgres-vector' | 'postgres-fts' | 'postgres-bm25' | 'postgres-hybrid' | 'external-semantic' | 'external-hybrid';
    embedding?: { model: string; revision: string; dimensions: number; dtype: string; device: string; minimumSimilarity: number };
    rawRequest?: unknown;
    rawResponse?: unknown;
    sql?: string;
    warnings?: string[];
    notes?: string[];
  };
};

export type SearchProvider = {
  id: SearchProviderId;
  label: string;
  capabilities: SearchProviderCapabilities;
  search(request: HouseSearchRequest): Promise<HouseSearchResponse>;
};
