import { renderSystemStrip } from '../system-status.js';
import {
  FACET_VISIBLE_LIMIT,
  escapeHtml,
  label,
  savedSearchCountLabel,
  selectedFilterValues,
  state
} from '../core.js';

const providerControlLabel = (item) => ({postgres_native:'PostgreSQL', pg_search:'pg_search', meilisearch:'Meilisearch', typesense:'Typesense'}[item.id] || item.label);

export function renderToolbar() {
  return `
    <section class="toolbar card">
      <div class="toolbar-heading"><h1>Find homes</h1><div id="system-summary">${renderSystemStrip()}</div>${state.storageMode === 'memory' ? '<span class="badge badge-outline demo-label">Sample data</span>' : ''}</div>
      <div class="field search-field">
        <label class="search-accessible-label" for="search-box">Search</label>
        <div class="search-input-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input class="input input-lg" id="search-box" value="${escapeHtml(state.request.q || '')}" placeholder="Search homes, neighborhoods, or features…" autocomplete="off" /><button type="button" class="btn btn-ghost" id="clear-query" aria-label="Clear query" ${state.request.q ? '' : 'hidden'}><span aria-hidden="true">×</span></button></div>
        <div id="search-suggestions" class="suggestions" hidden></div>
      </div>
      <div class="search-options">
        <div class="field mode-field"><label for="search-mode">Mode</label><select class="select select-sm" id="search-mode">${['keyword', 'semantic', 'hybrid'].map((mode) => `<option value="${mode}" ${state.request.mode === mode ? 'selected' : ''}>${label(mode)}</option>`).join('')}</select></div>
        <div class="field provider-field"><label for="provider">Provider</label><select class="select select-sm" id="provider">${state.providers.map((item) => `<option value="${item.id}" ${item.id === state.request.provider ? 'selected' : ''}>${escapeHtml(providerControlLabel(item))}</option>`).join('')}</select></div>
        <div class="field sort-field"><label for="sort">Sort</label><select class="select select-sm" id="sort" aria-label="Sort results">${['relevance', 'distance', 'price_asc', 'price_desc', 'newest'].map((item) => `<option value="${item}" ${item === state.request.sort ? 'selected' : ''}>${label(item)}</option>`).join('')}</select></div>
      </div>
      <div class="mobile-search-actions"><button id="toggle-filters" class="btn btn-sm btn-primary mobile-filter-toggle" aria-label="Show or hide filters" aria-controls="search-filters" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M5 10h10M8 15h4"/></svg>Filters <span id="active-filter-count" class="filter-count" hidden></span></button></div>
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
    <fieldset class="fieldset facet-group" data-facet="${key}">
      <legend class="fieldset-legend facet-title">
        <strong>${title}</strong>
        ${orderedBuckets.length ? `<span class="stats">${orderedBuckets.length}</span>` : ''}
      </legend>
      ${visibleBuckets.map((bucket) => `
        <label class="facet-option">
          <input class="checkbox checkbox-sm" type="checkbox" id="facet-${encodeURIComponent(key)}-${encodeURIComponent(String(bucket.value))}" data-filter="${key}" value="${escapeHtml(bucket.value)}" ${selected.has(String(bucket.value)) ? 'checked' : ''} />
          <span>${label(bucket.value)}</span>
          <span class="count">${bucket.count}</span>
        </label>
      `).join('') || '<span class="stats">No facet values</span>'}
      ${hasOverflow ? `<button type="button" class="btn btn-sm link-button" data-toggle-facet="${key}">${state.expandedFacets[key] ? 'Show fewer' : `Show ${orderedBuckets.length - visibleBuckets.length} more`}</button>` : ''}
    </fieldset>
  `;
}

export function renderFilters() {
  const savedIds = new Set(state.request.savedSearchIds || []);
  return `
    <aside class="panel">
      <div class="filter-heading"><h2 id="filter-panel-title">Filters</h2>
      <div class="filter-heading-actions"><button class="btn btn-sm btn-ghost" type="button" id="clear-filters" aria-label="Clear filters">Clear</button>
      <button class="btn btn-sm btn-primary close-filter-panel" id="close-filter-panel" type="button" aria-controls="search-filters">Show results</button></div></div>
      <div class="mobile-provider-controls">
        <div class="field"><label for="mobile-provider">Search provider</label><select class="select" id="mobile-provider">${state.providers.map((item) => `<option value="${item.id}" ${item.id === state.request.provider ? 'selected' : ''}>${escapeHtml(providerControlLabel(item))}</option>`).join('')}</select></div>
        <div class="field"><label for="mobile-mode">Search mode</label><select class="select" id="mobile-mode">${['keyword','semantic','hybrid'].map((mode) => `<option value="${mode}" ${state.request.mode === mode ? 'selected' : ''}>${label(mode)}</option>`).join('')}</select></div>
      </div>
      <hr />
      <fieldset class="fieldset facet-group" data-facet="saved-searches">
        <legend class="fieldset-legend facet-title">
          <strong>Saved Searches</strong>
          ${savedIds.size && state.response ? `<span class="stats">${state.response.totalHits} matches</span>` : ''}
        </legend>
        ${state.savedSearches.map((search) => `
          <label class="facet-option">
            <input class="checkbox checkbox-sm" type="checkbox" id="saved-filter-${escapeHtml(search.id)}" data-saved-search="${escapeHtml(search.id)}" ${savedIds.has(search.id) ? 'checked' : ''} />
            <span title="${escapeHtml(search.name)}">${escapeHtml(search.name)}</span>
            <span class="count" title="${escapeHtml(search.evaluationError || 'Current match count')}">${savedSearchCountLabel(search)}</span>
          </label>
        `).join('') || `<span class="stats">${state.savedSearchesLoading ? 'Evaluating saved searches…' : state.savedSearchesError ? 'Saved searches unavailable' : 'No saved searches yet'}</span>`}
        ${state.savedSearchesError ? `<p class="notice error">${escapeHtml(state.savedSearchesError)}</p><button class="btn btn-sm btn-outline" id="retry-saved">Retry saved searches</button>` : ''}
        ${savedIds.size > 1 ? '<span class="stats">Selected saved searches are ORed together.</span>' : ''}
      </fieldset>
      ${renderFacetGroup('City', 'city')}
      ${renderFacetGroup('Neighborhood', 'neighborhood')}
      ${renderFacetGroup('School district', 'schoolDistrict')}
      ${renderFacetGroup('Property type', 'propertyType')}
      ${renderFacetGroup('Bedrooms', 'bedrooms')}
      ${renderFacetGroup('Amenities', 'amenities')}
      ${renderFacetGroup('Listing status', 'listingStatus')}
      <fieldset class="fieldset range-section"><legend class="fieldset-legend">Ranges</legend>
      <div class="range-grid">
        <div class="field"><label for="range-minPrice">Min price</label><input id="range-minPrice" class="input input-sm" data-range="minPrice" type="number" value="${state.request.filters.minPrice || ''}" /></div>
        <div class="field"><label for="range-maxPrice">Max price</label><input id="range-maxPrice" class="input input-sm" data-range="maxPrice" type="number" value="${state.request.filters.maxPrice || ''}" /></div>
        <div class="field"><label for="range-minSquareFeet">Min sqft</label><input id="range-minSquareFeet" class="input input-sm" data-range="minSquareFeet" type="number" value="${state.request.filters.minSquareFeet || ''}" /></div>
        <div class="field"><label for="range-minLotSize">Min lot acres</label><input id="range-minLotSize" class="input input-sm" data-range="minLotSize" type="number" step="0.1" value="${state.request.filters.minLotSize || ''}" /></div>
        <div class="field"><label for="range-minYearBuilt">Min year</label><input id="range-minYearBuilt" class="input input-sm" data-range="minYearBuilt" type="number" value="${state.request.filters.minYearBuilt || ''}" /></div>
        <div class="field"><label for="range-maxYearBuilt">Max year</label><input id="range-maxYearBuilt" class="input input-sm" data-range="maxYearBuilt" type="number" value="${state.request.filters.maxYearBuilt || ''}" /></div>
      </div>
      </fieldset>
      <fieldset class="fieldset geo-section"><legend class="fieldset-legend">Location</legend>
      <div class="geo-grid">
        <button class="btn btn-sm btn-outline" type="button" data-geo="huntsville">5 mi Huntsville</button>
        <button class="btn btn-sm btn-outline" type="button" data-geo="madison">10 mi Madison</button>
        <button class="btn btn-sm btn-outline" type="button" data-geo="redstone">15 mi Redstone</button>
        <button class="btn btn-sm btn-outline" type="button" data-geo="">Clear geo</button>
      </div>
      <label class="facet-option" style="margin-top:10px">
        <input class="checkbox checkbox-sm" id="viewport" type="checkbox" ${state.request.viewport ? 'checked' : ''} />
        <span>Inside map viewport</span>
        <span></span>
      </label>
      </fieldset>
    </aside>
  `;
}
