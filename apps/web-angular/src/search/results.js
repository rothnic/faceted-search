import {
  currency,
  escapeHtml,
  label,
  propertyTypeStyle,
  provider,
  savedSearchLabel,
  state,
  titleLabel
} from '../core.js';
import { renderResultMap } from './map.js';

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
    <button type="button" class="btn btn-ghost refinement-pill" aria-label="Remove ${escapeHtml(part.label)}" data-remove-refinement="${part.action}" ${part.key ? `data-key="${part.key}"` : ''} ${part.value !== undefined ? `data-value="${escapeHtml(part.value)}"` : ''}>
      <span class="badge badge-soft badge-primary"><span>${escapeHtml(part.label)}</span><span aria-hidden="true">×</span></span>
    </button>
  `).join('') || '<span class="stats">No refinements selected</span>'}</div>`;
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
  if (state.searchError) return `<section class="panel"><h2>Search unavailable</h2><p class="notice error" role="alert">${escapeHtml(state.searchError)}</p><p>Your criteria are preserved. You can retry or try keyword search.</p><div class="action-row"><button class="btn btn-sm btn-outline" id="retry-search">Retry search</button><button class="btn btn-sm btn-outline" id="keyword-recovery">Use keyword search</button></div></section>`;
  if (!response) return '<section class="panel" aria-busy="true"><h2>Results</h2><p role="status">Searching… Semantic searches may need to download and initialize the local CPU model on first use.</p><div class="loading-skeleton" aria-hidden="true"></div><div class="loading-skeleton" aria-hidden="true"></div></section>';
  return `
    <section class="results-panel">
      <div class="results-head">
        <h2>Homes <span class="result-total">${response.totalHits}</span></h2>
        ${renderRefinements()}
        <div class="result-tools">${response.mapHits?.length ? `<button class="btn btn-sm btn-ghost mobile-view-toggle" id="mobile-view-toggle" aria-controls="results-workspace" aria-pressed="${state.mobileResultsView === 'map'}" aria-label="${state.mobileResultsView === 'map' ? 'Show list' : 'Show map'}">${state.mobileResultsView === 'map' ? 'List' : 'Map'}</button>` : ''}<button type="button" class="btn btn-sm btn-primary primary" id="save-search">Save search</button>
        </div>
      </div>
      ${response.provenance ? '<p class="notice" data-backend-provenance>Selected: ' + escapeHtml(response.provenance.selectedProvider) + ' · Responded: ' + escapeHtml(response.provenance.respondingProvider) + ' · ' + escapeHtml(response.provenance.execution) + '<br>Dataset: ' + escapeHtml(response.provenance.dataset.id) + ' · PostgreSQL source rows: ' + response.provenance.dataset.count + ' · Database: ' + escapeHtml(response.provenance.dataset.databaseFingerprint) + ' · Revision: ' + escapeHtml(response.provenance.dataset.revision) + '<br>API: ' + response.provenance.timing.apiMs + ' ms · search operation: ' + response.provenance.timing.searchMs + ' ms</p>' : '<span class="stats">Backend unverified</span>'}
      ${(response.debug?.warnings || []).map((warning) => `<p class="notice execution-warning">${escapeHtml(warning)}</p>`).join('')}
      <div class="results-workspace" id="results-workspace" data-mobile-view="${response.mapHits?.length ? state.mobileResultsView : 'list'}"><div class="listing-column">
      ${response.hits.length ? `
        <div id="result-list-scroll" class="result-list-scroll" data-loaded-count="${response.hits.length}" data-total-count="${response.totalHits}">
          <div id="result-list-spacer" class="result-list-spacer"></div>
        </div>
      ` : '<div class="empty-state"><h3>No listings match this search</h3><p>Try fewer filters or a broader query. You can still save it.</p><button class="btn btn-sm btn-outline" id="empty-clear">Clear search and filters</button></div>'}
      </div><div class="map-column">${renderResultMap()}</div></div>
    </section>
  `;
}

export function renderDebug(requestBody) {
  const currentProvider = provider();
  return `
    <details class="panel debug" id="search-diagnostics"><summary id="diagnostics-toggle"><span>Search diagnostics</span><span>Requests, execution & sync</span></summary><div class="diagnostics-content"><h2>Provider Debug</h2>
      <p class="stats">${currentProvider?.capabilities?.requiresExternalSync ? 'External index strategy with recorded outbox sync.' : 'Application search over PostgreSQL-backed data.'}</p>
      <pre>${escapeHtml(JSON.stringify({ request: requestBody(), debug: state.response?.debug }, null, 2))}</pre>
      <h3>Recorded Sync Status</h3>
      <p class="stats">Recorded counters; current engine health is not probed. <a id="debug-system-link" href="/system">Inspect system</a></p>
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
