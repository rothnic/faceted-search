import L from 'leaflet';
import {
  Virtualizer,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect
} from '@tanstack/virtual-core';
import {
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
  state,
  syncUrl,
  titleLabel
} from './core.js';

let searchDelegatesWired = false;

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
    pageSize: RESULT_PAGE_SIZE,
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
    pageSize: RESULT_PAGE_SIZE,
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
  syncHitDialog();
  document.querySelector('.detail-dialog')?.focus?.();
}

function closeHitDetails() {
  if (!state.selectedHitId) return;
  state.selectedHitId = null;
  syncHitDialog();
}

function syncHitDialog() {
  const existingDialog = document.querySelector('.modal-backdrop');
  if (existingDialog) existingDialog.remove();
  app.insertAdjacentHTML('beforeend', renderHitDialog());
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

export async function runSearch() {
  const requestId = ++state.searchRequestId;
  state.isLoadingMore = false;
  state.selectedHitId = null;
  syncUrl();
  const [response] = await Promise.all([
    api('/api/search', { method: 'POST', body: JSON.stringify(requestBody()) }),
    loadSync()
  ]);
  if (requestId !== state.searchRequestId) return;
  state.response = response;
  renderSearchPage();
}

export async function loadBootstrap() {
  const bootstrap = await api('/api/providers');
  state.providers = bootstrap.providers;
  state.catalog = bootstrap.fixtureCatalog;
  state.geoPresets = bootstrap.geoPresets;
}

async function loadSync() {
  state.sync = await api('/api/sync/status');
}

export async function loadSavedSearches() {
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

function renderResultCard(hit) {
  return `
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
  `;
}

function renderResults() {
  const response = state.response;
  if (!response) return '<section class="panel">Loading results...</section>';
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
      ${response.hits.length ? `
        <div class="virtual-summary stats" data-virtual-summary>Showing ${response.hits.length} of ${response.totalHits} loaded listings</div>
        <div id="result-list-scroll" class="result-list-scroll" data-loaded-count="${response.hits.length}" data-total-count="${response.totalHits}">
          <div id="result-list-spacer" class="result-list-spacer"></div>
        </div>
      ` : '<p>No listings match this search. You can still save it.</p>'}
    </section>
  `;
}

function hasNextResultsPage() {
  return Boolean(state.response && state.response.hits.length < state.response.totalHits);
}

function loadedResultsStatus() {
  if (!state.response) return '';
  if (state.isLoadingMore) return `Loading more listings... ${state.response.hits.length} of ${state.response.totalHits} loaded`;
  if (hasNextResultsPage()) return `${state.response.hits.length} of ${state.response.totalHits} loaded. Scroll for more.`;
  return `All ${state.response.totalHits} matching listings loaded.`;
}

function renderVirtualRows() {
  const scrollElement = document.querySelector('#result-list-scroll');
  const spacer = document.querySelector('#result-list-spacer');
  const summary = document.querySelector('[data-virtual-summary]');
  const virtualizer = state.resultVirtualizer;
  if (!scrollElement || !spacer || !virtualizer || !state.response) return;

  const hits = state.response.hits;
  const virtualItems = virtualizer.getVirtualItems();
  spacer.style.height = `${virtualizer.getTotalSize()}px`;
  spacer.innerHTML = virtualItems.map((virtualRow) => {
    const hit = hits[virtualRow.index];
    const isLoader = !hit;
    return `
      <div
        class="virtual-row ${isLoader ? 'virtual-loader' : ''}"
        data-index="${virtualRow.index}"
        style="transform: translateY(${virtualRow.start}px);"
      >
        ${hit ? renderResultCard(hit) : `<div class="result loading-row">${loadedResultsStatus()}</div>`}
      </div>
    `;
  }).join('');

  spacer.querySelectorAll('.virtual-row').forEach((row) => virtualizer.measureElement(row));
  scrollElement.dataset.loadedCount = String(hits.length);
  scrollElement.dataset.totalCount = String(state.response.totalHits);
  if (summary) summary.textContent = loadedResultsStatus();
  maybeLoadMoreResults();
}

function virtualizerOptions(scrollElement) {
  const count = state.response ? state.response.hits.length + (hasNextResultsPage() ? 1 : 0) : 0;
  return {
    count,
    getScrollElement: () => scrollElement,
    estimateSize: () => 178,
    overscan: 5,
    gap: 10,
    getItemKey: (index) => state.response?.hits[index]?.id ?? `loader-${state.response?.totalHits ?? 0}`,
    scrollToFn: elementScroll,
    observeElementRect,
    observeElementOffset,
    measureElement,
    onChange: () => renderVirtualRows()
  };
}

function setupVirtualizedResults() {
  state.resultVirtualCleanup?.();
  state.resultVirtualCleanup = null;
  state.resultVirtualizer = null;

  const scrollElement = document.querySelector('#result-list-scroll');
  if (!scrollElement || !state.response?.hits.length) return;

  const virtualizer = new Virtualizer(virtualizerOptions(scrollElement));
  state.resultVirtualizer = virtualizer;
  virtualizer._willUpdate();
  state.resultVirtualCleanup = virtualizer._didMount();
  renderVirtualRows();
}

function updateVirtualizedResults() {
  const scrollElement = document.querySelector('#result-list-scroll');
  if (!scrollElement || !state.resultVirtualizer) return;
  state.resultVirtualizer.setOptions(virtualizerOptions(scrollElement));
  state.resultVirtualizer._willUpdate();
  renderVirtualRows();
}

function maybeLoadMoreResults() {
  if (!state.resultVirtualizer || !hasNextResultsPage() || state.isLoadingMore) return;
  const lastItem = [...state.resultVirtualizer.getVirtualItems()].at(-1);
  if (!lastItem || !state.response) return;
  if (lastItem.index >= state.response.hits.length - 1) loadMoreResults();
}

async function loadMoreResults() {
  if (!state.response || state.isLoadingMore || !hasNextResultsPage()) return;
  const requestId = state.searchRequestId;
  state.isLoadingMore = true;
  renderVirtualRows();
  try {
    const nextPage = Math.floor(state.response.hits.length / state.response.pageSize) + 1;
    const nextResponse = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify({ ...requestBody(), page: nextPage, includeFacets: false })
    });
    if (requestId !== state.searchRequestId || !state.response) return;
    const existingIds = new Set(state.response.hits.map((hit) => hit.id));
    const nextHits = nextResponse.hits.filter((hit) => !existingIds.has(hit.id));
    state.response = {
      ...state.response,
      hits: [...state.response.hits, ...nextHits],
      page: nextResponse.page,
      totalHits: nextResponse.totalHits,
      processingTimeMs: nextResponse.processingTimeMs
    };
  } finally {
    state.isLoadingMore = false;
    updateVirtualizedResults();
  }
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
  syncHitDialog();
  wireSearchContent();
  updateSearchSuggestions();
  renderLeafletMap();
  setupVirtualizedResults();
}
