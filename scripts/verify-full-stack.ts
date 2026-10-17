import { postApi } from './api-client.js';

// This legacy smoke test resets source data and mutates a listing. Never infer
// permission from a reachable fixed port or PostgreSQL storage mode.
if (process.env.TEST_DISPOSABLE_STACK !== '1' || !process.env.DEMO_URL) {
  throw new Error('Destructive verification resets listings and saved searches. Set TEST_DISPOSABLE_STACK=1 and an explicit DEMO_URL only for your disposable demo stack.');
}
const target = new URL(process.env.DEMO_URL);
if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash || target.pathname !== '/') {
  throw new Error('DEMO_URL must be an HTTP(S) origin for the explicitly disposable demo stack.');
}

async function getApi(path: string) {
  const baseUrl = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response.json();
}

async function patchApi(path: string, body: unknown) {
  const baseUrl = process.env.DEMO_URL ?? 'http://127.0.0.1:5173';
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return response.json();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function search(provider: 'meilisearch' | 'typesense') {
  return postApi('/api/search', {
    provider,
    q: 'hampton cove garage',
    mode: 'keyword',
    filters: {},
    sort: 'relevance',
    page: 1,
    pageSize: 3,
    includeFacets: true
  });
}

async function waitForAutomaticWork() {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const status = await getApi('/api/embedding-jobs');
    assert(status.durable, 'Full-stack verification requires real PostgreSQL with PGMQ.');
    if (!status.documents.pending && !status.documents.projectionPending && !status.queue.created && !status.queue.active && !status.queue.retry) return status;
    if (status.recentFailures.length && status.queue.failed) throw new Error(JSON.stringify(status.recentFailures));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Automatic embedding/native indexing did not complete.');
}

assert((await getApi('/api/providers')).storageMode === 'postgres', 'This verification requires the PostgreSQL full stack.');
// Source data must be loaded beforehand through the guarded test-only seed helper.
await waitForAutomaticWork();

const meili = await search('meilisearch');
assert(meili.hits[0]?.id === 'target-hampton-cove-garage', 'Meilisearch did not rank the targeted Hampton Cove listing first.');
assert(meili.debug?.rawResponse?.[0]?.facetDistribution, 'Meilisearch raw response did not include facetDistribution.');
assert(!JSON.stringify(meili.debug?.warnings ?? []).includes('fell back'), 'Meilisearch query fell back instead of using the real engine.');

const typesense = await search('typesense');
assert(typesense.hits[0]?.id === 'target-hampton-cove-garage', 'Typesense did not rank the targeted Hampton Cove listing first.');
assert(Array.isArray(typesense.debug?.rawResponse?.[0]?.facet_counts), 'Typesense raw response did not include facet_counts.');
assert(!JSON.stringify(typesense.debug?.warnings ?? []).includes('fell back'), 'Typesense query fell back instead of using the real engine.');

await patchApi('/api/houses/target-madison-starter', { price: 277000 });
await waitForAutomaticWork();
const complete = await getApi('/api/sync/status');
assert(complete.outboxPendingCount === 0, `Expected no pending source changes, got ${complete.outboxPendingCount}.`);
assert(!complete.providers.meilisearch.lastSyncError, `Meilisearch sync error: ${complete.providers.meilisearch.lastSyncError}`);
assert(!complete.providers.typesense.lastSyncError, `Typesense sync error: ${complete.providers.typesense.lastSyncError}`);
console.log('Full stack verification passed: PostgreSQL, automatic PGMQ embeddings, native engine backfill, search and automatic source sync.');
