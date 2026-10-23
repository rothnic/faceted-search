import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type pg from 'pg';
import { RealServices, realServiceConfigFromEnv } from '../apps/api/src/real-services.js';

// Reuse the existing disposable real-engine lifecycle; never launch against a
// discovered preview or read its credentials/configuration.
export async function verifyReadOnlyRuntime(database: string, pool: pg.Pool) {
  assert.equal(process.env.TEST_DISPOSABLE_ENGINES, '1');
  assert(/^faceted_native_test(?:_[a-z0-9]+)?$/.test(new URL(database).pathname.slice(1)));
  const writableOptions = new URL(database);
  writableOptions.searchParams.set('options', '-c default_transaction_read_only=off');
  const config = { ...realServiceConfigFromEnv(), databaseUrl: writableOptions.toString(), readOnly: true,
    syncProviders: ['meilisearch', 'typesense'] as const };
  const services = new RealServices({ ...config, syncProviders: [...config.syncProviders] });
  // This uses real PostgreSQL connections. Worker startup is a forbidden path,
  // not a mocked source of search results or readiness.
  services.embeddingJobs.start = async () => { assert.fail('Read-only startup entered the queue initialization/worker lifecycle'); };
  const snapshot = async () => (await pool.query(`SELECT md5(concat_ws('|',
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY id)::text FROM houses h),
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY house_id)::text FROM house_embedding_work w),
    (SELECT jsonb_agg(to_jsonb(c))::text FROM embedding_pipeline_config c),
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY provider)::text FROM search_sync_state s),
    (SELECT last_value::text FROM house_embedding_version))) AS digest`)).rows[0].digest;
  const before = await snapshot();
  try {
    await services.start();
    const house = (await services.loadHouses())[0];
    assert(house);
    await assert.rejects(services.updateHouse(house.id, { title: house.title }),
      (error: unknown) => (error as {code?: string}).code === '25006', 'PostgreSQL itself must reject accidental source writes');
  } finally { await services.close(); }

  const hidden = new URL(database);
  hidden.searchParams.set('options', '-c search_path=pg_catalog -c default_transaction_read_only=off');
  const unprovisioned = new RealServices({ ...config, databaseUrl: hidden.toString(), syncProviders: [...config.syncProviders] });
  try { await assert.rejects(unprovisioned.start(), /No initialization was attempted/); }
  finally { await unprovisioned.close(); }

  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/main.ts'], {
    env: { ...process.env, DATABASE_URL: database, DATASET_ID: 'ci-native', SEARCH_SYNC_PROVIDERS: 'meilisearch,typesense',
      SEARCH_READ_ONLY: '1', HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const closed = once(child, 'exit');
  let logs = '';
  child.stdout!.on('data', value => { logs += String(value); });
  child.stderr!.on('data', value => { logs += String(value); });
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Owned read-only API readiness timed out: ' + logs)), 30_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Owned read-only API exited ' + code + ': ' + logs)); });
      child.on('message', value => {
        const message = value as {type: string; port: number; readOnly: boolean};
        if (message.type === 'ready' && Number.isInteger(message.port) && message.readOnly === true) { clearTimeout(timer); resolve(message.port); }
      });
    });
    const origin = 'http://127.0.0.1:' + port;
    const metadata = await fetch(origin + '/api/providers').then(r => r.json());
    assert.equal(metadata.readOnly, true); assert.equal(metadata.dataset.count, 126);
    const state = await fetch(origin + '/api/embedding-jobs').then(r => r.json());
    assert.equal(state.enabled, false);
    const providers = [];
    for (const provider of ['postgres_native', 'pg_search', 'meilisearch', 'typesense']) {
      const response = await fetch(origin + '/api/search', { method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({provider,mode:'keyword',q:'',filters:{bedrooms:[4,5]},sort:'relevance',page:1,pageSize:18,includeFacets:true,includeMap:false}),
        signal: AbortSignal.timeout(120_000) });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.totalHits, 52); assert.equal(result.facets.bedrooms.length, 5);
      assert.equal(result.provenance.respondingProvider, provider);
      providers.push({provider,totalHits:result.totalHits,bedroomBuckets:result.facets.bedrooms.length});
    }
    const houseId = (await pool.query('SELECT id FROM houses ORDER BY id LIMIT 1')).rows[0].id;
    const detail = await fetch(origin + '/api/houses/' + encodeURIComponent(houseId)); assert.equal(detail.status, 200);
    const blocked = [];
    for (const [method,path] of [['POST','/api/embedding-jobs/backfill'],['POST','/api/sync/backfill'],['POST','/api/sync/worker/run'],['POST','/api/saved-searches'],['POST','/api/saved-searches/unknown/evaluate'],['PATCH','/api/houses/'+encodeURIComponent(houseId)]]) {
      const response = await fetch(origin+path,{method,headers:{'content-type':'application/json'},body:'{}'});
      assert.equal(response.status,403); assert.equal((await response.json()).code,'READ_ONLY_RUNTIME'); blocked.push(method+' '+path);
    }
    assert.equal(await snapshot(), before, 'Startup/search/rejected writes must preserve source, work versions, pipeline and sync state');
    return {mode:'read-only',queueInitialization:'not entered',workerEnabled:false,sqlWriteRejected:'25006',unprovisioned:'failed without initialization',providers,detailRead:200,blocked,sourceAndPipelineUnchanged:true};
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 15_000);
    try { await closed; } finally { clearTimeout(timer); }
  }
}
