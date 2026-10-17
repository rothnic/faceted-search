import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cosineSimilarity, embedTexts, embeddingStatus, EMBEDDING_MODEL } from '../apps/api/src/embeddings.js';
import type { HouseSearchRequest, HouseSearchResponse } from '../packages/search-contracts/src/search-provider.interface.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'faceted-embeddings-'));

async function startServer(label: string, extraEnv: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/support/fixture-api.ts'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: '', NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', DEMO_DATA_DIR: join(temporary, label), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let logs = '';
  child.stdout!.on('data', (data) => { logs += data; });
  child.stderr!.on('data', (data) => { logs += data; });
  const closed = once(child, 'close');
  let port = 0;
  let timeout: ReturnType<typeof setTimeout>;
  const ready = new Promise<number>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Test server did not start: ${logs}`)), 20_000);
    child.once('message', (message) => {
      const result = message as { type?: string; port?: number };
      if (result.type === 'ready' && typeof result.port === 'number' && result.port > 0) resolve(result.port);
      else reject(new Error('Unexpected readiness message from test server'));
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Test server exited before readiness: ${logs}`)));
  });
  const call = async (path: string, body?: unknown, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
    return { status: response.status, body: await response.json() };
  };
  const stop = async () => {
    child.kill('SIGTERM');
    await closed;
  };
  try {
    // Only this child's successful bind can authorize requests; never trust an existing fixed-port server.
    port = await ready;
    assert.equal((await call('/api/providers')).status, 200);
    return { call, stop };
  } catch (error) {
    await stop();
    throw error;
  } finally {
    clearTimeout(timeout!);
  }
}

try {
  const started = performance.now();
  const texts = ['effortless upkeep condominium beside eateries', 'Single-level condo with walkable dining and low maintenance finishes.'];
  const [first, concurrent] = await Promise.all([embedTexts([...texts, texts[0]]), embedTexts(texts)]);
  assert.equal(embeddingStatus().computedTexts, 2, 'Concurrent identical texts must share inference');
  assert.equal(first[0], first[2]);
  assert.equal(first[0], concurrent[0]);
  for (const vector of first) {
    assert.equal(vector.length, 384);
    assert(vector.every(Number.isFinite));
    assert(Math.abs(Math.hypot(...vector) - 1) < 0.001);
  }
  assert(cosineSimilarity(first[0], first[1]) > 0.45);
  const modelLoadAndTwoTextsMs = performance.now() - started;
  const [longA, longB] = await embedTexts([`${'house '.repeat(300)}pool`, `${'house '.repeat(300)}warehouse`]);
  assert.deepEqual(longA, longB, 'Content beyond the 256-token limit must be truncated');

  const server = await startServer('working');
  try {
    const { call } = server;
    const search = async (criteria: Partial<HouseSearchRequest>) => {
      const response = await call('/api/search', { q: texts[0], mode: 'semantic', ...criteria });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body as HouseSearchResponse;
    };
    const detail = await call('/api/houses/target-retiree-low-maintenance');
    assert.equal(detail.status, 200);
    assert.equal(detail.body.house.id, 'target-retiree-low-maintenance');
    assert.equal(typeof detail.body.house.city, 'string');
    assert(!('score' in detail.body.house));
    assert.equal((await call('/api/houses/missing-house')).status, 404);
    assert.equal((await call('/api/houses/%E0%A4%A')).status, 400);
    const schema = (await call('/api/schema')).body;
    assert.equal(schema.liveIntrospection, false);
    for (const tableName of ['house_amenities', 'house_tags']) {
      const table = schema.tables.find((item: { name: string }) => item.name === tableName);
      assert.equal(table.columns.filter((column: { primaryKey: boolean; nullable: boolean }) => column.primaryKey && !column.nullable).length, 2);
    }
    assert.equal((await call('/api/embeddings')).body.state, 'idle');
    assert.equal((await search({ mode: 'keyword' })).totalHits, 0);
    assert.equal((await search({ q: ' ' })).totalHits, 126);
    assert.equal((await call('/api/embeddings')).body.state, 'idle', 'Blank/keyword search must not load a model');

    const [cold, simultaneous] = await Promise.all([search({}), search({})]);
    assert.equal(cold.hits[0].id, 'target-retiree-low-maintenance');
    assert(cold.hits.every((hit) => hit.matchedTerms.length === 0), 'This paraphrase is not a lexical match');
    assert.deepEqual(cold.hits, simultaneous.hits);
    assert.equal(cold.debug?.embedding?.revision, EMBEDDING_MODEL.revision);
    assert.equal(cold.debug?.execution, 'local-cpu');
    assert.equal(cold.mapHits.length, cold.totalHits);
    assert.equal(cold.facets.city.reduce((total, bucket) => total + bucket.count, 0), cold.totalHits);
    const computed = (await call('/api/embeddings')).body.computedTexts;
    const warm = await search({});
    assert.deepEqual(warm.hits, cold.hits);
    assert.equal((await call('/api/embeddings')).body.computedTexts, computed);

    for (const provider of ['postgres_native', 'pg_search', 'meilisearch', 'typesense'] as const) {
      const response = await search({ provider });
      assert.deepEqual(response.hits, cold.hits);
      assert.equal(response.debug?.execution, 'local-cpu');
    }
    const hybrid = await search({ mode: 'hybrid' });
    assert.equal(hybrid.hits[0].id, cold.hits[0].id);
    assert.equal((await search({ q: 'zzzz qqqq xxxx', mode: 'hybrid' })).totalHits, 0);
    const page = await search({ page: 2, pageSize: 3 });
    assert.deepEqual(page.hits.map((hit) => hit.id), cold.mapHits.slice(3, 6).map((hit) => hit.id));
    assert.equal(page.mapHits.length, cold.totalHits);
    const filtered = await search({ filters: { city: ['Huntsville'], propertyType: ['condo'] }, geo: { lat: 34.746, lng: -86.567, radiusMiles: 1 } });
    assert(filtered.totalHits > 0);
    assert(filtered.hits.every((hit) => hit.city === 'Huntsville' && hit.propertyType === 'condo' && hit.distanceMiles! <= 1));
    assert.equal(filtered.mapHits.length, filtered.totalHits);

    const saved = (await call('/api/saved-searches', { name: 'CPU paraphrase', criteria: { q: texts[0], mode: 'semantic', pageSize: 1 } })).body;
    assert.equal(saved.currentHitCount, cold.totalHits);
    assert.equal(saved.seenHouseIds.length, cold.totalHits, 'Saving must include matches beyond page one');
    const evaluated = (await call(`/api/saved-searches/${saved.id}/evaluate`, {})).body;
    assert.equal(evaluated.newMatchesSinceLastEvaluation, 0);
    const savedCounts = (await call('/api/saved-searches')).body.savedSearches;
    assert.equal(savedCounts.find((item: { id: string }) => item.id === saved.id).currentHitCount, cold.totalHits);
    const scoped = await search({ q: '', savedSearchIds: [saved.id], filters: { city: ['Huntsville'] } });
    assert(scoped.mapHits.every((hit) => cold.mapHits.some((original) => original.id === hit.id) && hit.city === 'Huntsville'));
    const broad = (await call('/api/saved-searches', { name: 'All listings', criteria: { q: '', mode: 'semantic', pageSize: 1 } })).body;
    assert.equal(broad.seenHouseIds.length, 126);
    assert.equal((await call(`/api/saved-searches/${broad.id}/evaluate`, {})).body.newMatchesSinceLastEvaluation, 0);
    assert.equal((await search({ q: '', savedSearchIds: [saved.id, broad.id] })).totalHits, 126);

    const beforePrice = (await call('/api/embeddings')).body.computedTexts;
    await call('/api/houses/target-retiree-low-maintenance', { price: 300000 }, 'PATCH');
    assert.equal((await search({})).hits[0].price, 300000);
    assert.equal((await call('/api/embeddings')).body.computedTexts, beforePrice, 'Price-only edits reuse the vector');
    await call('/api/houses/target-retiree-low-maintenance', { title: 'Freight warehouse', description: 'Industrial loading docks for cargo trucks.', amenities: [], tags: [] }, 'PATCH');
    const edited = await search({});
    assert.notEqual(edited.hits[0].id, 'target-retiree-low-maintenance', 'Changed text must not retain its old vector');
    assert.equal((await call('/api/embeddings')).body.computedTexts, beforePrice + 1);
    await call(`/api/houses/${edited.hits[0].id}`, { deleted: true }, 'PATCH');
    assert(!(await search({})).mapHits.some((hit) => hit.id === edited.hits[0].id));
    assert.equal((await call(`/api/houses/${edited.hits[0].id}`)).status, 404);
    assert.equal((await call('/api/search', { q: 'x'.repeat(2001) })).status, 400);

    console.log(JSON.stringify({ model: EMBEDDING_MODEL, modelLoadAndTwoTextsMs: Math.round(modelLoadAndTwoTextsMs), firstSearchMs: cold.processingTimeMs, repeatSearchMs: warm.processingTimeMs, semanticHits: cold.totalHits, target: cold.hits[0].id, similarity: cold.hits[0].semanticScore, processRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));
  } finally {
    await server.stop();
  }

  const unavailable = await startServer('unavailable', { EMBEDDING_OFFLINE: '1', EMBEDDING_CACHE_DIR: join(temporary, 'empty-model-cache') });
  try {
    assert.equal((await unavailable.call('/api/search', { q: texts[0], mode: 'semantic' })).status, 503);
    assert.equal((await unavailable.call('/api/embeddings')).body.state, 'error');
    const counts = (await unavailable.call('/api/saved-searches')).body.savedSearches;
    assert(counts.some((search: { currentHitCount: number | null; evaluationError?: string }) => search.currentHitCount === null && search.evaluationError));
    assert.equal((await unavailable.call('/api/search', { q: 'garage', mode: 'keyword' })).status, 200);
    assert.equal((await unavailable.call('/api/search', { q: '', mode: 'semantic' })).status, 200);
    assert.equal((await unavailable.call('/api/search', { q: texts[0], mode: 'semantic' })).status, 503, 'Failed initialization may retry without poisoning keyword mode');
  } finally {
    await unavailable.stop();
  }

  const offline = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('Unexpected network request during offline inference'); };
    const { embedTexts, embeddingStatus } = await import('./apps/api/src/embeddings.ts');
    await embedTexts(['offline CPU inference']);
    if (embeddingStatus().state !== 'ready') throw new Error('Offline model did not load');
  `], { cwd: root, env: { ...process.env, EMBEDDING_OFFLINE: '1' }, stdio: 'inherit' });
  assert.equal((await once(offline, 'close'))[0], 0, 'Cached model must load with every network fetch forbidden');
  console.log('CPU embedding verification passed: real inference, API ranking, cache/invalidation, counts/facets/map/scopes, offline reload and unavailable-model recovery.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
