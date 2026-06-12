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

export function renderDebug(requestBody) {
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
