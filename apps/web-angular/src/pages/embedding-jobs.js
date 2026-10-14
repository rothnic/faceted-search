import { escapeHtml as e, state } from '../core.js';

const time = (value) => value ? e(new Date(value).toLocaleString()) : 'Not recorded';
const fact = (label, value) => `<dt>${label}</dt><dd>${e(value ?? 'Unknown')}</dd>`;

export function renderEmbeddingJobs() {
  const jobs = state.embeddingJobs;
  const heading = '<div class="section-heading"><div><span class="eyebrow">Automatic generation</span><h2>Embedding pipeline</h2></div></div>';
  if (!jobs) return `<section class="panel status-section" id="embedding-pipeline">${heading}<p class="notice error" role="status">Pipeline status unavailable: ${e(state.embeddingJobsError || 'Waiting for API')}. Queue counts and worker activity are unknown.</p></section>`;
  if (!jobs.durable) return `<section class="panel status-section" id="embedding-pipeline">${heading}<p class="notice">On-demand demo · no durable embedding queue</p><p>${e(jobs.note || 'This storage mode does not report a durable pipeline.')}</p><p class="stats">No background job counts or completion percentage are available in this mode.</p></section>`;
  const queue = jobs.queue;
  const documents = jobs.documents;
  return `<section class="panel status-section" id="embedding-pipeline">${heading}
    <div class="action-row"><span class="status-badge">Durable PostgreSQL queue</span><span class="status-badge">${jobs.enabled ? 'Pipeline enabled' : 'Pipeline disabled'}</span></div>
    <p class="stats">Observed ${time(jobs.observedAt)}. Enabled describes configuration, not a worker-health guarantee.</p>
    <p>Source changes are recorded durably before background processing. PostgreSQL stores application-generated vectors; Meilisearch and Typesense generate their own embeddings from configured fields.</p>
    ${jobs.lastError ? `<p class="notice error" role="alert">${e(jobs.lastError)}</p>` : ''}
    <div class="status-grid">
      <article class="status-card"><h3>Observed queue</h3>
        ${queue ? `<p class="stats">${e(queue.backend)} · ${e(queue.name)}</p><dl class="status-facts">
          ${fact('Waiting for first attempt', queue.created)}${fact('Active reservations', queue.active)}${fact('Awaiting retry', queue.retry)}${fact('Archived failed jobs', queue.failed)}${fact('Archived completed jobs', queue.completed)}
          ${fact('Consumer limit', queue.maxActive)}${fact('Admission limit', queue.maxQueued)}
        </dl><p class="stats">Queue counts are jobs, not unique documents or a backfill percentage. Archived counts are historical.</p>${queue.concurrencyNote ? `<p class="stats">${e(queue.concurrencyNote)}</p>` : ''}` : '<p class="notice">Queue counts unavailable.</p>'}
      </article>
      <article class="status-card"><h3>Document freshness</h3>
        ${documents ? `<dl class="status-facts">
          ${fact('Live documents', documents.total)}${fact('Current PostgreSQL vectors', documents.current)}${fact('Vectors pending', documents.pending)}${fact('Documents with vector failures', documents.failed)}${fact('Pipeline completions pending', documents.projectionPending)}${fact('Deleted documents pending cleanup', documents.deletedPending)}
        </dl><p class="stats">Pending and failed categories can overlap. Projection counts do not measure an appliance’s internal embedding/indexing progress.</p>` : '<p class="notice">Document counts unavailable.</p>'}
      </article>
    </div>
    <p class="stats">Last dispatch in this API process: ${time(jobs.lastDispatchAt)}</p>
    <p class="stats">Model: ${e(jobs.model?.model ?? 'Unknown')} · Semantic source fields: ${e((jobs.sourceFields || []).join(', ') || 'Unknown')}</p>
    <div class="action-row"><button class="btn btn-sm btn-outline" id="queue-embedding-backfill" data-system-action="embedding-backfill" ${state.operation || !jobs.enabled ? 'disabled' : ''}>Queue missing or stale embeddings</button></div>
    <p class="stats">This requests admission to bounded background work. An accepted request is not completed indexing.${jobs.enabled ? '' : ' Enable the pipeline before requesting work.'}</p>
    ${jobs.recentFailures?.length ? `<h3>Recent recorded failures</h3><div class="table-scroll"><table class="matrix"><thead><tr><th>Document</th><th>Error</th><th>Attempts</th><th>Retry time</th></tr></thead><tbody>${jobs.recentFailures.map((failure) => `<tr><td>${e(failure.houseId)}</td><td>${e(failure.error)}</td><td>${e(failure.attempts ?? 'Unknown')}</td><td>${time(failure.retryAt)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="stats">No recent failure records returned. This is not a live appliance-health probe.</p>'}
    <details id="embedding-jobs-raw"><summary id="embedding-jobs-raw-summary">Raw observed embedding pipeline</summary><pre>${e(JSON.stringify(jobs, null, 2))}</pre></details>
  </section>`;
}
