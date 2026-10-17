import { seedRealTestDatabase } from '../tests/support/seed-real.js';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { MEILI_NATIVE_EMBEDDER } from '../apps/api/src/appliance-vectors.js';
import { EMBEDDING_MODEL_KEY } from '../apps/api/src/embeddings.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !/^faceted_native_test(?:_[a-z0-9]+)?$/.test(new URL(databaseUrl).pathname.slice(1))) {
  throw new Error('Set TEST_DATABASE_URL to an explicitly disposable faceted_native_test[_suffix] database. This verifier replaces its demo data.');
}
const providers = (process.env.TEST_NATIVE_PROVIDERS ?? 'meilisearch,typesense').split(',').filter(Boolean);
assert(providers.every((value) => ['meilisearch', 'typesense'].includes(value)));
if (providers.length && process.env.TEST_DISPOSABLE_ENGINES !== '1') {
  throw new Error('Set TEST_DISPOSABLE_ENGINES=1 only for owned disposable engine instances: this verifier replaces their houses index/collection.');
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
let child: ChildProcess | undefined;
let base = '';
let logs = '';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function start(enabledProviders = providers) {
  child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
    env: { ...process.env, DATABASE_URL: databaseUrl!, DATASET_ID: 'ci-native', SEARCH_SYNC_PROVIDERS: enabledProviders.join(','), EMBEDDING_WORKER_ENABLED: '1', PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout?.on('data', (data) => { logs += data.toString(); });
  child.stderr?.on('data', (data) => { logs += data.toString(); });
  const owned = child;
  const port = await new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Owned API startup timed out: ${logs}`)), 30_000);
    owned.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Owned API exited ${code}: ${logs}`)); });
    owned.once('error', (error) => { clearTimeout(timeout); reject(error); });
    owned.on('message', (value) => {
      const message = value as { type: string; port: number };
      if (message.type === 'ready' && Number.isInteger(message.port)) { clearTimeout(timeout); resolve(message.port); }
    });
  });
  base = `http://127.0.0.1:${port}`;
}
async function stop() {
  const owned = child;
  child = undefined;
  if (!owned || owned.exitCode !== null) return;
  const exited = once(owned, 'exit');
  owned.kill('SIGTERM');
  const timer = setTimeout(() => owned.kill('SIGKILL'), 15_000);
  await exited;
  clearTimeout(timer);
}
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const value = await response.json();
  assert(response.ok, `${path}: ${response.status} ${JSON.stringify(value)}\n${logs.slice(-3000)}`);
  return value;
}
async function idle() {
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const status = await call('/api/embedding-jobs');
    assert(status.queue.active <= 1 && status.queue.created + status.queue.active + status.queue.retry <= 100, 'Queue bounds exceeded');
    if (status.recentFailures.length && status.queue.failed) throw new Error(JSON.stringify(status));
    if (!status.documents.pending && !status.documents.projectionPending && !status.documents.deletedPending && !status.queue.created && !status.queue.active && !status.queue.retry) return status;
    await sleep(250);
  }
  throw new Error(`Automatic queue did not settle: ${JSON.stringify(await call('/api/embedding-jobs'))}\n${logs.slice(-5000)}`);
}
async function engine(provider: string, path: string, method = 'GET') {
  const host = provider === 'meilisearch' ? process.env.MEILI_HOST ?? 'http://127.0.0.1:7700' : process.env.TYPESENSE_HOST ?? 'http://127.0.0.1:8108';
  const key = process.env.MEILI_MASTER_KEY ?? 'dev_meili_master_key';
  const headers: Record<string, string> = provider === 'meilisearch' ? key ? { Authorization: `Bearer ${key}` } : {} : { 'X-TYPESENSE-API-KEY': process.env.TYPESENSE_API_KEY ?? 'dev_typesense_api_key' };
  const response = await fetch(host + path, { method, headers, signal: AbortSignal.timeout(30_000) });
  return { status: response.status, body: await response.json() };
}
async function vectors(id: string) {
  const { rows } = await pool.query('SELECT embedding::text, content_hash, model_key, source_version FROM house_embeddings WHERE house_id=$1', [id]);
  assert.equal(rows[0]?.model_key, EMBEDDING_MODEL_KEY);
  const result: Record<string, number[]> = { postgres: JSON.parse(rows[0].embedding) };
  for (const provider of providers) {
    const response = await engine(provider, provider === 'meilisearch' ? `/indexes/houses/documents/${id}?retrieveVectors=true` : `/collections/houses/documents/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    result[provider] = provider === 'meilisearch' ? response.body._vectors[MEILI_NATIVE_EMBEDDER].embeddings[0] : response.body.embedding;
    if (provider === 'meilisearch') assert.equal(response.body._vectors[MEILI_NATIVE_EMBEDDER].regenerate, true, 'Meili vector must be engine-generated');
  }
  for (const vector of Object.values(result)) assert(vector.length === 384 && vector.every(Number.isFinite));
  return result;
}
const cosine = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
const q = 'effortless upkeep condominium beside eateries';
const search = (provider: string, extra: object = {}) => call('/api/search', { provider, q, mode: 'semantic', filters: {}, page: 1, pageSize: 3, includeFacets: true, sort: 'relevance', ...extra });
try {
  await start([]);
  const started = performance.now();
  await seedRealTestDatabase(databaseUrl!);
  await idle();
  // Enabling native providers after a completed PG-only load must automatically
  // synchronize existing data rather than mistake PG completion for native readiness.
  await stop(); await start();
  const initial = await idle();
  const automaticSeedMs = performance.now() - started;
  assert.equal(initial.documents.current, 126);
  assert.equal(initial.queue.backend, 'pgmq');
  const versions = await pool.query("SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgmq','vector') ORDER BY extname");
  console.log('Actual PostgreSQL extensions', versions.rows);
  const lexical = await search('postgres_native', { mode: 'keyword' });
  assert.equal(lexical.totalHits, 0);
  const mapPage = await search('postgres_native', { q: 'garage', mode: 'keyword', pageSize: 1 });
  const mapOnly = mapPage.mapHits.find((hit: {id: string}) => hit.id !== mapPage.hits[0].id);
  assert(mapOnly, 'Detail regression needs a map result outside the loaded page');
  const detail = (await call(`/api/houses/${encodeURIComponent(mapOnly.id)}`)).house;
  assert.equal(detail.id, mapOnly.id);
  assert.equal(detail.title, mapOnly.title);
  assert.equal(detail.city, mapOnly.city);
  assert(Array.isArray(detail.amenities) && Array.isArray(detail.tags) && typeof detail.description === 'string');
  assert(!('score' in detail) && !('matchedTerms' in detail), 'Record details must not invent query-ranking metadata');
  assert.equal((await fetch(`${base}/api/houses/missing-house`)).status, 404);
  assert.equal((await fetch(`${base}/api/houses/%E0%A4%A`)).status, 400);
  const nativeResults: Record<string, unknown> = {};
  for (const provider of ['postgres_native', ...(process.env.TEST_PG_SEARCH === '1' ? ['pg_search'] : []), ...providers]) {
    const keyword = await search(provider, { q: 'garage', mode: 'keyword' });
    assert(keyword.totalHits > 0 && keyword.mapHits.length === keyword.totalHits, `${provider} real keyword map/count`);
    assert.equal(keyword.debug.execution, provider === 'postgres_native' ? 'postgres-fts' : provider === 'pg_search' ? 'postgres-bm25' : 'external-keyword');
    assert.equal(keyword.facets.city.reduce((sum: number, bucket: {count: number}) => sum+bucket.count,0), keyword.totalHits);
    const result = await search(provider);
    assert.equal(result.hits[0]?.id, 'target-retiree-low-maintenance', `${provider} semantic paraphrase target`);
    assert.equal(result.mapHits.length, result.totalHits);
    assert.equal(result.facets.city.reduce((sum: number, bucket: { count: number }) => sum + bucket.count, 0), result.totalHits);
    assert.equal(result.debug.execution, providers.includes(provider) ? 'external-semantic' : 'postgres-vector');
    if (!providers.includes(provider)) assert(result.debug.sql.includes('<=>'), 'PG similarity must execute pgvector SQL');
    const page2 = await search(provider, { page: 2 });
    assert.deepEqual(page2.hits.map((hit: { id: string }) => hit.id), result.mapHits.slice(3, 6).map((hit: { id: string }) => hit.id));
    const scoped = await search(provider, { filters: { propertyType: ['condo'] }, geo: { lat: 34.746, lng: -86.567, radiusMiles: 10 } });
    assert(scoped.hits.every((hit: { propertyType: string; distanceMiles: number }) => hit.propertyType === 'condo' && hit.distanceMiles <= 10));
    const saved = await call('/api/saved-searches', { name: `${provider} native`, criteria: { provider, q, mode: 'semantic', pageSize: 1 } });
    assert.equal(saved.seenHouseIds.length, result.totalHits);
    assert.equal((await call(`/api/saved-searches/${saved.id}/evaluate`, {})).newMatchesSinceLastEvaluation, 0);
    const scope = await search(provider, { q: '', savedSearchIds: [saved.id] });
    assert.equal(scope.totalHits, result.totalHits);
    const freshTimings: number[] = [];
    const queries: Record<string, string[]> = {
      postgres_native: ['convenient retirement apartment close to dining', 'secluded horse pasture and country acreage', 'comfortable single level home for easy living'],
      pg_search: ['simple condominium near cafes for retirement', 'private rural horse farm with broad pastures', 'accessible one story house with little maintenance'],
      meilisearch: ['walkable easy care apartment near restaurants', 'quiet equestrian estate on country land', 'single floor residence suited to downsizing'],
      typesense: ['low upkeep condo convenient to eateries', 'remote ranch property for keeping horses', 'relaxed retirement in an accessible home']
    };
    const computedBefore = (await call('/api/embeddings')).computedTexts;
    for (const text of queries[provider]) {
      const t = performance.now(); await search(provider, { q: text }); freshTimings.push(performance.now() - t);
    }
    const computedAfter = (await call('/api/embeddings')).computedTexts;
    if (!providers.includes(provider)) assert.equal(computedAfter - computedBefore, 3, 'Fresh PG timings must execute three uncached embeddings');
    nativeResults[provider] = { totalHits: result.totalHits, first: result.hits[0].id, execution: result.debug.execution, freshQueryHttpMs: freshTimings };
  }
  if (providers.length) {
    const provider = providers[0];
    const removed = await engine(provider, provider === 'meilisearch' ? '/indexes/houses' : '/collections/houses', 'DELETE');
    assert(removed.status >= 200 && removed.status < 300);
    if (provider === 'meilisearch') {
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        if ((await engine(provider, `/tasks/${removed.body.taskUid}`)).body.status === 'succeeded') break;
        await sleep(100);
      }
      assert.equal((await engine(provider, '/indexes/houses')).status, 404);
    }
    const response = await fetch(`${base}/api/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, q, mode: 'semantic', filters: {}, page: 1, pageSize: 3, sort: 'relevance' }) });
    assert.equal(response.status, 503, 'Lost native index must not be reported as a complete empty search');
    await idle();
    assert.equal((await search(provider)).hits[0]?.id, 'target-retiree-low-maintenance', 'Native index loss automatically backfills source data');
  }
  const id = 'target-retiree-low-maintenance';
  const before = await vectors(id);
  const computed = (await call('/api/embeddings')).computedTexts;
  await call(`/api/houses/${id}`, { price: 275000 }, 'PATCH');
  await idle();
  assert.equal((await call(`/api/houses/${id}`)).house.price, 275000, 'Details read current PostgreSQL values');
  const priceOnly = await vectors(id);
  assert.equal((await call('/api/embeddings')).computedTexts, computed, 'Price-only update should reuse PG vector');
  for (const provider of Object.keys(before)) assert(cosine(before[provider], priceOnly[provider]) > 0.99999, `${provider} price-only vector`);
  await call(`/api/houses/${id}`, { title: 'Equestrian country ranch', description: 'Extensive pasture for horses on secluded rural acreage', tags: ['horse pasture', 'rural retreat'], amenities: ['barn', 'workshop'] }, 'PATCH');
  await idle();
  const edited = await vectors(id);
  for (const provider of Object.keys(before)) assert(cosine(before[provider], edited[provider]) < 0.95, `${provider} must regenerate after semantic field edit`);
  // Compare an updated native embedding with fresh indexing of identical source.
  await pool.query(`INSERT INTO houses SELECT (jsonb_populate_record(NULL::houses, to_jsonb(h) || '{"id":"native-fresh-test"}'::jsonb)).* FROM houses h WHERE id=$1;
  `, [id]);
  await pool.query("INSERT INTO house_tags SELECT 'native-fresh-test',tag FROM house_tags WHERE house_id=$1", [id]);
  await pool.query("INSERT INTO house_amenities SELECT 'native-fresh-test',amenity FROM house_amenities WHERE house_id=$1", [id]);
  await idle();
  const fresh = await vectors('native-fresh-test');
  for (const provider of Object.keys(edited)) assert(cosine(edited[provider], fresh[provider]) > 0.99999, `${provider} edited vector must equal fresh native generation`);
  await pool.query("DELETE FROM houses WHERE id='native-fresh-test'");
  await idle();
  for (const provider of providers) assert.equal((await engine(provider, provider === 'meilisearch' ? '/indexes/houses/documents/native-fresh-test' : '/collections/houses/documents/native-fresh-test')).status, 404);
  // Direct SQL edits and referenced semantic fields also enqueue automatically.
  const hash = (await pool.query('SELECT content_hash FROM house_embeddings WHERE house_id=$1', [id])).rows[0].content_hash;
  await pool.query("INSERT INTO house_tags VALUES ($1,'direct SQL tag')", [id]);
  await idle();
  assert.notEqual((await pool.query('SELECT content_hash FROM house_embeddings WHERE house_id=$1', [id])).rows[0].content_hash, hash);
  const cityId = (await pool.query('SELECT city_id FROM houses WHERE id=$1', [id])).rows[0].city_id;
  await pool.query("UPDATE cities SET name=name || ' Test' WHERE id=$1", [cityId]);
  await idle();
  assert((await search('postgres_native', { q: '', filters: {} })).hits.some((hit: { city: string }) => hit.city.endsWith(' Test')));
  assert((await call(`/api/houses/${id}`)).house.city.endsWith(' Test'), 'Details read current joined city names');
  await stop();
  await pool.query("UPDATE houses SET description=description || ' Restart recovery' WHERE id=$1", [id]);
  await start(); await idle();
  const durable = await vectors(id);
  assert(durable.postgres.length === 384);
  await call(`/api/houses/${id}`, { deleted: true }, 'PATCH'); await idle();
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM house_embeddings WHERE house_id=$1', [id])).rows[0].count, 0);
  for (const provider of providers) assert.equal((await engine(provider, provider === 'meilisearch' ? `/indexes/houses/documents/${id}` : `/collections/houses/documents/${id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/houses/${id}`)).status, 404, 'Deleted records have no public detail');
  const final = await call('/api/embedding-jobs');
  assert.equal(final.documents.pending, 0);
  console.log(JSON.stringify({ providers, automaticSeedMs, nativeResults, finalDocuments: final.documents, assertions: 'real FTS/BM25/native keyword and vector queries, backend maps/facets/counts/scopes, generation, edits, fresh-equivalence, SQL triggers, restart and deletes passed' }, null, 2));
} finally {
  await stop();
  await pool.end();
}
