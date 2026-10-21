import type { HouseSearchRequest } from '../../../packages/search-contracts/src/search-provider.interface.js';

export const FACET_FIELDS = [
  { key: 'city', label: 'City', engine: 'cityFacet', sql: 'c.name', type: 'text' },
  { key: 'neighborhood', label: 'Neighborhood', engine: 'neighborhoodFacet', sql: 'n.name', type: 'text' },
  { key: 'schoolDistrict', label: 'School district', engine: 'schoolDistrictFacet', sql: 'h.school_district', type: 'text' },
  { key: 'propertyType', label: 'Home type', engine: 'propertyTypeFacet', sql: 'h.property_type', type: 'text' },
  { key: 'bedrooms', label: 'Bedrooms', engine: 'bedrooms', sql: 'h.bedrooms', type: 'integer' },
  { key: 'amenities', label: 'Property features', engine: 'amenities', sql: '', type: 'text' },
  { key: 'listingStatus', label: 'Status', engine: 'listingStatusFacet', sql: 'h.listing_status', type: 'text' }
] as const;

export const FACET_DEFINITIONS = FACET_FIELDS.map(({ key, label, type }) => ({
  key, label, valueType: type === 'integer' ? 'number' as const : 'string' as const
}));

export function selectedFacetFields(request: HouseSearchRequest) {
  return request.includeFacets ? FACET_FIELDS.filter(({ key }) => request.filters[key]?.length) : [];
}

export function withoutFacet(request: HouseSearchRequest, field: typeof FACET_FIELDS[number]['key']): HouseSearchRequest {
  const filters = { ...request.filters };
  delete filters[field];
  return { ...request, filters };
}
