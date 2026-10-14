import {
  currency,
  escapeHtml,
  label,
  propertyTypeStyle,
  provider,
  state,
  titleLabel
} from '../core.js';
import { renderResultsToolbar } from './controls.js';
import { activeFilters } from './active-filters.js';
import { renderResultMap } from './map-markup.js';

function renderRefinements() {
  const parts = activeFilters(state.request).map((part) => ({ ...part, label: part.action === 'geo' ? `radius: ${part.value} miles` : part.action === 'viewport' ? 'inside map viewport' : `${part.key}: ${label(String(part.value))}` }));
  if (!parts.length) return '';
  return `<div class="refinements" aria-label="Applied filters">${parts.map((part) => `
    <button type="button" class="btn btn-ghost refinement-pill" aria-label="Remove ${escapeHtml(part.label)}" data-remove-refinement="${part.action}" ${part.key ? `data-key="${part.key}"` : ''} ${part.value !== undefined ? `data-value="${escapeHtml(part.value)}"` : ''}>
      <span class="badge badge-soft badge-primary"><span>${escapeHtml(part.label)}</span><span aria-hidden="true">×</span></span>
    </button>
  `).join('')}<button type="button" class="btn btn-sm btn-ghost clear-all-filters" id="clear-all-filters">Clear all</button></div>`;
}

export function renderResultCard(hit) {
  return `
    <article class="result card" data-house-id="${hit.id}" data-open-hit="${hit.id}" tabindex="0">
      <div class="result-topline"><strong class="result-price">${currency(hit.price)}</strong><span class="badge badge-soft ${hit.listingStatus === 'active' ? 'badge-success' : 'badge-neutral'} badge-sm">${titleLabel(hit.listingStatus)}</span></div>
      <h3>${escapeHtml(hit.title)}</h3>
      <p class="result-location">${escapeHtml(hit.city)}${hit.neighborhood ? ` · ${escapeHtml(hit.neighborhood)}` : ''}</p>
      <div class="meta property-facts"><span>${hit.bedrooms} bd</span><span>${hit.bathrooms} ba</span><span>${hit.squareFeet.toLocaleString()} sqft</span>${hit.distanceMiles !== undefined ? `<span>${hit.distanceMiles.toFixed(1)} mi away</span>` : ''}</div>
      <p class="result-description">${escapeHtml(hit.description)}</p>
      <div class="result-actions"><div class="amenities">${hit.amenities.map((item) => `<button type="button" class="btn btn-ghost btn-sm hit-chip" aria-label="Filter by ${escapeHtml(label(item))}" data-hit-filter="amenities" data-value="${escapeHtml(item)}"><span class="badge badge-ghost badge-sm">${label(item)}</span></button>`).join('')}</div><button type="button" class="btn btn-sm btn-ghost button-link" data-open-hit="${hit.id}">Details ↗</button></div>
    </article>
  `;
}

export function renderResults() {
  const response = state.response;
  const toolbar = renderResultsToolbar({ request: state.request, response, view: state.mobileResultsView, desktopView: state.desktopResultsView, facetCount: activeFilters(state.request).length, chips: renderRefinements() });
  if (state.searchError) return `<section class="results-panel">${toolbar}<section class="panel"><h2>Search unavailable</h2><p class="notice error" role="alert">${escapeHtml(state.searchError)}</p><p>Your criteria are preserved. You can retry or try keyword search.</p><div class="action-row"><button class="btn btn-sm btn-outline" id="retry-search">Retry search</button><button class="btn btn-sm btn-outline" id="keyword-recovery">Use keyword search</button></div></section></section>`;
  if (!response) return `<section class="results-panel">${toolbar}<div class="results-workspace" id="results-workspace" data-mobile-view="list" data-desktop-view="${state.desktopResultsView}"><div class="listing-column"><div class="result-list-scroll loading-list" aria-busy="true"><div class="loading-skeleton" aria-hidden="true"></div><div class="loading-skeleton" aria-hidden="true"></div></div></div><div class="map-column"><section class="result-map" aria-label="Map of visible results"><div class="leaflet-result-map map-placeholder" role="status">Map appears with matching listings</div><p class="map-feedback">Map loads with matching listings</p></section></div></div><p class="visually-hidden" role="status">Searching… Semantic searches may need to download and initialize the local CPU model on first use.</p></section>`;
  return `
    <section class="results-panel${state.isSearching ? ' is-updating' : ''}" ${state.isSearching ? 'aria-busy="true"' : ''}>
      ${toolbar}
      ${state.isSearching ? '<p class="results-updating" role="status">Updating results…</p>' : ''}
      ${(response.debug?.warnings || []).map((warning) => `<p class="notice execution-warning">${escapeHtml(warning)}</p>`).join('')}
      <div class="results-workspace" id="results-workspace" data-mobile-view="${state.mobileResultsView}" data-desktop-view="${state.desktopResultsView}"><div class="listing-column">
      ${response.hits.length ? `
        <div id="result-list-scroll" class="result-list-scroll" data-loaded-count="${response.hits.length}" data-total-count="${response.totalHits}">
          <div id="result-list-spacer" class="result-list-spacer"></div>
        </div>
      ` : '<div class="empty-state"><h3>No listings match this search</h3><p>Try fewer filters or a broader query. You can still save it.</p><button class="btn btn-sm btn-outline" id="empty-clear">Clear filters</button></div>'}
      </div><div class="map-column">${renderResultMap()}</div></div>
    </section>
  `;
}

export function renderDebug(requestBody) {
  const currentProvider = provider();
  return `
    <details class="panel debug" id="search-diagnostics"><summary id="diagnostics-toggle"><span>Search diagnostics</span><span>Requests, execution & sync</span></summary><div class="diagnostics-content"><h2>Provider Debug</h2>
      <p class="stats">${state.storageMode === 'memory' ? 'In-memory demo. Provider names describe strategies, not connected databases.' : currentProvider?.capabilities?.requiresExternalSync ? 'External index strategy with recorded outbox sync.' : 'Application search over PostgreSQL-backed data.'}</p>
      <pre>${escapeHtml(JSON.stringify({ request: requestBody(), debug: state.response?.debug }, null, 2))}</pre>
      <h3>Recorded Sync Status</h3>
      <p class="stats">${state.storageMode === 'memory' ? 'Simulated counters; no real index writes.' : 'Recorded counters; current engine health is not probed.'} <a id="debug-system-link" href="/system">Inspect system</a></p>
      ${state.operation ? `<p role="status" class="notice">${escapeHtml(state.operation)} request running…</p>` : ''}
      ${state.operationError ? `<p role="alert" class="notice error">${escapeHtml(state.operationError)}</p>` : ''}
      ${state.syncError ? `<p class="notice error">Sync status unavailable: ${escapeHtml(state.syncError)}</p>` : ''}
      <pre>${escapeHtml(JSON.stringify(state.sync, null, 2))}</pre>
      <div class="action-row">
        <button class="btn btn-sm btn-outline" ${state.operation ? 'disabled' : ''} id="debug-backfill-meili" data-backfill="meilisearch">Backfill Meili</button>
        <button class="btn btn-sm btn-outline" ${state.operation ? 'disabled' : ''} id="debug-backfill-typesense" data-backfill="typesense">Backfill Typesense</button>
        <button class="btn btn-sm btn-outline" ${state.operation ? 'disabled' : ''} id="run-worker">Run worker</button>
        <button class="btn btn-sm btn-outline" id="mark-sold">Mark first result sold</button>
      </div>
    </div></details>
  `;
}
