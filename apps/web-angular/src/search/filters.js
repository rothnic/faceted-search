import {
  FACET_VISIBLE_LIMIT,
  escapeHtml,
  label,
  savedSearchCountLabel,
  selectedFilterValues,
  state
} from '../core.js';

export function renderToolbar() {
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

export function renderFilters() {
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
            <input type="checkbox" id="saved-filter-${escapeHtml(search.id)}" data-saved-search="${escapeHtml(search.id)}" ${savedIds.has(search.id) ? 'checked' : ''} />
            <span>${escapeHtml(search.name)}</span>
            <span class="count" title="${escapeHtml(search.evaluationError || 'Current match count')}">${savedSearchCountLabel(search)}</span>
          </label>
        `).join('') || `<span class="stats">${state.savedSearchesLoading ? 'Evaluating saved searches…' : state.savedSearchesError ? 'Saved searches unavailable' : 'No saved searches yet'}</span>`}
        ${state.savedSearchesError ? `<p class="notice error">${escapeHtml(state.savedSearchesError)}</p><button id="retry-saved">Retry saved searches</button>` : ''}
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
