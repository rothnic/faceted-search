import {
  Virtualizer,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect
} from '@tanstack/virtual-core';
import {
  api,
  escapeHtml,
  state
} from '../core.js';
import { renderResultCard } from './results.js';

let buildRequestBody = () => state.request;

function hasNextResultsPage() {
  return Boolean(state.response && state.response.hits.length < state.response.totalHits);
}

function loadedResultsStatus() {
  if (!state.response) return '';
  if (state.loadMoreError) return `Could not load more listings: ${state.loadMoreError}. Change the search or retry below.`;
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
        ${hit ? renderResultCard(hit) : `<div class="result loading-row">${escapeHtml(loadedResultsStatus())}${state.loadMoreError ? '<button type="button" data-retry-more>Retry more results</button>' : ''}</div>`}
      </div>
    `;
  }).join('');

  spacer.querySelector('[data-retry-more]')?.addEventListener('click', () => { state.loadMoreError = null; void loadMoreResults(); });
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

export function setupVirtualizedResults(requestBody) {
  buildRequestBody = requestBody;
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
  if (!state.resultVirtualizer || !hasNextResultsPage() || state.isLoadingMore || state.loadMoreError) return;
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
      body: JSON.stringify({ ...buildRequestBody(), page: nextPage, includeFacets: false })
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
  } catch (error) {
    if (requestId === state.searchRequestId) state.loadMoreError = error.message;
  } finally {
    if (requestId === state.searchRequestId) {
      state.isLoadingMore = false;
      updateVirtualizedResults();
    }
  }
}
