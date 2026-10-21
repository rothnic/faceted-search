// Service configuration; facet values and counts always come from native queries.
export const FACET_FIELDS = [
  { key: 'city', label: 'City', type: 'text' },
  { key: 'neighborhood', label: 'Neighborhood', type: 'text' },
  { key: 'schoolDistrict', label: 'School district', type: 'text' },
  { key: 'propertyType', label: 'Home type', type: 'text' },
  { key: 'bedrooms', label: 'Bedrooms', type: 'integer' },
  { key: 'amenities', label: 'Property features', type: 'text' },
  { key: 'listingStatus', label: 'Status', type: 'text' }
] as const;

export const FACET_DEFINITIONS = FACET_FIELDS.map(({ key, label, type }) => ({
  key, label, valueType: type === 'integer' ? 'number' as const : 'string' as const
}));
