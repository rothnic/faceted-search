// Shared facet semantics. Query and saved-search scopes are deliberately separate.
export function activeFilters(request) {
  const parts = [];
  for (const [key, value] of Object.entries(request.filters || {})) {
    if (Array.isArray(value)) value.forEach((item) => parts.push({ action: 'filter', key, value: item }));
    else if (value !== undefined && value !== null && value !== '') parts.push({ action: 'filter', key, value });
  }
  if (request.geo) parts.push({ action: 'geo', value: request.geo.radiusMiles });
  if (request.viewport) parts.push({ action: 'viewport' });
  return parts;
}

export function clearFacetCriteria(request) {
  const { geo, viewport, ...rest } = request;
  return { ...rest, filters: {}, page: 1 };
}

export function clearQueryCriteria(request) {
  return { ...request, q: '', page: 1 };
}

export function removeFacetCriteria(request, { action, key, value }) {
  const next = { ...request, filters: { ...request.filters }, page: 1 };
  if (action === 'filter' && key) {
    if (Array.isArray(next.filters[key])) {
      next.filters[key] = next.filters[key].filter((item) => String(item) !== String(value));
      if (!next.filters[key].length) delete next.filters[key];
    } else delete next.filters[key];
  }
  if (action === 'geo') delete next.geo;
  if (action === 'viewport') delete next.viewport;
  return next;
}
