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
    <button type="button" class="pill refinement-pill" data-remove-refinement="${part.action}" ${part.key ? `data-key="${part.key}"` : ''} ${part.value !== undefined ? `data-value="${escapeHtml(part.value)}"` : ''}>
      <span>${escapeHtml(part.label)}</span>
      <span aria-hidden="true">x</span>
    </button>
  `).join('') || '<span class="stats">No refinements selected</span>'}</div>`;
}

export function renderResultCard(hit) {
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

export function renderResults() {
  const response = state.response;
  if (state.searchError) return `<section class="panel"><h2>Search unavailable</h2><p class="notice error" role="alert">${escapeHtml(state.searchError)}</p><p>Your criteria are preserved. You can retry or try keyword search.</p><div class="action-row"><button id="retry-search">Retry search</button><button id="keyword-recovery">Use keyword search</button></div></section>`;
  if (!response) return '<section class="panel" aria-busy="true"><h2>Results</h2><p role="status">Searching… Semantic searches may need to download and initialize the local CPU model on first use.</p><div class="loading-skeleton" aria-hidden="true"></div><div class="loading-skeleton" aria-hidden="true"></div></section>';
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
      <p class="confidence-note">${state.request.mode === 'keyword' ? 'Keyword relevance' : state.request.mode === 'semantic' ? 'Semantic similarity' : 'Hybrid relevance'} ranking. Scores are ordering signals, not confidence percentages.</p>
      ${(response.debug?.warnings || []).map((warning) => `<p class="notice">${escapeHtml(warning)}</p>`).join('')}
      ${renderResultMap()}
      ${response.hits.length ? `
        <div class="virtual-summary stats" data-virtual-summary>Showing ${response.hits.length} of ${response.totalHits} loaded listings</div>
        <div id="result-list-scroll" class="result-list-scroll" data-loaded-count="${response.hits.length}" data-total-count="${response.totalHits}">
          <div id="result-list-spacer" class="result-list-spacer"></div>
        </div>
      ` : '<div class="empty-state"><h3>No listings match this search</h3><p>Try fewer filters or a broader query. You can still save it.</p><button id="empty-clear">Clear search and filters</button></div>'}
    </section>
  `;
}

export function renderDebug(requestBody) {
  const currentProvider = provider();
  return `
    <aside class="panel debug">
      <h2>Provider Debug</h2>
      <p class="stats">${state.storageMode === 'memory' ? 'In-memory demo. Provider names describe strategies, not connected databases.' : currentProvider?.capabilities?.requiresExternalSync ? 'External index strategy with recorded outbox sync.' : 'Application search over PostgreSQL-backed data.'}</p>
      <pre>${escapeHtml(JSON.stringify({ request: requestBody(), debug: state.response?.debug }, null, 2))}</pre>
      <h3>Recorded Sync Status</h3>
      <p class="stats">${state.storageMode === 'memory' ? 'Simulated counters; no real index writes.' : 'Recorded counters; current engine health is not probed.'} <a id="debug-system-link" href="/system">Inspect system</a></p>
      ${state.operation ? `<p role="status" class="notice">${escapeHtml(state.operation)} request running…</p>` : ''}
      ${state.operationError ? `<p role="alert" class="notice error">${escapeHtml(state.operationError)}</p>` : ''}
      ${state.syncError ? `<p class="notice error">Sync status unavailable: ${escapeHtml(state.syncError)}</p>` : ''}
      <pre>${escapeHtml(JSON.stringify(state.sync, null, 2))}</pre>
      <div class="action-row">
        <button ${state.operation ? 'disabled' : ''} id="debug-backfill-meili" data-backfill="meilisearch">Backfill Meili</button>
        <button ${state.operation ? 'disabled' : ''} id="debug-backfill-typesense" data-backfill="typesense">Backfill Typesense</button>
        <button ${state.operation ? 'disabled' : ''} id="run-worker">Run worker</button>
        <button id="mark-sold">Mark first result sold</button>
      </div>
    </aside>
  `;
}
