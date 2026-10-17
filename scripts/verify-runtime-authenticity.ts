import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import pg from 'pg';

const criteria = { provider: 'postgres_native', mode: 'keyword', q: 'garage', filters: {}, sort: 'relevance', page: 1, pageSize: 18, includeFacets: true, includeMap: false };
async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
async function post(origin: string, body = criteria) {
  const response = await fetch(origin + '/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  return { status: response.status, body: await response.json() };
}
async function nextServer(api: string, dataset: string) {
  const port = await freePort();
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: 'apps/web-next',
    env: { ...process.env, SEARCH_API_ORIGIN: api, SEARCH_EXPECTED_DATASET_ID: dataset, SEARCH_EXPECTED_DATABASE_FINGERPRINT: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  const closed = once(child, 'exit').catch(() => undefined);
  const stop = async () => {
    if (child.exitCode === null && child.pid) child.kill('SIGTERM');
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 15_000);
    try { await closed; } finally { clearTimeout(timer); }
  };
  try { await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned Next readiness timed out: ' + logs)), 30_000);
    const done = () => { clearTimeout(timer); resolve(); };
    child.stdout!.on('data', value => { logs += String(value); if (/Ready in/.test(logs)) done(); });
    child.stderr!.on('data', value => { logs += String(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Owned Next exited ' + code + ': ' + logs)); });
  }); } catch (error) { await stop(); throw error; }
  return { origin: 'http://127.0.0.1:' + port, stop };
}

// Called only with the IPC-owned API and explicitly disposable database created by
// run-real-comparison-ui.ts. Positive results here come from real engine processes.
export async function verifyRuntimeAuthenticity(api: string, database: string) {
  assert.equal(process.env.TEST_DISPOSABLE_ENGINES, '1');
  assert(/^faceted_native_test(?:_[a-z0-9]+)?$/.test(new URL(database).pathname.slice(1)));
  const pool = new pg.Pool({ connectionString: database });
  const evidence: Record<string, unknown> = { scope: 'owned disposable real appliances; Next production mode', providers: [], browsers: [] };
  const servers: Awaited<ReturnType<typeof nextServer>>[] = [];
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const sqlCount = Number((await pool.query('SELECT count(*)::int AS count FROM houses WHERE deleted_at IS NULL')).rows[0].count);
    assert.equal(sqlCount, 126);
    const identity = (await post(api)).body.provenance.dataset;
    assert.equal(identity.count, sqlCount);
    const city = (await pool.query('SELECT id,name FROM cities ORDER BY id LIMIT 1')).rows[0];
    try {
      await pool.query('UPDATE cities SET name=$1 WHERE id=$2', [city.name + ' authenticity', city.id]);
      const changed = (await fetch(api + '/api/providers').then(r => r.json())).dataset;
      assert.notEqual(changed.revision, identity.revision, 'Related-table edit must change source revision');
      assert.equal(changed.databaseFingerprint, identity.databaseFingerprint);
    } finally { await pool.query('UPDATE cities SET name=$1 WHERE id=$2', [city.name, city.id]); }
    // Wait for the real external projections to reflect the restored source.
    const until = Date.now() + 180_000;
    let current = false;
    while (Date.now() < until) {
      const state = await fetch(api + '/api/embedding-jobs').then(r => r.json());
      if (!state.documents.pending && !state.documents.projectionPending && !state.queue.active && !state.queue.created && !state.queue.retry) { current = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(current, 'Source must be restored and real projections current');
    assert.equal((await fetch(api + '/api/seed', { method: 'POST' })).status, 404, 'Production has no fixture seed route');
    assert.equal((await post(api, { ...criteria, provider: 'unknown' })).status, 400);
    const next = await nextServer(api, 'ci-native'); servers.push(next);
    for (const provider of ['postgres_native', 'pg_search', 'meilisearch', 'typesense']) {
      const result = await post(next.origin, { ...criteria, provider });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.provider, provider);
      assert.equal(result.body.provenance.respondingProvider, provider);
      assert.equal(result.body.provenance.dataset.count, sqlCount);
      assert.equal(result.body.provenance.dataset.databaseFingerprint, identity.databaseFingerprint);
      assert.equal(result.body.totalHits, 35);
      assert.equal(result.body.hits.length, 18);
      assert.deepEqual(result.body.mapHits, []);
      (evidence.providers as unknown[]).push({ provider, totalHits: result.body.totalHits, loaded: result.body.hits.length, provenance: result.body.provenance, gatewayTimingMs: result.body.gatewayTimingMs });
    }
    browser = await chromium.launch({ headless: true });
    for (const width of [390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto(next.origin + '/search?q=garage');
      await page.getByLabel('Backend provenance').waitFor();
      assert.match(await page.getByLabel('Backend provenance').innerText(), /Responded postgres_native/);
      assert.match(await page.getByTestId('results-count').innerText(), /35/);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow');
      await mkdir('test-results/real-screenshots', { recursive: true });
      await page.screenshot({ path: 'test-results/real-screenshots/next-authenticity-' + width + '.png', fullPage: true });
      (evidence.browsers as unknown[]).push({ width, count: await page.getByTestId('results-count').innerText(), provenance: await page.getByLabel('Backend provenance').innerText() });
      await page.close();
    }
    const wrong = await nextServer(api, 'wrong-dataset'); servers.push(wrong);
    const mismatched = await post(wrong.origin);
    assert.equal(mismatched.status, 503);
    assert.equal(mismatched.body.code, 'BACKEND_IDENTITY_MISMATCH');
    const unavailable = await nextServer('http://127.0.0.1:' + await freePort(), 'ci-native'); servers.push(unavailable);
    const failed = await post(unavailable.origin, { ...criteria, provider: 'typesense' });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.code, 'BACKEND_UNAVAILABLE');
    assert(!failed.body.hits && !failed.body.provenance, 'Failure cannot substitute results');
    const failedPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
    await failedPage.goto(unavailable.origin + '/search?provider=typesense&q=garage');
    await failedPage.locator('.search-error').waitFor();
    assert.match(await failedPage.locator('.search-error').innerText(), /unavailable/i);
    assert.equal(await failedPage.locator('.result-card').count(), 0);
    await failedPage.close();
    const unconfigured = await nextServer('', 'ci-native'); servers.push(unconfigured);
    const missing = await post(unconfigured.origin);
    assert.equal(missing.status, 503);
    assert.equal(missing.body.code, 'BACKEND_NOT_CONFIGURED');
    evidence.negativeChecks = ['related-table revision', 'runtime seed absent', 'unknown provider rejected', 'dataset mismatch rejected', 'unreachable selected API returns 503 without results', 'failure visible without cards', 'missing configuration rejected'];
  } finally {
    await browser?.close();
    for (const server of servers.reverse()) await server.stop();
    await pool.end();
    await mkdir('test-results/native', { recursive: true });
    await writeFile('test-results/native/runtime-authenticity.json', JSON.stringify(evidence, null, 2));
  }
  console.log('Real Next backend authenticity passed: four keyword providers, two viewports, explicit failure paths.');
}
