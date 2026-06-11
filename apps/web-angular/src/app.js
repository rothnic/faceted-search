import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import L from 'leaflet';
import {
  clearRefinements,
  configure,
  currentRefinements,
  hits,
  pagination,
  rangeInput,
  refinementList,
  searchBox,
  stats
} from 'instantsearch.js/es/widgets';
import 'leaflet/dist/leaflet.css';
import './styles.css';

const app = document.querySelector('#app');
const FACET_VISIBLE_LIMIT = 6;
const PROPERTY_TYPE_STYLES = {
  single_family: { color: '#2563eb', label: 'Single family' },
  townhouse: { color: '#059669', label: 'Townhouse' },
  condo: { color: '#7c3aed', label: 'Condo' },
  multi_family: { color: '#dc2626', label: 'Multi family' },
  land: { color: '#d97706', label: 'Land' }
};
let searchDelegatesWired = false;
const state = {
  providers: [],
  catalog: {},
  geoPresets: {},
  savedSearches: [],
  expandedFacets: {},
  response: null,
  resultMap: null,
  selectedHitId: null,
  request: requestFromUrl(),
  sync: null,
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
    pageSize: 12,
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
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
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

function provider() {
  return state.providers.find((item) => item.id === state.request.provider) || state.providers[0];
}

function savedSearchLabel(id) {
  return state.savedSearches.find((search) => search.id === id)?.name || id;
}

function savedSearchCountLabel(search) {
  return String(search.currentHitCount ?? 0);
}

function filterValue(key, value) {
  return key === 'bedrooms' ? Number(value) : value;
}

function selectedFilterValues(key) {
  return (state.request.filters[key] || []).map((value) => String(value));
}

function suggestionSources() {
  const cities = (state.catalog.cities || []).map((item) => ({ type: 'City', query: item.name }));
  const neighborhoods = (state.catalog.neighborhoods || []).map((item) => ({ type: 'Neighborhood', query: item.name }));
  const amenities = (state.catalog.amenities || []).map((item) => ({ type: 'Amenity', query: label(item) }));
  const propertyTypes = (state.catalog.propertyTypes || []).map((item) => ({ type: 'Property type', query: label(item) }));
  const saved = state.savedSearches.map((item) => ({ type: 'Saved search', query: item.name }));
  const hitTitles = (state.response?.hits || []).map((item) => ({ type: 'Listing', query: item.title }));
  return [...hitTitles, ...saved, ...cities, ...neighborhoods, ...amenities, ...propertyTypes];
}

function searchSuggestions(query) {
  const normalized = query.trim().toLowerCase();
  const seen = new Set();
  return suggestionSources()
    .filter((item) => !normalized || item.query.toLowerCase().includes(normalized))
    .filter((item) => {
      const key = item.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function renderSearchSuggestions() {
  const input = document.querySelector('#search-box');
  const suggestions = searchSuggestions(input?.value || '');
  if (!suggestions.length) return '<div class="suggestion-empty">No suggestions</div>';
  return suggestions.map((item) => `
    <button type="button" class="suggestion-option" data-search-suggestion="${escapeHtml(item.query)}">
      <span>${escapeHtml(item.query)}</span>
      <span>${escapeHtml(item.type)}</span>
    </button>
  `).join('');
}

function updateSearchSuggestions(show = document.activeElement?.id === 'search-box') {
  const menu = document.querySelector('#search-suggestions');
  if (!menu) return;
  menu.innerHTML = show ? renderSearchSuggestions() : '';
  menu.hidden = !show;
}

function applySearchSuggestion(query) {
  state.request.q = query;
  state.request.page = 1;
  updateToolbarControls();
  updateSearchSuggestions(false);
  runSearch();
}

function setFilter(key, value, checked) {
  const nextValue = filterValue(key, value);
  const current = new Map((state.request.filters[key] || []).map((item) => [String(item), item]));
  if (checked) current.set(String(nextValue), nextValue);
  else current.delete(String(nextValue));
  state.request.filters[key] = [...current.values()];
  state.request.page = 1;
  runSearch();
}

function setSavedSearch(id, checked) {
  const current = new Set(state.request.savedSearchIds || []);
  if (checked) current.add(id);
  else current.delete(id);
  state.request.savedSearchIds = [...current];
  state.request.page = 1;
  runSearch();
}

function applySavedSearchOnly(id) {
  state.request = {
    provider: state.request.provider,
    q: '',
    mode: state.request.mode,
    filters: {},
    sort: 'relevance',
    page: 1,
    pageSize: 12,
    includeFacets: true,
    savedSearchIds: [id]
  };
  updateToolbarControls();
  runSearch();
}

function removeRefinement(button) {
  const action = button.dataset.removeRefinement;
  if (action === 'q') state.request.q = '';
  if (action === 'saved') {
    state.request.savedSearchIds = (state.request.savedSearchIds || []).filter((id) => id !== button.dataset.value);
  }
  if (action === 'filter') {
    const key = button.dataset.key;
    if (!key) return;
    const value = button.dataset.value;
    if (Array.isArray(state.request.filters[key]) && value !== undefined) {
      state.request.filters[key] = state.request.filters[key].filter((item) => String(item) !== value);
    } else {
      delete state.request.filters[key];
    }
  }
  if (action === 'geo') delete state.request.geo;
  if (action === 'viewport') delete state.request.viewport;
  state.request.page = 1;
  updateToolbarControls();
  runSearch();
}

function setRange(key, value) {
  state.request.filters[key] = value === '' ? undefined : Number(value);
  state.request.page = 1;
  runSearch();
}

function clearFilters() {
  state.request = {
    provider: state.request.provider,
    q: '',
    mode: 'hybrid',
    filters: {},
    sort: 'relevance',
    page: 1,
    pageSize: 12,
    includeFacets: true,
    savedSearchIds: []
  };
  updateToolbarControls();
  runSearch();
}

function applyGeoPreset(value) {
  delete state.request.geo;
  if (value === 'huntsville') state.request.geo = { lat: 34.7304, lng: -86.5861, radiusMiles: 5 };
  if (value === 'madison') state.request.geo = { lat: 34.6993, lng: -86.7483, radiusMiles: 10 };
  if (value === 'redstone') state.request.geo = { lat: 34.6841, lng: -86.654, radiusMiles: 15 };
  state.request.page = 1;
  runSearch();
}

function toggleViewport(checked) {
  state.request.viewport = checked
    ? { minLat: 34.61, maxLat: 34.77, minLng: -86.82, maxLng: -86.55 }
    : undefined;
  state.request.page = 1;
  runSearch();
}

function openHitDetails(id) {
  state.selectedHitId = id;
  renderSearchPage();
  document.querySelector('.detail-dialog')?.focus?.();
}

function closeHitDetails() {
  if (!state.selectedHitId) return;
  state.selectedHitId = null;
  renderSearchPage();
}

function requestBody() {
  const filters = Object.fromEntries(
    Object.entries(state.request.filters || {}).filter(([, value]) => !(Array.isArray(value) && value.length === 0) && value !== undefined && value !== '')
  );
  return { ...state.request, filters };
}

let searchTimer;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
}

async function runSearch() {
  const requestId = ++state.searchRequestId;
  syncUrl();
  const [response] = await Promise.all([
    api('/api/search', { method: 'POST', body: JSON.stringify(requestBody()) }),
    loadSync()
  ]);
  if (requestId !== state.searchRequestId) return;
  state.response = response;
  renderSearchPage();
}

async function loadBootstrap() {
  const bootstrap = await api('/api/providers');
  state.providers = bootstrap.providers;
  state.catalog = bootstrap.fixtureCatalog;
  state.geoPresets = bootstrap.geoPresets;
}

async function loadSync() {
  state.sync = await api('/api/sync/status');
}

async function loadSavedSearches() {
  const data = await api('/api/saved-searches');
  state.savedSearches = data.savedSearches;
}

function renderToolbar() {
  return `
    <section class="toolbar">
      <div class="field">
        <label for="provider">Provider</label>
        <select id="provider">
          ${state.providers.map((item) => `<option value="${item.id}" ${item.id === state.request.provider ? 'selected' : ''}>${item.label}</option>`).join('')}
        </select>
      </div>
      <div class="field search-field">
        <label for="search-box">Search</label>
        <input id="search-box" value="${escapeHtml(state.request.q || '')}" placeholder="hampton cove garage" />
        <div id="search-suggestions" class="suggestions" hidden></div>
      </div>
      <div class="field">
        <span class="label">Mode</span>
        <div class="segmented">
          ${['keyword', 'semantic', 'hybrid'].map((mode) => `<button type="button" data-mode="${mode}" class="${state.request.mode === mode ? 'active' : ''}">${mode}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label for="sort">Sort</label>
        <select id="sort">
          ${['relevance', 'distance', 'price_asc', 'price_desc', 'newest'].map((item) => `<option value="${item}" ${item === state.request.sort ? 'selected' : ''}>${label(item)}</option>`).join('')}
        </select>
      </div>
    </section>
  `;
}

function renderFacetGroup(title, key) {
  const buckets = state.response?.facets?.[key] || [];
  const selected = new Set(selectedFilterValues(key));
  const selectedOnlyBuckets = [...selected]
    .filter((value) => !buckets.some((bucket) => String(bucket.value) === value))
    .map((value) => ({ value, count: 0 }));
  const orderedBuckets = [...buckets, ...selectedOnlyBuckets].sort((a, b) => {
    const aSelected = selected.has(String(a.value));
    const bSelected = selected.has(String(b.value));
    if (aSelected !== bSelected) return aSelected ? -1 : 1;
    return b.count - a.count || String(a.value).localeCompare(String(b.value));
  });
  const selectedCount = orderedBuckets.filter((bucket) => selected.has(String(bucket.value))).length;
  const visibleLimit = state.expandedFacets[key] ? orderedBuckets.length : Math.max(FACET_VISIBLE_LIMIT, selectedCount);
  const visibleBuckets = orderedBuckets.slice(0, visibleLimit);
  const hasOverflow = orderedBuckets.length > FACET_VISIBLE_LIMIT;
  return `
    <div class="facet-group" data-facet="${key}">
      <div class="facet-title">
        <strong>${title}</strong>
        ${orderedBuckets.length ? `<span class="stats">${orderedBuckets.length}</span>` : ''}
      </div>
      ${visibleBuckets.map((bucket) => `
        <label class="facet-option">
          <input type="checkbox" data-filter="${key}" value="${bucket.value}" ${selected.has(String(bucket.value)) ? 'checked' : ''} />
          <span>${label(bucket.value)}</span>
          <span class="count">${bucket.count}</span>
        </label>
      `).join('') || '<span class="stats">No facet values</span>'}
      ${hasOverflow ? `<button type="button" class="link-button" data-toggle-facet="${key}">${state.expandedFacets[key] ? 'Show fewer' : `Show ${orderedBuckets.length - visibleBuckets.length} more`}</button>` : ''}
    </div>
  `;
}

function renderFilters() {
  const savedIds = new Set(state.request.savedSearchIds || []);
  return `
    <aside class="panel">
      <h2>Filters</h2>
      <button type="button" id="clear-filters">Clear filters</button>
      <hr />
      <div class="facet-group" data-facet="saved-searches">
        <div class="facet-title">
          <strong>Saved Searches</strong>
          ${savedIds.size && state.response ? `<span class="stats">${state.response.totalHits} matches</span>` : ''}
        </div>
        ${state.savedSearches.map((search) => `
          <label class="facet-option">
            <input type="checkbox" data-saved-search="${search.id}" ${savedIds.has(search.id) ? 'checked' : ''} />
            <span>${escapeHtml(search.name)}</span>
            <span class="count">${savedSearchCountLabel(search)}</span>
          </label>
        `).join('') || '<span class="stats">No saved searches yet</span>'}
        ${savedIds.size > 1 ? '<span class="stats">Selected saved searches are ORed together.</span>' : ''}
      </div>
      ${renderFacetGroup('City', 'city')}
      ${renderFacetGroup('Neighborhood', 'neighborhood')}
      ${renderFacetGroup('School district', 'schoolDistrict')}
      ${renderFacetGroup('Property type', 'propertyType')}
      ${renderFacetGroup('Bedrooms', 'bedrooms')}
      ${renderFacetGroup('Amenities', 'amenities')}
      ${renderFacetGroup('Listing status', 'listingStatus')}
      <h3>Ranges</h3>
      <div class="range-grid">
        <div class="field"><label>Min price</label><input data-range="minPrice" type="number" value="${state.request.filters.minPrice || ''}" /></div>
        <div class="field"><label>Max price</label><input data-range="maxPrice" type="number" value="${state.request.filters.maxPrice || ''}" /></div>
        <div class="field"><label>Min sqft</label><input data-range="minSquareFeet" type="number" value="${state.request.filters.minSquareFeet || ''}" /></div>
        <div class="field"><label>Min lot acres</label><input data-range="minLotSize" type="number" step="0.1" value="${state.request.filters.minLotSize || ''}" /></div>
        <div class="field"><label>Min year</label><input data-range="minYearBuilt" type="number" value="${state.request.filters.minYearBuilt || ''}" /></div>
        <div class="field"><label>Max year</label><input data-range="maxYearBuilt" type="number" value="${state.request.filters.maxYearBuilt || ''}" /></div>
      </div>
      <h3>Geo</h3>
      <div class="geo-grid">
        <button type="button" data-geo="huntsville">5 mi Huntsville</button>
        <button type="button" data-geo="madison">10 mi Madison</button>
        <button type="button" data-geo="redstone">15 mi Redstone</button>
        <button type="button" data-geo="">Clear geo</button>
      </div>
      <label class="facet-option" style="margin-top:10px">
        <input id="viewport" type="checkbox" ${state.request.viewport ? 'checked' : ''} />
        <span>Inside map viewport</span>
        <span></span>
      </label>
    </aside>
  `;
}

function renderRefinements() {
  const parts = [];
  if (state.request.q) parts.push({ label: `q: ${state.request.q}`, action: 'q' });
  for (const id of state.request.savedSearchIds || []) parts.push({ label: `saved: ${savedSearchLabel(id)}`, action: 'saved', value: id });
  for (const [key, value] of Object.entries(state.request.filters)) {
    if (Array.isArray(value)) value.forEach((item) => parts.push({ label: `${key}: ${label(item)}`, action: 'filter', key, value: item }));
    else if (value !== undefined) parts.push({ label: `${key}: ${value}`, action: 'filter', key });
  }
  if (state.request.geo) parts.push({ label: `radius: ${state.request.geo.radiusMiles} miles`, action: 'geo' });
  if (state.request.viewport) parts.push({ label: 'inside map viewport', action: 'viewport' });
  return `<div class="refinements">${parts.map((part) => `
    <button type="button" class="pill refinement-pill" data-remove-refinement="${part.action}" ${part.key ? `data-key="${part.key}"` : ''} ${part.value !== undefined ? `data-value="${escapeHtml(part.value)}"` : ''}>
      <span>${escapeHtml(part.label)}</span>
      <span aria-hidden="true">x</span>
    </button>
  `).join('') || '<span class="stats">No refinements selected</span>'}</div>`;
}

function renderResultMap() {
  const hitsForMap = state.response?.mapHits || [];
  if (!hitsForMap.length) return '';
  const legendTypes = [...new Set(hitsForMap.map((hit) => hit.propertyType))];
  return `
    <section class="result-map" aria-label="Map of visible results">
      <div class="map-head">
        <div>
          <strong>Map</strong>
          <span class="stats">${hitsForMap.length} matching listings</span>
        </div>
        <div class="map-legend" aria-label="Map marker legend">
          ${legendTypes.map((type) => {
            const style = propertyTypeStyle(type);
            return `<span><i style="background:${style.color}"></i>${escapeHtml(style.label)}</span>`;
          }).join('')}
        </div>
      </div>
      <div id="result-map" class="leaflet-result-map" role="img" aria-label="Interactive map of matching search results"></div>
    </section>
  `;
}

function renderLeafletMap() {
  const mapElement = document.querySelector('#result-map');
  if (state.resultMap) {
    state.resultMap.remove();
    state.resultMap = null;
  }
  if (!mapElement || !state.response?.mapHits?.length) return;

  const map = L.map(mapElement, {
    scrollWheelZoom: false,
    zoomControl: true
  });
  state.resultMap = map;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const bounds = [];
  for (const hit of state.response.mapHits) {
    const point = [hit.lat, hit.lng];
    const style = propertyTypeStyle(hit.propertyType);
    bounds.push(point);
    L.circleMarker(point, {
      radius: 4.75,
      color: '#ffffff',
      weight: 1.5,
      fillColor: style.color,
      fillOpacity: 0.88
    })
      .bindPopup(`
        <strong>${escapeHtml(hit.title)}</strong><br />
        ${currency(hit.price)} · ${escapeHtml(style.label)}<br />
        ${escapeHtml(hit.city)}${hit.neighborhood ? `, ${escapeHtml(hit.neighborhood)}` : ''}
      `)
      .addTo(map);
  }

  if (bounds.length === 1) map.setView(bounds[0], 13);
  else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
}

function detailItem(labelText, value) {
  if (value === undefined || value === null || value === '') return '';
  return `
    <div class="detail-item">
      <dt>${escapeHtml(labelText)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderHitDialog() {
  const hit = selectedHit();
  if (!hit) return '';
  const coreItems = [
    ['Price', currency(hit.price)],
    ['Property type', titleLabel(hit.propertyType)],
    ['Status', titleLabel(hit.listingStatus)],
    ['Bedrooms', hit.bedrooms],
    ['Bathrooms', hit.bathrooms],
    ['Square feet', hit.squareFeet ? hit.squareFeet.toLocaleString() : '0'],
    ['Lot acres', hit.lotSizeAcres],
    ['Year built', hit.yearBuilt]
  ];
  const locationItems = [
    ['Address', `${hit.addressLine1}, ${hit.city} ${hit.zipCode}`],
    ['Neighborhood', hit.neighborhood],
    ['School district', hit.schoolDistrict],
    ['Coordinates', `${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`],
    ['Distance', hit.distanceMiles !== undefined ? `${hit.distanceMiles.toFixed(1)} mi away` : undefined]
  ];
  const searchItems = [
    ['Matched terms', hit.matchedTerms?.length ? hit.matchedTerms.join(', ') : 'None'],
    ['Created', new Date(hit.createdAt).toLocaleDateString()],
    ['Updated', new Date(hit.updatedAt).toLocaleDateString()]
  ];
  const style = propertyTypeStyle(hit.propertyType);
  return `
    <div class="modal-backdrop" data-close-dialog="true">
      <section class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
        <div class="detail-hero" style="border-color:${style.color}">
          <div>
            <span class="result-type" style="--type-color:${style.color}">${escapeHtml(style.label)}</span>
            <h2 id="detail-title">${escapeHtml(hit.title)}</h2>
            <p>${escapeHtml(hit.description)}</p>
          </div>
          <button type="button" class="icon-button" data-close-dialog="true" aria-label="Close details">x</button>
        </div>
        <div class="detail-body">
          <section>
            <h3>Structured details</h3>
            <dl class="detail-grid">${coreItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Location</h3>
            <dl class="detail-grid">${locationItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Search metadata</h3>
            <dl class="detail-grid">${searchItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Amenities</h3>
            <div class="amenities">${hit.amenities.map((item) => `<button type="button" class="pill hit-chip" data-hit-filter="amenities" data-value="${escapeHtml(item)}">${label(item)}</button>`).join('')}</div>
          </section>
          <section>
            <h3>Tags</h3>
            <div class="amenities">${hit.tags.map((item) => `<span class="pill">${label(item)}</span>`).join('') || '<span class="stats">No tags</span>'}</div>
          </section>
          <section class="detail-json">
            <h3>Structured JSON</h3>
            <pre>${escapeHtml(JSON.stringify(hit, null, 2))}</pre>
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderResults() {
  const response = state.response;
  if (!response) return '<section class="panel">Loading results...</section>';
  const totalPages = Math.max(1, Math.ceil(response.totalHits / response.pageSize));
  return `
    <section class="panel">
      <div class="results-head">
        <div>
          <h2>Results</h2>
          <div class="stats">${response.totalHits} hits from ${response.providerLabel} in ${response.processingTimeMs} ms</div>
        </div>
        <button type="button" class="primary" id="save-search">Save search</button>
      </div>
      ${renderRefinements()}
      ${renderResultMap()}
      <div class="result-list">
        ${response.hits.map((hit) => `
          <article class="result" data-house-id="${hit.id}" data-open-hit="${hit.id}" tabindex="0">
            <div class="result-topline">
              <span class="result-type" style="--type-color:${propertyTypeStyle(hit.propertyType).color}">${escapeHtml(propertyTypeStyle(hit.propertyType).label)}</span>
              <span class="status-pill">${titleLabel(hit.listingStatus)}</span>
            </div>
            <h3>${escapeHtml(hit.title)}</h3>
            <div class="meta">
              <span>${currency(hit.price)}</span>
              <span>${hit.bedrooms} bd</span>
              <span>${hit.bathrooms} ba</span>
              <span>${hit.squareFeet.toLocaleString()} sqft</span>
              <span>${hit.city}${hit.neighborhood ? `, ${hit.neighborhood}` : ''}</span>
              <span>${hit.schoolDistrict || ''}</span>
              ${hit.distanceMiles !== undefined ? `<span>${hit.distanceMiles.toFixed(1)} mi away</span>` : ''}
            </div>
            <p>${escapeHtml(hit.description)}</p>
            <div class="result-actions">
              <div class="amenities">${hit.amenities.map((item) => `<button type="button" class="pill hit-chip" data-hit-filter="amenities" data-value="${escapeHtml(item)}">${label(item)}</button>`).join('')}</div>
              <button type="button" class="button-link" data-open-hit="${hit.id}">Details</button>
            </div>
          </article>
        `).join('') || '<p>No listings match this search. You can still save it.</p>'}
      </div>
      <div class="action-row">
        <button id="prev-page" ${response.page <= 1 ? 'disabled' : ''}>Previous</button>
        <button id="next-page" ${response.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </section>
  `;
}

function renderDebug() {
  const currentProvider = provider();
  return `
    <aside class="panel debug">
      <h2>Provider Debug</h2>
      <p class="stats">${currentProvider?.capabilities?.requiresExternalSync ? 'External index with outbox sync.' : 'Postgres-hosted search, no external sync.'}</p>
      <pre>${JSON.stringify({ request: requestBody(), debug: state.response?.debug }, null, 2)}</pre>
      <h3>Sync Status</h3>
      <pre>${JSON.stringify(state.sync, null, 2)}</pre>
      <div class="action-row">
        <button data-backfill="meilisearch">Backfill Meili</button>
        <button data-backfill="typesense">Backfill Typesense</button>
        <button id="run-worker">Run worker</button>
        <button id="mark-sold">Mark first result sold</button>
      </div>
    </aside>
  `;
}

function updateToolbarControls() {
  const searchBoxInput = document.querySelector('#search-box');
  if (searchBoxInput && searchBoxInput.value !== (state.request.q || '')) searchBoxInput.value = state.request.q || '';
  const providerSelect = document.querySelector('#provider');
  if (providerSelect) providerSelect.value = state.request.provider;
  const sortSelect = document.querySelector('#sort');
  if (sortSelect) sortSelect.value = state.request.sort;
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.request.mode);
  });
}

function wireSearchToolbar() {
  document.querySelector('#provider')?.addEventListener('change', (event) => {
    state.request.provider = event.target.value;
    state.request.page = 1;
    runSearch();
  });
  document.querySelector('#search-box')?.addEventListener('input', (event) => {
    state.request.q = event.target.value;
    state.request.page = 1;
    updateSearchSuggestions(true);
    scheduleSearch();
  });
  document.querySelector('#search-box')?.addEventListener('focus', () => updateSearchSuggestions(true));
  document.querySelector('#search-box')?.addEventListener('blur', () => {
    setTimeout(() => updateSearchSuggestions(false), 120);
  });
  document.querySelector('#sort')?.addEventListener('change', (event) => {
    state.request.sort = event.target.value;
    state.request.page = 1;
    runSearch();
  });
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
    state.request.mode = button.dataset.mode;
    state.request.page = 1;
    updateToolbarControls();
    runSearch();
  }));
}

function wireSearchContent() {
  document.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('change', () => setFilter(input.dataset.filter, input.value, input.checked)));
  document.querySelectorAll('[data-saved-search]').forEach((input) => input.addEventListener('change', () => setSavedSearch(input.dataset.savedSearch, input.checked)));
  document.querySelectorAll('[data-range]').forEach((input) => input.addEventListener('change', () => setRange(input.dataset.range, input.value)));
  document.querySelector('#viewport')?.addEventListener('change', (event) => toggleViewport(event.target.checked));
}

function wireSearchDelegates() {
  if (searchDelegatesWired) return;
  searchDelegatesWired = true;
  app.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.dataset.closeDialog && (event.target.classList.contains('modal-backdrop') || event.target.tagName === 'BUTTON')) return closeHitDetails();
    const target = event.target.closest('button');

    if (target && app.contains(target)) {
      if (target.dataset.openHit) return openHitDetails(target.dataset.openHit);
      if (target.dataset.searchSuggestion) return applySearchSuggestion(target.dataset.searchSuggestion);
      if (target.dataset.removeRefinement) return removeRefinement(target);
      if (target.dataset.hitFilter) return setFilter(target.dataset.hitFilter, target.dataset.value, true);
      if (target.dataset.toggleFacet) {
        state.expandedFacets[target.dataset.toggleFacet] = !state.expandedFacets[target.dataset.toggleFacet];
        return renderSearchPage();
      }
      if (target.dataset.geo !== undefined) return applyGeoPreset(target.dataset.geo);
      if (target.id === 'clear-filters') return clearFilters();
      if (target.id === 'prev-page') {
        state.request.page -= 1;
        return runSearch();
      }
      if (target.id === 'next-page') {
        state.request.page += 1;
        return runSearch();
      }
      if (target.id === 'save-search') {
        const name = prompt('Saved search name', state.request.q || 'Zero-hit saved search');
        if (!name) return;
        const saved = await api('/api/saved-searches', { method: 'POST', body: JSON.stringify({ name, criteria: requestBody() }) });
        await loadSavedSearches();
        if (!state.savedSearches.some((search) => search.id === saved.id)) state.savedSearches.unshift(saved);
        applySavedSearchOnly(saved.id);
        return;
      }
      if (target.dataset.backfill) {
        await api('/api/sync/backfill', { method: 'POST', body: JSON.stringify({ provider: target.dataset.backfill }) });
        await runSearch();
        return;
      }
      if (target.id === 'run-worker') {
        await api('/api/sync/worker/run', { method: 'POST', body: '{}' });
        await runSearch();
        return;
      }
      if (target.id === 'mark-sold') {
        const first = state.response?.hits?.[0];
        if (!first) return;
        await api(`/api/houses/${first.id}`, { method: 'PATCH', body: JSON.stringify({ listingStatus: 'sold' }) });
        await runSearch();
        return;
      }
    }

    const card = event.target.closest('.result[data-open-hit]');
    if (card && app.contains(card)) return openHitDetails(card.dataset.openHit);
  });
  app.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') return closeHitDetails();
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!(event.target instanceof Element)) return;
    const card = event.target.closest('.result[data-open-hit]');
    if (!card || event.target.closest('button')) return;
    event.preventDefault();
    openHitDetails(card.dataset.openHit);
  });
}

function renderSearchPage() {
  if (!document.querySelector('#search-filters')) {
    app.innerHTML = `
      ${renderToolbar()}
      <div class="layout">
        <div id="search-filters"></div>
        <div id="search-results"></div>
        <div id="search-debug"></div>
      </div>
    `;
    wireSearchToolbar();
    wireSearchDelegates();
  }
  updateToolbarControls();
  document.querySelector('#search-filters').innerHTML = renderFilters();
  document.querySelector('#search-results').innerHTML = renderResults();
  document.querySelector('#search-debug').innerHTML = renderDebug();
  const existingDialog = document.querySelector('.modal-backdrop');
  if (existingDialog) existingDialog.remove();
  app.insertAdjacentHTML('beforeend', renderHitDialog());
  wireSearchContent();
  updateSearchSuggestions();
  renderLeafletMap();
}

async function renderSavedSearches() {
  const data = await api('/api/saved-searches');
  app.innerHTML = `
    <section class="panel">
      <h2>Saved Searches</h2>
      <p class="stats">Saved criteria are kept even when the current hit count is zero.</p>
      <div class="saved-list">
        ${data.savedSearches.map((search) => `
          <article class="saved-row">
            <h3>${search.name}</h3>
            <div class="meta">
              <span>${search.provider}</span>
              <span>${search.lastEvaluatedAt ? `${search.currentHitCount} current hits` : 'Not evaluated yet'}</span>
              <span>${search.newMatchesSinceLastEvaluation} new matches</span>
              <span>${search.lastEvaluatedAt ? `Evaluated ${new Date(search.lastEvaluatedAt).toLocaleString()}` : 'Never evaluated'}</span>
            </div>
            <pre>${JSON.stringify(search.criteria, null, 2)}</pre>
            <div class="action-row">
              <a class="button-link" href="/search?savedSearchId=${encodeURIComponent(search.id)}">Apply</a>
              <button data-evaluate="${search.id}">Evaluate now</button>
            </div>
          </article>
        `).join('') || '<p>No saved searches yet.</p>'}
      </div>
    </section>
  `;
  document.querySelectorAll('[data-evaluate]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/saved-searches/${button.dataset.evaluate}/evaluate`, { method: 'POST', body: '{}' });
    renderSavedSearches();
  }));
}

function renderProviders() {
  const capabilityNames = ['keywordSearch', 'faceting', 'rangeFacets', 'geoRadius', 'geoSort', 'semanticSearch', 'hybridSearch', 'instantSearchDirectAdapter', 'requiresExternalSync', 'supportsSavedSearchEvaluation'];
  app.innerHTML = `
    <section class="panel">
      <h2>Provider Comparison</h2>
      <table class="matrix">
        <thead>
          <tr><th>Capability</th>${state.providers.map((item) => `<th>${item.label}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${capabilityNames.map((name) => `
            <tr>
              <th>${label(name)}</th>
              ${state.providers.map((item) => `<td>${String(item.capabilities[name])}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
    <section class="grid-two" style="margin-top:14px">
      ${state.providers.map((item) => `
        <article class="panel">
          <h3>${item.label}</h3>
          <p><strong>Sync requirements:</strong> ${item.syncRequirements}</p>
          <p><strong>Setup notes:</strong> ${item.setupNotes.join('; ')}</p>
          <p><strong>Schema/index requirements:</strong> ${item.schemaRequirements.join('; ')}</p>
          <p><strong>Known limitations:</strong> ${item.knownLimitations.join('; ')}</p>
        </article>
      `).join('')}
    </section>
  `;
}

const instantFacetAttributes = ['cityFacet', 'neighborhoodFacet', 'schoolDistrictFacet', 'propertyTypeFacet', 'bedrooms', 'amenities', 'listingStatusFacet'];

function directInstantSearchClient(providerId) {
  if (providerId === 'typesense') {
    const adapter = new TypesenseInstantSearchAdapter({
      server: {
        apiKey: 'dev_typesense_api_key',
        nodes: [{ host: '127.0.0.1', port: 8108, protocol: 'http' }]
      },
      additionalSearchParameters: {
        query_by: 'title,description,semanticText,city,neighborhood,schoolDistrict,amenities,tags',
        facet_by: instantFacetAttributes.join(','),
        max_facet_values: 20
      }
    });
    return adapter.searchClient;
  }

  return instantMeiliSearch('http://127.0.0.1:7700', 'dev_meili_master_key', {
    finitePagination: true,
    primaryKey: 'id',
    meiliSearchParams: {
      facets: instantFacetAttributes,
      attributesToRetrieve: ['*']
    }
  }).searchClient;
}

function instantResultTemplate(hit) {
  const amenities = Array.isArray(hit.amenities) ? hit.amenities : [];
  return `
    <article class="result instant-hit" data-house-id="${escapeHtml(hit.id)}">
      <h3>${escapeHtml(hit.title)}</h3>
      <div class="meta">
        <span>${currency(hit.price || 0)}</span>
        <span>${escapeHtml(hit.bedrooms)} bd</span>
        <span>${escapeHtml(hit.bathrooms)} ba</span>
        <span>${Number(hit.squareFeet || 0).toLocaleString()} sqft</span>
        <span>${escapeHtml(hit.city)}${hit.neighborhood ? `, ${escapeHtml(hit.neighborhood)}` : ''}</span>
        <span>${escapeHtml(hit.schoolDistrict || '')}</span>
        <span>${label(hit.listingStatus)}</span>
      </div>
      <p>${escapeHtml(hit.description)}</p>
      <div class="amenities">${amenities.map((item) => `<span class="pill">${label(item)}</span>`).join('')}</div>
    </article>
  `;
}

async function renderInstant(providerId) {
  const title = providerId === 'typesense' ? 'Typesense InstantSearch Demo' : 'Meilisearch InstantSearch Demo';
  const adapterLabel = providerId === 'typesense' ? 'typesense-instantsearch-adapter' : '@meilisearch/instant-meilisearch';
  app.innerHTML = `
    <section class="instant-shell" data-instant-provider="${providerId}">
      <div class="results-head">
        <div>
          <h2>${title}</h2>
          <p class="stats">Bundled with Vite using InstantSearch.js widgets and ${adapterLabel}: searchBox, refinementList, rangeInput, currentRefinements, clearRefinements, hits, stats, and pagination.</p>
        </div>
      </div>
      <div class="instant-grid">
        <aside class="panel instant-panel">
          <div id="instant-searchbox"></div>
          <div id="instant-current-refinements"></div>
          <div id="instant-clear-refinements"></div>
          <h3>Facets</h3>
          <strong>City</strong>
          <div id="instant-city"></div>
          <strong>Property type</strong>
          <div id="instant-property-type"></div>
          <strong>Amenities</strong>
          <div id="instant-amenities"></div>
          <strong>Listing status</strong>
          <div id="instant-listing-status"></div>
          <h3>Ranges</h3>
          <strong>Price</strong>
          <div id="instant-price"></div>
          <strong>Square feet</strong>
          <div id="instant-square-feet"></div>
        </aside>
        <div>
          <section class="panel">
            <div id="instant-stats"></div>
            <div id="instant-hits"></div>
            <div id="instant-pagination"></div>
          </section>
        </div>
      </div>
    </section>
  `;

  const search = instantsearch({
    indexName: 'houses',
    searchClient: directInstantSearchClient(providerId),
    routing: false
  });

  search.addWidgets([
    configure({ hitsPerPage: 12 }),
    searchBox({
      container: '#instant-searchbox',
      placeholder: 'hampton cove garage',
      autofocus: true,
      showReset: true,
      showSubmit: true
    }),
    currentRefinements({ container: '#instant-current-refinements' }),
    clearRefinements({ container: '#instant-clear-refinements' }),
    refinementList({ container: '#instant-city', attribute: 'cityFacet', limit: 8 }),
    refinementList({ container: '#instant-property-type', attribute: 'propertyTypeFacet', limit: 8 }),
    refinementList({ container: '#instant-amenities', attribute: 'amenities', limit: 8 }),
    refinementList({ container: '#instant-listing-status', attribute: 'listingStatusFacet', limit: 8 }),
    rangeInput({ container: '#instant-price', attribute: 'price' }),
    rangeInput({ container: '#instant-square-feet', attribute: 'squareFeet' }),
    stats({ container: '#instant-stats' }),
    hits({
      container: '#instant-hits',
      templates: {
        item: instantResultTemplate,
        empty: '<p>No listings match this direct adapter search.</p>'
      }
    }),
    pagination({ container: '#instant-pagination' })
  ]);
  search.start();
}

async function route() {
  await loadBootstrap();
  await loadSavedSearches();
  if (location.pathname === '/providers') return renderProviders();
  if (location.pathname === '/saved-searches') return renderSavedSearches();
  if (location.pathname === '/search/instant/typesense') return renderInstant('typesense');
  if (location.pathname === '/search/instant/meilisearch') return renderInstant('meilisearch');
  await runSearch();
}

route().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Application error</h2><pre>${error.stack || error.message}</pre></section>`;
});
