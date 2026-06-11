import { postApi } from './api-client.js';

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

await postApi('/api/seed');
await postApi('/api/sync/backfill', { provider: 'meilisearch' });
await postApi('/api/sync/backfill', { provider: 'typesense' });

const meili = await search('meilisearch');
assert(meili.hits[0]?.id === 'target-hampton-cove-garage', 'Meilisearch did not rank the targeted Hampton Cove listing first.');
assert(meili.debug?.rawResponse?.facetDistribution, 'Meilisearch raw response did not include facetDistribution.');
assert(!JSON.stringify(meili.debug?.warnings ?? []).includes('fell back'), 'Meilisearch query fell back instead of using the real engine.');

const typesense = await search('typesense');
assert(typesense.hits[0]?.id === 'target-hampton-cove-garage', 'Typesense did not rank the targeted Hampton Cove listing first.');
assert(Array.isArray(typesense.debug?.rawResponse?.facet_counts), 'Typesense raw response did not include facet_counts.');
assert(!JSON.stringify(typesense.debug?.warnings ?? []).includes('fell back'), 'Typesense query fell back instead of using the real engine.');

await patchApi('/api/houses/target-madison-starter', { price: 277000 });
const pending = await getApi('/api/sync/status');
assert(pending.outboxPendingCount === 2, `Expected 2 pending outbox events, got ${pending.outboxPendingCount}.`);

const worker = await postApi('/api/sync/worker/run');
assert(worker.processed === 2, `Expected sync worker to process 2 events, got ${worker.processed}.`);

const complete = await getApi('/api/sync/status');
assert(complete.outboxPendingCount === 0, `Expected no pending outbox events, got ${complete.outboxPendingCount}.`);
assert(!complete.providers.meilisearch.lastSyncError, `Meilisearch sync error: ${complete.providers.meilisearch.lastSyncError}`);
assert(!complete.providers.typesense.lastSyncError, `Typesense sync error: ${complete.providers.typesense.lastSyncError}`);

console.log('Full stack verification passed: Postgres, Meilisearch, Typesense, backfill, search, and sync worker are functional.');
