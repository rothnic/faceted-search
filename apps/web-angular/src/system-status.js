import { api, escapeHtml as e, setHtmlPreservingFocus, state } from './core.js';

export function storageLabel(mode = state.storageMode) {
  return mode === 'memory' ? 'In-memory demo' : mode === 'postgres' ? 'PostgreSQL storage' : 'Storage unknown';
}

export function embeddingLabel(model = state.embeddings) {
  if (!model) return 'CPU model status unavailable';
  if (model.activeBatches > 0) return 'Computing embeddings';
  return { idle: 'CPU model not loaded', loading: 'Loading CPU model', ready: 'CPU model ready', error: 'CPU model unavailable' }[model.state] || 'CPU model status unknown';
}

export function modelProgress(model) {
  if (!model || model.state !== 'loading') return '';
  const progress = model.progress;
  const measured = Number.isFinite(progress?.loaded) && progress?.total > 0;
  return `<div class="model-progress"><progress aria-label="Model file download" ${measured ? `max="${progress.total}" value="${Math.min(progress.loaded, progress.total)}"` : ''}></progress>
    <span>${e(progress?.file || 'Preparing local inference runtime')}${measured ? ` · ${Math.round(progress.loaded / progress.total * 100)}% of this file` : ' · total progress unknown'}</span></div>`;
}

export function renderSystemStrip() {
  return `<div class="system-strip" aria-label="System summary">
    <a id="summary-system-link" href="/system" class="status-badge">${storageLabel()}</a>
    <span>${e(embeddingLabel())}</span>
    <span>${state.syncError ? 'Sync status unavailable' : state.sync ? `${state.sync.outboxPendingCount} pending sync events${state.storageMode === 'memory' ? ' (simulated)' : ''}` : 'Sync status not checked'}</span>
    <a id="summary-schema-link" href="/schema">Inspect schema</a>
  </div>${modelProgress(state.embeddings)}`;
}

export function updateSystemStrip() {
  const target = document.querySelector('#system-summary');
  if (target) setHtmlPreservingFocus(target, renderSystemStrip());
}

let pending;
export async function refreshStatus() {
  if (pending) return pending;
  pending = (async () => {
    await Promise.all([
      api('/api/embedding-jobs', { signal: AbortSignal.timeout(10000) }).then((data) => { state.embeddingJobs = data; state.embeddingJobsError = null; }).catch((error) => { state.embeddingJobs = null; state.embeddingJobsError = error.message; }),
      api('/api/embeddings', { signal: AbortSignal.timeout(10000) }).then((data) => { state.embeddings = data; state.embeddingError = null; }).catch((error) => { state.embeddings = null; state.embeddingError = error.message; }),
      api('/api/sync/status', { signal: AbortSignal.timeout(10000) }).then((data) => { state.sync = data; state.syncError = null; state.storageMode = data.storageMode ?? state.storageMode; }).catch((error) => { state.sync = null; state.syncError = error.message; })
    ]);
    state.statusCheckedAt = new Date().toISOString();
    updateSystemStrip();
    window.dispatchEvent(new Event('system-status-updated'));
  })().finally(() => { pending = null; });
  return pending;
}

let pollTimer;
export function startStatusPolling(onRefresh) {
  clearTimeout(pollTimer);
  const tick = async () => {
    if (!document.hidden) { await refreshStatus(); onRefresh?.(); }
    pollTimer = setTimeout(tick, state.isSearching || state.embeddings?.state === 'loading' || state.operation ? 1500 : 10000);
  };
  void tick();
  window.addEventListener('pagehide', () => clearTimeout(pollTimer), { once: true });
}
