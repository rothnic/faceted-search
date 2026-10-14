import {
  RESULT_PAGE_SIZE,
  api,
  app,
  escapeHtml,
  filterValue,
  label,
  state,
  setHtmlPreservingFocus,
  syncUrl
} from './core.js';
import { renderFilters, renderToolbar } from './search/filters.js';
import { handleFilterDrawerKey, setFilterDrawer, syncFilterDrawer } from './search/filter-drawer.js';
import { closeHitDetails, openHitDetails, syncHitDialog } from './search/hit-dialog.js';
import { renderLeafletMap, resizeVisibleMap } from './search/map.js';
import { renderDebug, renderResults } from './search/results.js';
import { refreshStatus, updateSystemStrip } from './system-status.js';
import { setupVirtualizedResults } from './search/virtual-results.js';

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
  return '<p class="suggestion-source">Catalog, saved searches and current listings</p>' + suggestions.map((item) => `
    <button type="button" class="btn btn-sm suggestion-option" data-search-suggestion="${escapeHtml(item.query)}">
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

function requestBody() {
  const filters = Object.fromEntries(
    Object.entries(state.request.filters || {}).filter(([, value]) => !(Array.isArray(value) && value.length === 0) && value !== undefined && value !== '')
  );
  return { ...state.request, filters };
}

let searchTimer;
let mapResizeBound = false;
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 180);
}

export async function runSearch() {
  clearTimeout(searchTimer);
  const requestId = ++state.searchRequestId;
  state.isLoadingMore = false;
  state.mobileListScrollTop = 0;
  state.loadMoreError = null;
  state.selectedHitId = null;
  state.isSearching = true;
  state.searchError = null;
  // Hide stale results rather than showing them as matches for the new criteria.
  state.response = null;
  syncUrl();
  renderSearchPage();
  void refreshStatus();
  try {
    const response = await api('/api/search', { method: 'POST', body: JSON.stringify(requestBody()) });
    if (requestId !== state.searchRequestId) return;
    state.response = response;
  } catch (error) {
    if (requestId !== state.searchRequestId) return;
    state.searchError = error.message;
  } finally {
    if (requestId === state.searchRequestId) {
      state.isSearching = false;
      renderSearchPage();
      void refreshStatus();
    }
  }
}

export async function loadBootstrap() {
  const bootstrap = await api('/api/providers');
  state.providers = bootstrap.providers;
  state.catalog = bootstrap.fixtureCatalog;
  state.geoPresets = bootstrap.geoPresets;
  state.storageMode = bootstrap.storageMode;
}

export async function loadSavedSearches() {
  state.savedSearchesLoading = true;
  state.savedSearchesError = null;
  try {
    const data = await api('/api/saved-searches');
    state.savedSearches = data.savedSearches;
  } catch (error) { state.savedSearchesError = error.message; }
  finally {
    state.savedSearchesLoading = false;
    // Do not rebuild the results/map or interrupt an in-flight search.
    const savedGroup = document.querySelector('[data-facet="saved-searches"]');
    if (savedGroup) {
      const template = document.createElement('template');
      template.innerHTML = renderFilters();
      setHtmlPreservingFocus(savedGroup, template.content.querySelector('[data-facet="saved-searches"]').innerHTML);
      savedGroup.querySelectorAll('[data-saved-search]').forEach((input) => input.addEventListener('change', () => setSavedSearch(input.dataset.savedSearch, input.checked)));
    }
  }
}

function updateToolbarControls() {
  const activeCount = Object.values(state.request.filters).reduce((count,value) => count + (Array.isArray(value) ? value.length : value !== undefined && value !== '' ? 1 : 0), 0) + (state.request.savedSearchIds?.length || 0) + Number(Boolean(state.request.geo)) + Number(Boolean(state.request.viewport));
  const countBadge = document.querySelector('#active-filter-count');
  if (countBadge) { countBadge.textContent = String(activeCount); countBadge.hidden = !activeCount; countBadge.setAttribute('aria-label', `${activeCount} active filters`); }

  const searchBoxInput = document.querySelector('#search-box');
  if (searchBoxInput && searchBoxInput.value !== (state.request.q || '')) searchBoxInput.value = state.request.q || '';
  const providerSelect = document.querySelector('#provider');
  if (providerSelect) providerSelect.value = state.request.provider;
  const sortSelect = document.querySelector('#sort');
  if (sortSelect) sortSelect.value = state.request.sort;
  const modeSelect = document.querySelector('#search-mode');
  if (modeSelect) modeSelect.value = state.request.mode;
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
  document.querySelector('#search-mode')?.addEventListener('change', (event) => {
    state.request.mode = event.target.value;
    state.request.page = 1;
    runSearch();
  });
}

function wireSearchContent() {
  document.querySelector('#mobile-provider')?.addEventListener('change', (event) => { state.request.provider = event.target.value; state.request.page = 1; runSearch(); });
  document.querySelector('#mobile-mode')?.addEventListener('change', (event) => { state.request.mode = event.target.value; state.request.page = 1; runSearch(); });

  document.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('change', () => setFilter(input.dataset.filter, input.value, input.checked)));
  document.querySelectorAll('[data-saved-search]').forEach((input) => input.addEventListener('change', () => setSavedSearch(input.dataset.savedSearch, input.checked)));
  document.querySelectorAll('[data-range]').forEach((input) => input.addEventListener('change', () => setRange(input.dataset.range, input.value)));
  document.querySelector('#viewport')?.addEventListener('change', (event) => toggleViewport(event.target.checked));
}

function wireSearchDelegates() {
  if (searchDelegatesWired) return;
  searchDelegatesWired = true;
  window.addEventListener('system-status-updated', () => {
    const debug = document.querySelector('#search-debug');
    if (debug) setHtmlPreservingFocus(debug, renderDebug(requestBody));
  });
  app.addEventListener('click', async (event) => {
    try {
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
      if (target.id === 'clear-filters' || target.id === 'empty-clear') return clearFilters();
      if (target.id === 'retry-search') return runSearch();
      if (target.id === 'retry-saved') return loadSavedSearches();
      if (target.id === 'keyword-recovery') { state.request.mode = 'keyword'; return runSearch(); }
      if (target.id === 'close-filter-panel') {
        setFilterDrawer(false);
        return;
      }
      if (target.id === 'mobile-view-toggle') {
        const list = document.querySelector('#result-list-scroll');
        const showMap = state.mobileResultsView !== 'map';
        if (showMap && list) state.mobileListScrollTop = list.scrollTop;
        state.mobileResultsView = showMap ? 'map' : 'list';
        document.querySelector('#results-workspace').dataset.mobileView = state.mobileResultsView;
        target.textContent = showMap ? 'List' : 'Map';
        target.setAttribute('aria-label', showMap ? 'Show list' : 'Show map');
        target.setAttribute('aria-pressed', String(showMap));
        requestAnimationFrame(() => {
          resizeVisibleMap();
          if (!showMap && list) list.scrollTop = state.mobileListScrollTop;
        });
        return;
      }
      if (target.id === 'toggle-filters') {
        const visible = target.getAttribute('aria-expanded') !== 'true';
        setFilterDrawer(visible);
        return;
      }
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
      if (target.dataset.backfill || target.id === 'run-worker') {
        if (state.operation) return;
        state.operation = target.dataset.backfill ? `Backfill ${target.dataset.backfill}` : 'Sync worker';
        state.operationError = null;
        renderSearchPage();
        try {
          await api(target.dataset.backfill ? '/api/sync/backfill' : '/api/sync/worker/run', {
            method: 'POST', body: JSON.stringify(target.dataset.backfill ? { provider: target.dataset.backfill } : {})
          });
        } catch (error) { state.operationError = error.message; }
        finally { state.operation = null; await refreshStatus(); renderSearchPage(); }
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
    } catch (error) { state.operationError = error.message; renderSearchPage(); }
  });
  app.addEventListener('keydown', (event) => {
    if (handleFilterDrawerKey(event)) return;
    if (event.key === 'Escape') {
      updateSearchSuggestions(false);
      const disclosure = event.target.closest?.('.system-info[open], .result-info[open]');
      if (disclosure) { disclosure.open = false; disclosure.querySelector('summary')?.focus(); }
      return closeHitDetails();
    }
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
      <div id="filter-drawer" class="layout search-drawer drawer">
        <input id="filter-drawer-toggle" class="drawer-toggle" type="checkbox" tabindex="-1" aria-hidden="true" />
        <div id="search-results" class="drawer-content"></div>
        <div id="search-filters" class="drawer-side">
          <label class="drawer-overlay" for="filter-drawer-toggle" aria-label="Close filters"></label>
          <div id="filter-panel-content"></div>
        </div>
      </div>
      <div id="search-debug"></div>
    `;
    document.querySelector('#filter-drawer-toggle').addEventListener('change', () => setFilterDrawer(document.querySelector('#filter-drawer-toggle').checked));
    wireSearchToolbar();
    wireSearchDelegates();
    if (!mapResizeBound) {
      window.matchMedia('(max-width:760px)').addEventListener('change', () => { setFilterDrawer(false, false); requestAnimationFrame(resizeVisibleMap); });
      mapResizeBound = true;
    }
  }
  updateToolbarControls();
  updateSystemStrip();
  const filterScroll = document.querySelector('#filter-panel-content .panel')?.scrollTop || 0;
  setHtmlPreservingFocus(document.querySelector('#filter-panel-content'), renderFilters());
  document.querySelector('#filter-panel-content .panel').scrollTop = filterScroll;
  syncFilterDrawer();
  document.querySelector('#search-results').innerHTML = renderResults();
  setHtmlPreservingFocus(document.querySelector('#search-debug'), renderDebug(requestBody));
  syncHitDialog();
  wireSearchContent();
  updateSearchSuggestions();
  renderLeafletMap();
  setupVirtualizedResults(requestBody);
}
