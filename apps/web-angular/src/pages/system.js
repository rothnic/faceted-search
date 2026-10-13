import { api, app, escapeHtml as e, label, setHtmlPreservingFocus, state } from '../core.js';
import { embeddingLabel, modelProgress, refreshStatus, startStatusPolling, storageLabel } from '../system-status.js';

function renderSnapshot() {
  const model = state.embeddings;
  const sync = state.sync;
  const content = document.querySelector('#system-snapshot');
  if (!content) return;
  const rawOpen = content.querySelector('details')?.open;
  setHtmlPreservingFocus(content, `
    <p class="stats">Last attempted ${state.statusCheckedAt ? e(new Date(state.statusCheckedAt).toLocaleTimeString()) : 'not yet'} · refreshes while this page is visible</p>
    <div class="status-grid">
      <article class="panel"><span class="eyebrow">Data source</span><h2>${storageLabel()}</h2>
        <p>${state.storageMode === 'memory' ? 'Fixture listings and simulated index sync. Changes reset when the server restarts or the demo is seeded.' : state.storageMode === 'postgres' ? 'The API reports PostgreSQL-backed data and persisted sync state.' : 'Could not establish the current storage mode.'}</p>
        <a id="system-schema-link" href="/schema">Browse the declared schema →</a>
      </article>
      <article class="panel"><span class="eyebrow">Semantic runtime</span><h2>${e(embeddingLabel(model))}</h2>
        ${model ? `<p>${e(model.model)} · ${e(model.dimensions)} dimensions · ${e(model.dtype)} · ${e(model.device)}</p>${modelProgress(model)}
          <dl class="status-facts"><dt>Active batches</dt><dd>${e(model.activeBatches ?? 'Unknown')}</dd><dt>Cached texts</dt><dd>${e(model.cachedTexts ?? 'Unknown')}</dd><dt>Computed texts</dt><dd>${e(model.computedTexts ?? 'Unknown')}</dd></dl>
          ${model.error ? `<p class="notice error" role="alert">${e(model.error)}</p>` : ''}` : `<p class="notice">Status unavailable: ${e(state.embeddingError || 'Waiting for API')}</p>`}
        <p class="stats">Ready means the model is loaded. Cache totals are not a backfill completion percentage. Relevance scores are not calibrated confidence probabilities.</p>
      </article>
    </div>
    <section class="panel status-section"><div class="section-heading"><div><span class="eyebrow">Recorded synchronization</span><h2>External indexes</h2></div><span class="status-badge">${sync ? `${e(sync.outboxPendingCount)} pending events` : 'Status unavailable'}</span></div>
      <p>${state.storageMode === 'memory' ? 'Demo simulation: these counters do not indicate documents in a real search engine.' : 'Recorded application counters, not a live engine health probe. Completion records do not verify current index freshness.'}</p>
      <p class="stats">No continuous worker or durable running-job telemetry is exposed. Buttons run one request; progress is unknown until it returns.</p>
      ${sync ? `<div class="status-grid">${Object.entries(sync.providers || {}).map(([name, provider]) => `<article class="status-card"><h3>${e(label(name))}</h3>
        <span class="status-badge">Backfill: ${e(label(provider.backfillStatus))}</span>
        <dl class="status-facts"><dt>Recorded indexed</dt><dd>${e(provider.documentsIndexed)}</dd><dt>Recorded deleted</dt><dd>${e(provider.documentsDeleted)}</dd><dt>Last sync</dt><dd>${provider.lastSyncTime ? e(new Date(provider.lastSyncTime).toLocaleString()) : 'Never recorded'}</dd></dl>
        ${provider.lastSyncError ? `<p class="notice error">${e(provider.lastSyncError)}</p>` : '<p class="stats">No recorded sync error</p>'}
        <button id="system-backfill-${e(name)}" data-system-action="backfill" data-provider="${e(name)}" ${state.operation ? 'disabled' : ''}>${state.storageMode === 'memory' ? 'Simulate' : 'Run'} ${e(label(name))} backfill</button>
      </article>`).join('')}</div>` : `<p class="notice error" role="alert">${e(state.syncError || 'Waiting for sync status')}</p>`}
      <div class="action-row"><button id="system-worker" data-system-action="worker" ${state.operation || !sync ? 'disabled' : ''}>${state.storageMode === 'memory' ? 'Simulate worker once' : 'Run worker once'}</button></div>
      <details ${rawOpen ? 'open' : ''}><summary id="system-raw-summary">Raw observed sync response</summary><pre>${e(JSON.stringify(sync, null, 2))}</pre></details>
    </section>`);
  document.querySelector('#operation-feedback').innerHTML = state.operation
    ? `<p class="notice" role="status">${e(state.operation)} is running in this browser request. No completion percentage is available.</p>`
    : state.operationError ? `<p class="notice error" role="alert">${e(state.operationError)}. Refresh status before retrying.</p>`
    : state.operationResult ? `<p class="notice" role="status">${e(state.operationResult)}</p>` : '';
}

export async function renderSystem() {
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">Inspect the system</span><h1>System status</h1><p>What the API actually reports, with the limits made explicit.</p></div><button id="refresh-system">Refresh status</button></section><div id="operation-feedback"></div><div id="system-snapshot"><p role="status">Loading system status…</p></div>`;
  document.querySelector('#refresh-system').addEventListener('click', async (event) => {
    event.target.disabled = true;
    await refreshStatus(); renderSnapshot(); event.target.disabled = false;
  });
  app.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-system-action]');
    if (!button || state.operation) return;
    const backfill = button.dataset.systemAction === 'backfill';
    state.operation = backfill ? `${label(button.dataset.provider)} backfill` : 'Sync worker';
    state.operationError = null; state.operationResult = null; renderSnapshot();
    try {
      await api(backfill ? '/api/sync/backfill' : '/api/sync/worker/run', { method: 'POST', body: JSON.stringify(backfill ? { provider: button.dataset.provider } : {}) });
      state.operationResult = `${state.operation} request completed${state.storageMode === 'memory' ? ' (demo simulation)' : ''}.`;
    } catch (error) { state.operationError = error.message; }
    finally { state.operation = null; await refreshStatus(); renderSnapshot(); }
  });
  startStatusPolling(renderSnapshot);
}
