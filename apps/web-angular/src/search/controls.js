// Shared presentation helpers: one request state and one Sort control across layouts.
export const SORT_LABELS = { relevance: 'Relevance', distance: 'Nearest', price_asc: 'Price ↑', price_desc: 'Price ↓', newest: 'Newest' };
const PROVIDER_LABELS = { postgres_native: 'PostgreSQL', pg_search: 'pg_search', meilisearch: 'Meilisearch', typesense: 'Typesense' };

export function renderSearchSettings(request, providers, escape, mobile = false) {
  providers = providers.length ? providers : Object.entries(PROVIDER_LABELS).map(([id,label]) => ({id,label}));
  const modeId = mobile ? 'mobile-mode' : 'search-mode';
  const providerId = mobile ? 'mobile-provider' : 'provider';
  return `<div class="field mode-field"><label for="${modeId}">${mobile ? 'Search mode' : 'Mode'}</label><select class="select select-sm" id="${modeId}">${['keyword','semantic','hybrid'].map(mode => `<option value="${mode}" ${request.mode === mode ? 'selected' : ''}>${mode[0].toUpperCase()+mode.slice(1)}</option>`).join('')}</select></div>
    <div class="field provider-field"><label for="${providerId}">${mobile ? 'Search provider' : 'Provider'}</label><select class="select select-sm" id="${providerId}">${providers.map(item => `<option value="${escape(item.id)}" ${request.provider === item.id ? 'selected' : ''}>${escape(PROVIDER_LABELS[item.id] || item.label)}</option>`).join('')}</select></div>`;
}

export function renderSortControl(sort) {
  const selected = SORT_LABELS[sort] || SORT_LABELS.relevance;
  return `<div class="field sort-field"><label class="control-accessible-label" for="sort">Sort results</label><select class="select select-sm" id="sort" aria-label="Sort results" style="--sort-label-ch:${selected.length}">${Object.entries(SORT_LABELS).map(([value,text]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>`;
}

export function renderFilterToggle(count) {
  return `<button id="toggle-filters" type="button" class="btn btn-sm btn-outline mobile-filter-toggle" aria-label="Show or hide filters" aria-controls="search-filters" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M5 10h10M8 15h4"/></svg>Filters <span id="active-filter-count" class="filter-count" ${count ? '' : 'hidden'} aria-label="${count} active filters">${count}</span></button>`;
}

export function renderResultsToolbar({ request, response, view, desktopView, facetCount, chips }) {
  const showMap = view === 'map';
  const desktopViews = [['split','Split'],['map','Map'],['list','List']].map(([value,text]) => '<button type="button" class="btn btn-sm btn-ghost'+(desktopView === value ? ' is-active' : '')+'" data-desktop-view="'+value+'" aria-pressed="'+(desktopView === value)+'">'+text+'</button>').join('');
  const desktopViewControls = '<div class="desktop-view-controls" role="group" aria-label="Result view">'+desktopViews+'</div>';
  return `<div class="results-head">
    <h2>Homes <span class="result-count-group"><span class="result-total" aria-label="Matching homes">${response ? response.totalHits : '…'}</span><span class="total-inventory" aria-label="Total searchable inventory">${response ? 'of ' + response.totalInventory : 'of …'}</span></span></h2>
    ${chips}
    <div class="result-tools">
      ${renderFilterToggle(facetCount)}
      ${renderSortControl(request.sort)}
      ${desktopViewControls}
      <button type="button" class="btn btn-sm btn-ghost mobile-view-toggle" id="mobile-view-toggle" aria-controls="results-workspace" aria-pressed="${showMap}" aria-label="${showMap ? 'Show list' : 'Show map'}">${showMap ? 'List' : 'Map'}</button>
      <button type="button" class="btn btn-sm btn-primary primary" id="save-search" ${response ? '' : 'disabled'}>Save search</button>
    </div>
  </div>`;
}

export function renderSearchBar(request, escape) {
  return `      <div class="field search-field">
        <label class="search-accessible-label" for="search-box">Search</label>
        <div class="search-input-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input class="input input-lg" id="search-box" value="${escape(request.q || '')}" placeholder="Search homes, neighborhoods, or features…" autocomplete="off" /><button type="button" class="btn btn-ghost" id="clear-query" aria-label="Clear query" ${request.q ? '' : 'hidden'}><span aria-hidden="true">×</span></button></div>
        <div id="search-suggestions" class="suggestions" hidden></div>
      </div>
`;
}
