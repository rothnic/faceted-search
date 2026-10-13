const app = document.querySelector('#app');
const FACET_VISIBLE_LIMIT = 6;
const RESULT_PAGE_SIZE = 18;
const PROPERTY_TYPE_STYLES = {
  single_family: { color: '#2563eb', label: 'Single family' },
  townhouse: { color: '#059669', label: 'Townhouse' },
  condo: { color: '#7c3aed', label: 'Condo' },
  multi_family: { color: '#dc2626', label: 'Multi family' },
  land: { color: '#d97706', label: 'Land' }
};
const state = {
  providers: [],
  catalog: {},
  geoPresets: {},
  savedSearches: [],
  expandedFacets: {},
  response: null,
  resultMap: null,
  resultVirtualizer: null,
  resultVirtualCleanup: null,
  isLoadingMore: false,
  selectedHitId: null,
  request: requestFromUrl(),
  sync: null,
  storageMode: null,
  embeddings: null,
  isSearching: false,
  searchError: null,
  savedSearchesLoading: true,
  savedSearchesError: null,
  operation: null,
  operationError: null,
  searchRequestId: 0
};

function requestFromUrl() {
  const params = new URLSearchParams(location.search);
  return {
    provider: params.get('provider') || 'postgres_native',
    q: params.get('q') || '',
    mode: params.get('mode') || 'hybrid',
    filters: {
      city: params.getAll('city'),
      bedrooms: params.getAll('bedrooms').map((value) => Number(value)).filter((value) => !Number.isNaN(value)),
      neighborhood: params.getAll('neighborhood'),
      schoolDistrict: params.getAll('schoolDistrict'),
      propertyType: params.getAll('propertyType'),
      listingStatus: params.getAll('listingStatus'),
      amenities: params.getAll('amenities')
    },
    sort: params.get('sort') || 'relevance',
    page: Number(params.get('page') || 1),
    pageSize: RESULT_PAGE_SIZE,
    includeFacets: true,
    savedSearchIds: params.getAll('savedSearchId')
  };
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set('provider', state.request.provider);
  if (state.request.q) params.set('q', state.request.q);
  params.set('mode', state.request.mode);
  params.set('sort', state.request.sort);
  params.set('page', String(state.request.page));
  (state.request.savedSearchIds || []).forEach((id) => params.append('savedSearchId', id));
  for (const [key, value] of Object.entries(state.request.filters)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else if (value !== undefined && value !== '') params.set(key, String(value));
  }
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function currency(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function label(value) {
  return String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ');
}

function titleLabel(value) {
  return label(value).replace(/\b\w/g, (char) => char.toUpperCase());
}

function propertyTypeStyle(type) {
  return PROPERTY_TYPE_STYLES[type] || { color: '#4b5563', label: titleLabel(type) };
}

function selectedHit() {
  return (state.response?.hits || []).find((hit) => hit.id === state.selectedHitId);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Polling must not remove the keyboard user's current control.
function setHtmlPreservingFocus(element, html) {
  const focused = element.contains(document.activeElement) ? document.activeElement.id : null;
  element.innerHTML = html;
  if (focused) element.querySelector(`#${CSS.escape(focused)}`)?.focus({ preventScroll: true });
}

function provider() {
  return state.providers.find((item) => item.id === state.request.provider) || state.providers[0];
}

function savedSearchLabel(id) {
  return state.savedSearches.find((search) => search.id === id)?.name || id;
}

function savedSearchCountLabel(search) {
  return search.currentHitCount == null || search.evaluationError ? '?' : String(search.currentHitCount);
}

function filterValue(key, value) {
  return key === 'bedrooms' ? Number(value) : value;
}

function selectedFilterValues(key) {
  return (state.request.filters[key] || []).map((value) => String(value));
}

export {
  FACET_VISIBLE_LIMIT,
  RESULT_PAGE_SIZE,
  api,
  app,
  currency,
  escapeHtml,
  filterValue,
  label,
  propertyTypeStyle,
  provider,
  savedSearchCountLabel,
  savedSearchLabel,
  selectedFilterValues,
  selectedHit,
  setHtmlPreservingFocus,
  state,
  syncUrl,
  titleLabel
};
