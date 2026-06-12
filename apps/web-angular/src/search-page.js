import {
  RESULT_PAGE_SIZE,
  api,
  app,
  escapeHtml,
  filterValue,
  label,
  state,
  syncUrl
} from './core.js';
import { renderFilters, renderToolbar } from './search/filters.js';
import { closeHitDetails, openHitDetails, syncHitDialog } from './search/hit-dialog.js';
import { renderLeafletMap } from './search/map.js';
import { renderDebug, renderResults } from './search/results.js';
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
  document.querySelector('#search-debug').innerHTML = renderDebug(requestBody);
  syncHitDialog();
  wireSearchContent();
  updateSearchSuggestions();
  renderLeafletMap();
  setupVirtualizedResults(requestBody);
}
