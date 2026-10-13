import assert from 'node:assert/strict';
import pg from 'pg';
import { EmbeddingJobs, type EmbeddingJobCallbacks } from '../apps/api/src/embedding-jobs.js';
import { DATABASE_SCHEMA_SQL } from '../apps/api/src/schema.js';
import { EMBEDDING_MODEL, EMBEDDING_MODEL_KEY, EmbeddingUnavailableError, embeddingContentHash } from '../apps/api/src/embeddings.js';
import type { HouseSearchDocument } from '../packages/search-transform/src/house-search-document.js';

// Never inherit an application's DATABASE_URL. This script changes only an
// explicitly named disposable test database; it never contacts model providers.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL to an explicit disposable PostgreSQL database.');
const target = new URL(databaseUrl);
if (!/^faceted_embedding_queue_test(?:_[a-z0-9]+)?$/.test(decodeURIComponent(target.pathname.slice(1)))) {
  throw new Error('Refusing mutations: database name must be faceted_embedding_queue_test or faceted_embedding_queue_test_<suffix>.');
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
const workers = new Set<EmbeddingJobs>();
const vector = new Float32Array(384); vector[0] = 1;
const literal = `[${Array.from(vector).join(',')}]`;
const lock = [2147483646, 1769237];
const checks: string[] = [];
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
async function eventually(check: () => Promise<boolean>, label: string, milliseconds = 20_000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) { if (await check()) return; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
async function reset() {
  for (const worker of workers) await worker.stop();
  workers.clear();
  await pool.query('TRUNCATE houses, cities CASCADE');
  await pool.query('TRUNCATE house_embedding_work, embedding_projection_repairs, pgmq.q_cpu_embeddings, pgmq.a_cpu_embeddings');
  await pool.query(`INSERT INTO cities(id,name,state,center_lat,center_lng) VALUES('queue-city','Queue City','AL',34,-86)`);
}
async function house(id: string) {
  await pool.query(`INSERT INTO houses(id,title,description,city_id,address_line_1,zip_code,lat,lng,
    price,bedrooms,bathrooms,square_feet,property_type,listing_status,created_at,updated_at)
    VALUES($1,$2,'Quiet home near a park','queue-city','1 Test Lane','35801',34,-86,
      200000,3,2,1800,'single_family','active',now(),now())`, [id, `House ${id}`]);
}
async function loadDocument(id: string): Promise<HouseSearchDocument | undefined> {
  const { rows } = await pool.query(`SELECT h.*, c.name AS city_name FROM houses h JOIN cities c ON c.id=h.city_id
    WHERE h.id=$1 AND h.deleted_at IS NULL`, [id]);
  const row = rows[0];
  if (!row) return undefined;
  return { id, objectID: id, title: row.title, description: row.description,
    semanticText: `${row.title} ${row.description} ${row.city_name} ${row.property_type}`,
    price: row.price, listingStatus: row.listing_status } as HouseSearchDocument;
}
function worker(infer: (texts: string[]) => Promise<Float32Array[]> = async (texts) => texts.map(() => vector),
  sync: EmbeddingJobCallbacks['syncDocument'] = async () => undefined, projectionKey = 'postgres-only') {
  const result = new EmbeddingJobs(pool, databaseUrl!, { loadDocument, syncDocument: sync }, { inferTexts: infer, projectionKey });
  workers.add(result);
  return result;
}
async function completed(id: string) {
  const { rows } = await pool.query(`SELECT completed_version >= desired_version AS done FROM house_embedding_work WHERE house_id=$1`, [id]);
  return rows[0]?.done === true;
}
async function manualConsumer<T>(action: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    assert.equal((await client.query('SELECT pg_try_advisory_lock($1,$2) AS locked', lock)).rows[0].locked, true);
    return await action(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1,$2)', lock);
    client.release();
  }
}
async function claim(client: pg.PoolClient) {
  const result = (await client.query('SELECT * FROM embedding_queue_claim()')).rows[0];
  assert(result, 'Expected a queue claim');
  return result as { house_id: string; message_id: string; read_ct: number; source_version: string };
}
function args(item: { house_id: string; message_id: string; read_ct: number; source_version: string }) {
  return [item.house_id, item.message_id, item.read_ct, item.source_version];
}
async function finish(item: Parameters<typeof args>[0], success: boolean, error = 'deterministic failure') {
  return (await pool.query('SELECT embedding_queue_finish($1,$2,$3,$4,$5,$6) AS result', [...args(item), success, error])).rows[0].result;
}
async function expose(id: string) { await pool.query(`UPDATE pgmq.q_cpu_embeddings SET vt=clock_timestamp()-interval '1 second' WHERE msg_id=$1`, [id]); }

try {
  await pool.query(DATABASE_SCHEMA_SQL);
  await reset();

  await house('rollback');
  const before = (await pool.query('SELECT desired_version FROM house_embedding_work WHERE house_id=$1', ['rollback'])).rows[0].desired_version;
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(`UPDATE houses SET title='Rolled back' WHERE id='rollback'`);
    await tx.query(`INSERT INTO house_amenities VALUES('rollback','pool')`);
    await tx.query('ROLLBACK');
  } finally { tx.release(); }
  assert.equal((await pool.query('SELECT desired_version FROM house_embedding_work WHERE house_id=$1', ['rollback'])).rows[0].desired_version, before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pgmq.q_cpu_embeddings')).rows[0].n, 0);
  checks.push('source transaction rollback leaves no invalidation or queue message');

  await reset();
  for (let index = 0; index < 125; index++) await house(`capacity-${String(index).padStart(3, '0')}`);
  const paused = worker(); await paused.start(false);
  for (let index = 0; index < 5; index++) assert.equal(await paused.dispatch(), 20);
  assert.equal(await paused.dispatch(), 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pgmq.q_cpu_embeddings')).rows[0].n, 100);
  const pendingMessage = (await pool.query(`SELECT job_id FROM house_embedding_work WHERE house_id='capacity-000'`)).rows[0].job_id;
  await pool.query(`UPDATE houses SET title=title||' edited' WHERE id='capacity-000'`);
  assert.equal(await paused.dispatch(), 0);
  assert.equal((await pool.query(`SELECT job_id FROM house_embedding_work WHERE house_id='capacity-000'`)).rows[0].job_id, pendingMessage);
  checks.push('admission is capped at 100 messages and 20 per pass; repeated edits coalesce');

  await reset(); await house('lease');
  await pool.query('SELECT embedding_queue_dispatch()');
  const unclaimed = (await pool.query(`SELECT job_id,desired_version FROM house_embedding_work WHERE house_id='lease'`)).rows[0];
  assert.equal((await pool.query('SELECT embedding_queue_owned($1,$2,$3,$4) AS owned',
    ['lease', unclaimed.job_id, 0, unclaimed.desired_version])).rows[0].owned, false,
  'Unclaimed/null attempt state must produce false, never SQL NULL');
  await manualConsumer(async (client) => {
    const old = await claim(client);
    assert.equal(old.read_ct, 1);
    const doc = (await loadDocument('lease'))!;
    const storeArgs = [...args(old), EMBEDDING_MODEL_KEY, embeddingContentHash(doc.semanticText), literal, JSON.stringify(EMBEDDING_MODEL)];
    assert.equal((await pool.query('SELECT embedding_queue_store($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb) AS stored', storeArgs)).rows[0].stored, true);
    await expose(old.message_id);
    assert.equal(await finish(old, true), false, 'Expired lease cannot acknowledge');
    assert.equal((await pool.query('SELECT embedding_queue_store($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb) AS stored', storeArgs)).rows[0].stored, false);
    const fresh = await claim(client); assert.equal(fresh.read_ct, 2);
    assert.equal(await finish(old, true), false, 'Old read_ct cannot acknowledge a replacement attempt');
    assert.equal((await pool.query('SELECT embedding_queue_keepalive($1,$2,$3,$4) AS kept', args(old))).rows[0].kept, false);
    assert.equal((await pool.query('SELECT embedding_queue_keepalive($1,$2,$3,$4) AS kept', args(fresh))).rows[0].kept, true);
    assert.equal(await finish(fresh, true), true);
  });
  assert(await completed('lease'));
  checks.push('visibility expiry recovers; stale store/ack/heartbeat cannot affect a reclaimed attempt');

  await reset(); await house('retry');
  await pool.query('SELECT embedding_queue_dispatch()');
  await manualConsumer(async (client) => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const item = await claim(client); assert.equal(item.read_ct, attempt);
      assert.equal(await finish(item, false), true);
      if (attempt < 4) {
        const state = (await pool.query(`SELECT w.attempt_state,
          extract(epoch FROM (q.vt-clock_timestamp()))::float AS delay
          FROM house_embedding_work w JOIN pgmq.q_cpu_embeddings q ON q.msg_id=w.job_id WHERE w.house_id='retry'`)).rows[0];
        assert.equal(state.attempt_state, 'retry');
        assert(state.delay > 5 * 2 ** (attempt - 1) - 1 && state.delay <= 60);
        const status = await paused.status(); assert.equal(status.queue.active, 0); assert.equal(status.queue.retry, 1);
        await expose(item.message_id);
      }
    }
  });
  assert.equal(await paused.dispatch(), 0, 'Terminal failure must not generate unlimited new messages');
  const terminal = (await pool.query(`SELECT * FROM house_embedding_work WHERE house_id='retry'`)).rows[0];
  assert.equal(terminal.failed_version, terminal.desired_version);
  assert.equal(terminal.attempt_read_ct, 4); assert.equal(terminal.last_error, 'deterministic failure');
  assert.equal((await paused.status()).queue.failed, 1);
  const backfill = await paused.backfill(false); assert.equal(backfill.invalidated, 1);
  await paused.dispatch();
  await manualConsumer(async (client) => { const item = await claim(client); assert.equal(item.read_ct, 1); await finish(item, true); });
  checks.push('four attempts maximum, bounded retry delays, truthful retry status, terminal stop and explicit manual backfill');

  await reset(); await house('crashes'); await paused.dispatch();
  await manualConsumer(async (client) => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const item = await claim(client); assert.equal(item.read_ct, attempt);
      await expose(item.message_id); // A crashed consumer never calls finish().
    }
    assert.equal((await client.query('SELECT * FROM embedding_queue_claim()')).rows.length, 0,
      'A fifth delivery must archive the poison message without starting inference');
  });
  assert.equal(await paused.dispatch(), 0);
  assert.equal((await pool.query(`SELECT failed_version=desired_version AS failed FROM house_embedding_work WHERE house_id='crashes'`)).rows[0].failed, true);
  await pool.query(`UPDATE houses SET title=title||' fixed' WHERE id='crashes'`);
  assert.equal(await paused.dispatch(), 1, 'A new source version gets a fresh bounded execution budget');
  await manualConsumer(async (client) => { const item = await claim(client); assert.equal(item.read_ct, 1); await finish(item, true); });
  await pool.query(`UPDATE houses SET title=title||' changed again' WHERE id='crashes'`);
  assert.equal(await paused.dispatch(), 1);
  await pool.query('DELETE FROM pgmq.q_cpu_embeddings');
  assert.equal(await paused.dispatch(), 0, 'A disappeared new message must fail its dispatched version, not an older attempted version');
  assert.equal(await paused.dispatch(), 0);
  checks.push('four crashed leases exhaust the budget; a new source version gets a fresh message');

  await reset(); await house('race');
  const entered = deferred(); const release = deferred(); let inferenceCount = 0;
  const synced: Array<{ id: string; title?: string; vectorPresent: boolean }> = [];
  const racing = worker(async (texts) => {
    inferenceCount++;
    if (inferenceCount === 1) { entered.resolve(); await release.promise; }
    return texts.map(() => vector);
  }, async (doc, id, supplied, signal) => { signal.throwIfAborted(); synced.push({ id, title: doc?.title, vectorPresent: !!supplied }); });
  await racing.start();
  await Promise.race([entered.promise, sleep(10_000).then(() => { throw new Error('Inference barrier was not reached'); })]);
  await pool.query(`UPDATE houses SET title='New source text' WHERE id='race'`);
  release.resolve();
  await eventually(() => completed('race'), 'new source version gets embedded after stale inference');
  assert.equal(inferenceCount, 2);
  assert.equal(synced.length, 1); assert.equal(synced[0].title, 'New source text');
  assert.equal((await pool.query(`SELECT content_hash FROM house_embeddings WHERE house_id='race'`)).rows[0].content_hash,
    embeddingContentHash((await loadDocument('race'))!.semanticText));
  await pool.query(`UPDATE houses SET price=price+1000 WHERE id='race'`);
  await eventually(() => completed('race'), 'price-only synchronization');
  assert.equal(inferenceCount, 2, 'Nonsemantic edits must reuse the durable vector');
  checks.push('source mutation during inference discards stale output; price-only edits reuse stored vectors');

  await reset(); await house('engines-down');
  let engineFailure = true; let offlineInference = 0;
  const offline = worker(async (texts) => { offlineInference++; return texts.map(() => vector); },
    async (_doc, _id, _supplied, signal) => { signal.throwIfAborted(); if (engineFailure) throw new Error('deterministic engine outage'); });
  await offline.start();
  await eventually(async () => (await pool.query(`SELECT attempt_state FROM house_embedding_work WHERE house_id='engines-down'`)).rows[0].attempt_state === 'retry', 'engine outage gets a bounded retry');
  const offlineDoc = (await loadDocument('engines-down'))!;
  assert(Math.abs((await offline.similaritiesFor([offlineDoc], vector)).get(offlineDoc.id)! - 1) < 0.00001);
  const outageCoverage = await offline.status();
  assert.equal(outageCoverage.documents.current, 1); assert.equal(outageCoverage.documents.pending, 0);
  assert.equal(outageCoverage.documents.projectionPending, 1);
  assert.equal(offlineInference, 1);
  engineFailure = false;
  await pool.query(`UPDATE pgmq.q_cpu_embeddings SET vt=clock_timestamp()-interval '1 second'`);
  await eventually(() => completed('engines-down'), 'engine retry completes');
  assert.equal(offlineInference, 1, 'Engine retry must reuse successful PG inference');
  checks.push('PG vector search remains usable during engine failure and retry reuses the stored vector');

  await reset(); await house('deletion');
  const deletions: Array<boolean> = [];
  const deleting = worker(undefined, async (doc) => { deletions.push(doc === undefined); });
  await deleting.start(); await eventually(() => completed('deletion'), 'initial deletion fixture');
  await pool.query(`UPDATE houses SET deleted_at=now() WHERE id='deletion'`);
  await eventually(() => completed('deletion'), 'soft deletion cleanup');
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM house_embeddings WHERE house_id='deletion'`)).rows[0].n, 0);
  assert.equal(deletions.at(-1), true);
  await deleting.stop();
  const deletedVersion = (await pool.query(`SELECT desired_version FROM house_embedding_work WHERE house_id='deletion'`)).rows[0].desired_version;
  await deleting.start(false);
  assert.equal((await pool.query(`SELECT desired_version FROM house_embedding_work WHERE house_id='deletion'`)).rows[0].desired_version, deletedVersion,
    'Bootstrap must not invalidate completed soft-deletion cleanup because its vector is absent');
  const deletedCoverage = await deleting.status();
  assert.equal(deletedCoverage.documents.total, 0); assert.equal(deletedCoverage.documents.pending, 0);
  assert.equal(deletedCoverage.documents.deletedPending, 0);
  await deleting.stop(); await deleting.start();
  await pool.query(`UPDATE houses SET deleted_at=NULL WHERE id='deletion'`);
  await eventually(() => completed('deletion'), 'restore after soft delete');
  await pool.query(`DELETE FROM houses WHERE id='deletion'`);
  await eventually(() => completed('deletion'), 'hard deletion cleanup');
  assert.equal(deletions.at(-1), true);
  checks.push('soft/hard deletion removes vectors and leaves durable engine cleanup work');

  await reset();
  for (let index = 0; index < 6; index++) await house(`concurrency-${index}`);
  let active = 0; let maximum = 0; let computations = 0;
  const infer = async (texts: string[]) => {
    active++; maximum = Math.max(maximum, active); computations++;
    try { await sleep(40); return texts.map(() => vector); } finally { active--; }
  };
  const one = worker(infer); const two = worker(infer);
  await Promise.all([one.start(), two.start()]);
  await eventually(async () => (await pool.query('SELECT count(*)::int AS n FROM house_embedding_work WHERE completed_version < desired_version')).rows[0].n === 0, 'two consumers finish queued work');
  assert.equal(maximum, 1); assert.equal(computations, 6);
  await one.stop(); await two.stop();
  const restarted = worker(infer); await restarted.start();
  await sleep(1200); assert.equal(computations, 6, 'Restart must not re-embed completed current vectors');
  await house('after-restart'); await eventually(() => completed('after-restart'), 'new source after restart');
  assert.equal(computations, 7);
  await assert.rejects(restarted.similaritiesFor([{ id: 'after-restart', semanticText: 'Changed text with no current vector' }], vector), EmbeddingUnavailableError);
  checks.push('two API consumers share global CPU=1; restart preserves work/current vectors; reader rejects stale candidate hashes');

  await reset(); await house('projection-change');
  let oldSyncs = 0; let newSyncs = 0;
  const oldProjection = worker(undefined, async () => { oldSyncs++; }, 'postgres-only');
  await oldProjection.start(); await eventually(() => completed('projection-change'), 'PG-only source completes');
  assert.equal(oldSyncs, 1);
  const newProjection = worker(undefined, async () => { newSyncs++; }, 'postgres-plus-meili');
  await newProjection.start();
  await eventually(() => completed('projection-change'), 'newly enabled appliance receives automatic backfill');
  assert.equal(newSyncs, 1); assert.equal(oldSyncs, 1, 'Old configured consumer must not process the new projection');
  await assert.rejects(oldProjection.backfill(true), /configuration changed/);
  await oldProjection.stop(); await newProjection.stop();
  await pool.query("UPDATE houses SET title=title||' fencing' WHERE id='projection-change'");
  await newProjection.dispatch();
  await manualConsumer(async (client) => {
    assert.equal((await client.query('SELECT * FROM embedding_queue_claim_for_projection($1)', ['postgres-only'])).rows.length, 0);
    const item = (await client.query('SELECT * FROM embedding_queue_claim_for_projection($1)', ['postgres-plus-meili'])).rows[0];
    assert(item);
    await pool.query("UPDATE embedding_pipeline_config SET projection_key='changed-again' WHERE singleton");
    const a = args(item);
    assert.equal((await pool.query('SELECT embedding_queue_owned_for_projection($1,$2,$3,$4,$5) AS ok', [...a, 'postgres-plus-meili'])).rows[0].ok, false);
    assert.equal((await pool.query('SELECT embedding_queue_keepalive_for_projection($1,$2,$3,$4,$5) AS ok', [...a, 'postgres-plus-meili'])).rows[0].ok, false);
    assert.equal((await pool.query('SELECT embedding_queue_store_for_projection($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb,$9) AS ok',
      [...a, EMBEDDING_MODEL_KEY, 'hash', literal, JSON.stringify(EMBEDDING_MODEL), 'postgres-plus-meili'])).rows[0].ok, false);
    assert.equal((await pool.query('SELECT embedding_queue_finish_for_projection($1,$2,$3,$4,$5,$6,$7) AS ok', [...a, true, null, 'postgres-plus-meili'])).rows[0].ok, false);
  });
  checks.push('provider configuration changes automatically backfill; old workers cannot claim, store, heartbeat or acknowledge');

  await reset(); await house('ambiguous-repair');
  const repairWorker = worker(undefined, undefined, 'repair-test');
  await repairWorker.start(false);
  const version = async () => (await pool.query("SELECT desired_version FROM house_embedding_work WHERE house_id='ambiguous-repair'")).rows[0].desired_version;
  const repairBefore = await version();
  await repairWorker.beginProjectionRepair('meilisearch');
  const repairVersion = await version(); assert.notEqual(repairVersion, repairBefore);
  await repairWorker.beginProjectionRepair('meilisearch');
  assert.equal(await version(), repairVersion, 'Repeated failed setup must not reset source retry generations');
  await repairWorker.stop(); await repairWorker.start(false);
  await repairWorker.beginProjectionRepair('meilisearch');
  assert.equal(await version(), repairVersion, 'Pending setup intent survives API restart');
  await repairWorker.confirmProjectionReady('meilisearch');
  await repairWorker.beginProjectionRepair('meilisearch');
  assert.notEqual(await version(), repairVersion, 'A later distinct index loss creates a new repair generation');
  checks.push('durable pre-mutation repair intent survives restart and repeated ambiguous failures without resetting retry budgets');

  console.log(JSON.stringify({ passed: checks.length, checks, modelInference: 'deterministic injected normalized vectors',
    database: target.pathname.slice(1), extensions: (await pool.query(`SELECT extname,extversion FROM pg_extension WHERE extname IN ('pgmq','vector') ORDER BY extname`)).rows }, null, 2));
} finally {
  for (const instance of workers) await instance.stop();
  await pool.end();
}
