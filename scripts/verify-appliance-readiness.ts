import assert from 'node:assert/strict';
import { NativeAppliances, MEILI_NATIVE_EMBEDDER, TYPESENSE_NATIVE_MODEL, type ApplianceConfig, type ApplianceProvider } from '../apps/api/src/appliance-vectors.js';
import type { HouseSearchDocument } from '../packages/search-transform/src/house-search-document.js';

// Deterministic HTTP fixtures only: no service, model download, database, or paid API is contacted.
const originalFetch = globalThis.fetch;
const signal = () => AbortSignal.timeout(5000);
const document = {
  id: 'readiness-house', objectID: 'readiness-house', title: 'Park home', description: 'Quiet garden',
  semanticText: 'park home quiet garden', city: 'Test City', state: 'AL', zipCode: '00000', lat: 34, lng: -86,
  price: 200000, bedrooms: 3, bathrooms: 2, squareFeet: 1500, propertyType: 'single_family', listingStatus: 'active',
  amenities: ['garden'], tags: [], cityFacet: 'Test City', stateFacet: 'AL', propertyTypeFacet: 'single_family',
  listingStatusFacet: 'active', updatedAt: '2026-10-13T12:00:00Z'
} satisfies HouseSearchDocument;
type Field = { name: string; type: string; optional?: boolean; index?: boolean; facet?: boolean; sort?: boolean; num_dim?: number; embed?: { from: string[]; model_config: { model_name: string } } };
type Request = { method: string; path: string; body: Record<string, unknown> | Record<string, unknown>[] | undefined };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

class Fixture {
  readonly requests: Request[] = [];
  readonly writes: Array<{ native: boolean; body: Record<string, unknown> }> = [];
  readonly tasks = new Map<number, () => void>();
  readonly events: string[] = [];
  indexExists = false;
  settings: Record<string, unknown> = {};
  fields: Field[] | undefined;
  pause?: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  failSettingsOnce = false;
  failTaskAfterApplyOnce = false;
  constructor(readonly provider: ApplianceProvider) {}

  appliance(callbacks: Pick<ApplianceConfig, 'onRepair' | 'onReady' | 'readOnly'> = {}) {
    globalThis.fetch = this.fetch;
    return new NativeAppliances({ meiliHost: 'http://meili.fixture', meiliKey: 'fixture-only', typesenseHost: 'http://typesense.fixture', typesenseKey: 'fixture-only', providers: [this.provider], ...callbacks });
  }
  private accepted(action: () => void) {
    const taskUid = this.tasks.size + 1;
    this.tasks.set(taskUid, action);
    return response({ taskUid });
  }
  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.host, this.provider === 'meilisearch' ? 'meili.fixture' : 'typesense.fixture');
    init.signal?.throwIfAborted();
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    this.requests.push({ method, path, body });
    this.events.push(`${method} ${path}`);
    if (path === '/experimental-features') return response({ vectorStore: true });
    if (path.startsWith('/tasks/')) {
      const action = this.tasks.get(Number(path.split('/').at(-1)));
      assert(action, 'Task must have been accepted before polling');
      action();
      if (this.failTaskAfterApplyOnce) { this.failTaskAfterApplyOnce = false; return response({ message: 'task response lost after apply' }, 503); }
      return response({ status: 'succeeded' });
    }
    if (path === '/indexes' && method === 'POST') return this.accepted(() => { this.indexExists = true; this.settings = { searchableAttributes: ['*'] }; });
    if (path === '/indexes/houses' && method === 'GET') {
      this.pause?.entered.resolve();
      if (this.pause) await this.pause.release.promise;
      return this.indexExists ? response({ primaryKey: 'id' }) : response({}, 404);
    }
    if (path === '/indexes/houses/settings') {
      if (method === 'GET') {
        if (this.failSettingsOnce) { this.failSettingsOnce = false; return response({ message: 'fixture failure' }, 503); }
        return response(this.settings);
      }
      return this.accepted(() => {
        this.settings = { ...this.settings, ...body, embedders: { ...this.embedders(), ...body?.embedders } };
        // Meili1.11 normalizes any searchable wildcard plus explicit names back to ['*'].
        if ((this.settings.searchableAttributes as string[] | undefined)?.includes('*')) this.settings.searchableAttributes = ['*'];
      });
    }
    if (path === '/debug') return response({ version: '28.0' });
    if (path === '/collections' && method === 'POST') { this.fields = body.fields; return response(body); }
    if (path === '/collections/houses') {
      if (method === 'GET') return this.fields ? response({ fields: this.fields }) : response({}, 404);
      assert(this.fields); this.fields.push(...body.fields); return response({ fields: this.fields });
    }
    if (path.endsWith('/documents') && method === 'POST') {
      const source = Array.isArray(body) ? body[0] : body;
      assert(!Object.hasOwn(source, '_vectors') && !Object.hasOwn(source, 'embedding'), 'Source writes must not contain vectors');
      // Reproduce Meili's dangerous behavior: a document POST can auto-create a plain index.
      if (this.provider === 'meilisearch' && !this.indexExists) { this.indexExists = true; this.settings = {}; }
      this.writes.push({ native: this.nativeConfigured(), body: source });
      return this.provider === 'meilisearch' ? this.accepted(() => undefined) : response(source);
    }
    if (path.endsWith('/search')) return response({ hits: [] });
    if (method === 'DELETE') return this.provider === 'meilisearch' ? this.accepted(() => undefined) : response({ id: document.id });
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  };
  embedders() { return (this.settings.embedders ?? {}) as Record<string, Record<string, unknown>>; }
  nativeConfigured() {
    return this.provider === 'meilisearch'
      ? this.embedders()[MEILI_NATIVE_EMBEDDER]?.source === 'huggingFace'
      : this.fields?.find((field) => field.name === 'embedding')?.embed?.model_config.model_name === TYPESENSE_NATIVE_MODEL;
  }
  reads() { return this.requests.filter((request) => request.method === 'GET' && request.path === (this.provider === 'meilisearch' ? '/indexes/houses' : '/collections/houses')).length; }
  removeIndex() { this.indexExists = false; this.settings = {}; this.fields = undefined; }
  addRemoteEmbedder() {
    if (this.provider === 'meilisearch') this.settings.embedders = { ...this.embedders(), paid: { source: 'openAi', model: 'text-embedding-3-small' } };
    else this.fields!.push({ name: 'paid', type: 'float[]', embed: { from: ['semanticText'], model_config: { model_name: 'openai/text-embedding-3-small' } } });
  }
}

const checks: string[] = [];
try {
  for (const provider of ['meilisearch', 'typesense'] as const) {
    const fixture = new Fixture(provider);
    await fixture.appliance().ensure(provider, signal());
    fixture.requests.length = 0;
    const readOnly = fixture.appliance({ readOnly: true,
      onRepair: async () => { assert.fail('Read-only validation cannot record repair intent'); },
      onReady: async () => { assert.fail('Read-only validation cannot update projection readiness'); }
    });
    assert.equal(await readOnly.ensure(provider, signal()), false);
    await assert.rejects(readOnly.sync(document, document.id, signal()), /Read-only search/);
    if (provider === 'meilisearch') fixture.settings.filterableAttributes = [];
    else fixture.fields = fixture.fields!.filter(field => field.name !== 'price');
    await assert.rejects(readOnly.ensure(provider, signal()), /Read-only search/);
    fixture.removeIndex();
    await assert.rejects(readOnly.ensure(provider, signal()), /Read-only search/);
    assert(fixture.requests.length > 0 && fixture.requests.every(request => request.method === 'GET'));
    checks.push(`${provider}: read-only validation uses GET only, rejects drift/missing index and skips repair/readiness callbacks`);
  }
  for (const provider of ['meilisearch', 'typesense'] as const) {
    const fixture = new Fixture(provider);
    const appliance = fixture.appliance();
    assert.equal(await appliance.sync(document, document.id, signal()), true, 'Initial native index creation must report repair');
    fixture.removeIndex();
    assert.equal(await appliance.sync({ ...document, price: 250000 }, document.id, signal()), true, 'Recreated native index must report repair for projection invalidation');
    assert.equal(fixture.reads(), 2, 'Each source write must revalidate current index/schema');
    assert.equal(fixture.writes.length, 2);
    assert(fixture.writes.every((write) => write.native), 'Removed index must regain native configuration before accepting source documents');
    assert.equal(fixture.writes[1].body.semanticText, document.semanticText);
    assert.equal(await appliance.ensure(provider, signal()), false, 'Unchanged native configuration must not request another backfill');
    checks.push(`${provider}: removal/recreation restores native configuration before source write`);

    fixture.addRemoteEmbedder();
    await assert.rejects(appliance.sync(document, document.id, signal()), /remote embedding API/);
    assert.equal(fixture.writes.length, 2, 'Post-start remote embedder must block document writes');
    // Query callers use the same public guard immediately before native search.
    await assert.rejects((async () => {
      await appliance.ensure(provider, signal());
      await fetch(provider === 'meilisearch' ? 'http://meili.fixture/indexes/houses/search' : 'http://typesense.fixture/collections/houses/documents/search');
    })(), /remote embedding API/);
    assert(!fixture.requests.some((request) => request.path.endsWith('/search')), 'Post-start remote configuration must fail before a guarded native query');
    assert.equal(fixture.reads(), 5, 'Failed checks must also be cleared for the next caller');
    checks.push(`${provider}: post-start remote embedder blocks source writes and guarded queries`);
  }

  const drift = new Fixture('meilisearch');
  const appliance = drift.appliance();
  await appliance.ensure('meilisearch', signal());
  const native = drift.embedders()[MEILI_NATIVE_EMBEDDER];
  const revision = native.revision;
  native.revision = 'unexpected-model-revision';
  await assert.rejects(appliance.sync(document, document.id, signal()), /explicit migration/);
  assert.equal(drift.writes.length, 0);
  native.revision = revision;
  await appliance.ensure('meilisearch', signal());
  drift.failSettingsOnce = true;
  await assert.rejects(appliance.ensure('meilisearch', signal()), /fixture failure/);
  await appliance.ensure('meilisearch', signal());
  assert.equal(drift.reads(), 5);
  checks.push('Changed native revision and transient failures are rechecked without a lifetime cache');

  const concurrent = new Fixture('meilisearch');
  concurrent.pause = { entered: deferred(), release: deferred() };
  const shared = concurrent.appliance();
  const first = shared.ensure('meilisearch', signal());
  await concurrent.pause.entered.promise;
  const second = shared.ensure('meilisearch', signal());
  const canceled = new AbortController();
  const third = shared.ensure('meilisearch', canceled.signal);
  canceled.abort(new Error('fixture canceled'));
  await assert.rejects(third, /fixture canceled/);
  concurrent.pause.release.resolve();
  assert.deepEqual(await Promise.all([first, second]), [true, true], 'Concurrent callers must receive the same repair result');
  assert.equal(concurrent.reads(), 1, 'Concurrent checks may share one in-flight validation');
  concurrent.pause = undefined;
  assert.equal(await shared.ensure('meilisearch', signal()), false);
  assert.equal(concurrent.reads(), 2, 'Completed validation must not be reused by a later caller');
  checks.push('Only concurrent validation is deduplicated; caller abort and later checks remain independent');

  const partial = new Fixture('meilisearch');
  const partialAppliance = partial.appliance();
  partial.failSettingsOnce = true;
  await assert.rejects(partialAppliance.sync(document, document.id, signal()), /fixture failure/);
  assert(partial.indexExists, 'Index creation succeeded before the configuration read failed');
  assert.equal(partial.writes.length, 0, 'Partial setup must not acknowledge a source write');
  assert.equal(await partialAppliance.sync(document, document.id, signal()), true, 'Missing embedding configuration must still report repair on retry');
  checks.push('Index creation followed by setup failure rejects; retry restores native config and reports repair');

  for (const replacement of [{ name: 'title', type: 'int32' }, { name: 'title', type: 'string', index: false }, { name: 'cityFacet', type: 'string', facet: false }, { name: 'price', type: 'int32', sort: false }, { name: 'neighborhood', type: 'string', optional: false }]) {
    const fixture = new Fixture('typesense');
    const appliance = fixture.appliance();
    await appliance.ensure('typesense', signal());
    const offset = fixture.fields!.findIndex((field) => field.name === replacement.name);
    fixture.fields![offset] = replacement;
    const mutations = fixture.requests.filter((request) => request.method !== 'GET').length;
    await assert.rejects(appliance.sync(document, document.id, signal()), /explicit migration/);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.requests.filter((request) => request.method !== 'GET').length, mutations, 'Incompatible existing field must not be dropped or rewritten');
  }
  checks.push('Typesense rejects existing field type, index, facet, sort, and optionality incompatibilities');

  const limited = new Fixture('meilisearch');
  const limitedAppliance = limited.appliance();
  assert.equal(await limitedAppliance.ensure('meilisearch', signal()), true);
  assert.deepEqual(limited.settings.pagination, { maxTotalHits: 1000 }, 'Absent pagination uses the supported default');
  limited.settings.pagination = { maxTotalHits: 100 };
  const settingWrites = limited.requests.filter((request) => request.path.endsWith('/settings') && request.method === 'PATCH').length;
  await assert.rejects(limitedAppliance.sync(document, document.id, signal()), /maxTotalHits must be at least 1000/);
  assert.equal(limited.requests.filter((request) => request.path.endsWith('/settings') && request.method === 'PATCH').length, settingWrites);
  assert.deepEqual(limited.settings.pagination, { maxTotalHits: 100 }, 'Existing lower limit must not be silently increased');
  checks.push('Meili defaults absent pagination and rejects a preserved lower maxTotalHits limit');

  const wildcard = new Fixture('meilisearch');
  const wildcardAppliance = wildcard.appliance();
  assert.equal(await wildcardAppliance.ensure('meilisearch', signal()), true);
  assert.deepEqual(wildcard.settings.searchableAttributes, ['*'], 'Engine canonicalization keeps the default searchable wildcard');
  const wildcardWrites = wildcard.requests.filter((request) => request.path.endsWith('/settings') && request.method === 'PATCH').length;
  for (let pass = 0; pass < 3; pass++) {
    assert.equal(await wildcardAppliance.ensure('meilisearch', signal()), false, 'Canonical wildcard covers required searchable fields without another repair');
    assert.equal(await wildcardAppliance.sync(document, document.id, signal()), false, 'Source writes must not cause repeated repair/backfill with a canonical wildcard');
  }
  assert.equal(wildcard.requests.filter((request) => request.path.endsWith('/settings') && request.method === 'PATCH').length, wildcardWrites, 'Stable wildcard settings must not be rewritten');
  assert(wildcard.writes.every((write) => write.native));
  wildcard.settings.searchableAttributes = ['title'];
  assert.equal(await wildcardAppliance.ensure('meilisearch', signal()), true, 'An explicit searchable list still needs missing fields added');
  assert((wildcard.settings.searchableAttributes as string[]).includes('semanticText'));
  assert.equal(await wildcardAppliance.ensure('meilisearch', signal()), false, 'The repaired explicit list remains stable');
  checks.push('Meili canonical searchable wildcard stays repair-free across repeated native guards and source writes');

  for (const provider of ['meilisearch', 'typesense'] as const) {
    const fixture = new Fixture(provider);
    const appliance = fixture.appliance({
      onRepair: async (actual) => { assert.equal(actual, provider); fixture.events.push('repair persisted'); },
      onReady: async (actual) => { assert.equal(actual, provider); assert(fixture.nativeConfigured()); fixture.events.push('ready validated'); }
    });
    assert.equal(await appliance.ensure(provider, signal()), true);
    if (provider === 'typesense') {
      fixture.fields = fixture.fields!.filter((field) => field.name !== 'neighborhood');
      assert.equal(await appliance.ensure(provider, signal()), true);
    }
    const mutations = provider === 'meilisearch' ? ['POST /indexes', 'PATCH /indexes/houses/settings'] : ['POST /collections', 'PATCH /collections/houses'];
    for (const mutation of mutations) {
      const offset = fixture.events.indexOf(mutation);
      assert(offset > 0);
      assert.equal(fixture.events[offset - 1], 'repair persisted', 'Repair callback must finish before every schema mutation');
    }
    assert.equal(fixture.events.at(-1), 'ready validated', 'Ready callback runs only after native configuration succeeds');

    const blocked = new Fixture(provider);
    const blockedAppliance = blocked.appliance({ onRepair: async () => { throw new Error('repair persistence unavailable'); } });
    await assert.rejects(blockedAppliance.sync(document, document.id, signal()), /repair persistence unavailable/);
    assert(!blocked.indexExists && !blocked.fields, 'Failed repair callback must prevent creation');
    assert.equal(blocked.writes.length, 0);
  }
  checks.push('Repair callbacks precede every native schema mutation and callback failure blocks creation');

  const unconfirmed = new Fixture('meilisearch');
  unconfirmed.indexExists = true;
  unconfirmed.settings = { searchableAttributes: ['*'] };
  let pendingRepair = false;
  let readyCalls = 0;
  const recoveryCallbacks = {
    onRepair: async () => { pendingRepair = true; unconfirmed.events.push('repair persisted'); },
    onReady: async () => { readyCalls++; unconfirmed.events.push('ready validated'); }
  };
  const unconfirmedAppliance = unconfirmed.appliance(recoveryCallbacks);
  unconfirmed.failTaskAfterApplyOnce = true;
  await assert.rejects(unconfirmedAppliance.sync(document, document.id, signal()), /task response lost after apply/);
  assert.equal(pendingRepair, true, 'Repair intent survives an accepted mutation whose task response is lost');
  assert(unconfirmed.nativeConfigured(), 'Engine applied settings despite the lost task response');
  assert.equal(readyCalls, 0);
  assert.equal(unconfirmed.writes.length, 0, 'Unconfirmed setup cannot acknowledge a source write');
  const settingsMutation = unconfirmed.events.indexOf('PATCH /indexes/houses/settings');
  assert.equal(unconfirmed.events[settingsMutation - 1], 'repair persisted');
  // Recreate the adapter to model a process restart; persisted repair intent is external to its memory.
  const restarted = unconfirmed.appliance(recoveryCallbacks);
  assert.equal(await restarted.ensure('meilisearch', signal()), false, 'Recovered valid schema needs no second mutation');
  assert.equal(readyCalls, 1, 'Ready callback must run even when the prior repair is already applied');
  assert.equal(pendingRepair, true, 'The caller can consume the durable repair marker during readiness recovery');
  assert.equal(await restarted.sync(document, document.id, signal()), false);
  assert.equal(unconfirmed.writes.length, 1);
  assert.equal(unconfirmed.events[unconfirmed.events.indexOf('POST /indexes/houses/documents') - 1], 'ready validated', 'Source writes await the recovery callback');
  const readyBlocked = unconfirmed.appliance({ onReady: async () => { throw new Error('readiness recovery unavailable'); } });
  await assert.rejects(readyBlocked.sync(document, document.id, signal()), /readiness recovery unavailable/);
  assert.equal(unconfirmed.writes.length, 1, 'Failed readiness recovery blocks source writes even with valid native settings');
  checks.push('Accepted-but-unconfirmed native setup preserves repair intent across adapter restart and guards later source writes');

  const firstProvider = new Fixture('meilisearch');
  const secondProvider = new Fixture('typesense');
  globalThis.fetch = async (input, init) => new URL(String(input)).host === 'meili.fixture' ? firstProvider.fetch(input, init) : response({ message: 'second provider unavailable' }, 503);
  const mixed = new NativeAppliances({ meiliHost: 'http://meili.fixture', meiliKey: '', typesenseHost: 'http://typesense.fixture', typesenseKey: '', providers: ['meilisearch', 'typesense'] });
  await assert.rejects(mixed.sync(document, document.id, signal()), (error: unknown) => error instanceof Error && (error as Error & { repaired?: boolean }).repaired === true);
  assert.equal(firstProvider.writes.length, 1);
  assert.equal(secondProvider.writes.length, 0);
  checks.push('Repair result survives a later provider failure for projection invalidation');

  console.log('PASS native appliance readiness', checks);
} finally {
  globalThis.fetch = originalFetch;
}
