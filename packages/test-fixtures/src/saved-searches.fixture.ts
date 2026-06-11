import type { SavedHouseSearch } from '../../search-contracts/src/saved-search.types.js';

export const seedSavedSearches: Omit<SavedHouseSearch, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: '4+ bedroom house in Madison under $450k with pool',
    provider: 'typesense',
    criteria: {
      provider: 'typesense',
      q: '',
      mode: 'hybrid',
      filters: {
        city: ['Madison'],
        propertyType: ['single_family'],
        maxPrice: 450000,
        minBedrooms: 4,
        amenities: ['pool']
      },
      sort: 'relevance',
      page: 1,
      pageSize: 12,
      includeFacets: true
    },
    currentHitCount: 0,
    newMatchesSinceLastEvaluation: 0,
    seenHouseIds: []
  },
  {
    name: 'Waterfront home near Huntsville under $700k',
    provider: 'meilisearch',
    criteria: {
      provider: 'meilisearch',
      q: 'waterfront home near Huntsville',
      mode: 'hybrid',
      filters: { maxPrice: 700000, amenities: ['waterfront'] },
      geo: { lat: 34.7304, lng: -86.5861, radiusMiles: 15 },
      sort: 'relevance',
      page: 1,
      pageSize: 12,
      includeFacets: true
    },
    currentHitCount: 0,
    newMatchesSinceLastEvaluation: 0,
    seenHouseIds: []
  },
  {
    name: 'New construction in Madison City Schools',
    provider: 'postgres_native',
    criteria: {
      provider: 'postgres_native',
      q: 'new construction',
      mode: 'hybrid',
      filters: { schoolDistrict: ['Madison City Schools'] },
      sort: 'newest',
      page: 1,
      pageSize: 12,
      includeFacets: true
    },
    currentHitCount: 0,
    newMatchesSinceLastEvaluation: 0,
    seenHouseIds: []
  }
];
