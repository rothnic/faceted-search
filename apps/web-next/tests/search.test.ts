import { describe, expect, test } from 'bun:test';
import {
  activeFilterCount,
  buildSearchRequest,
  createLatestSearch,
  emptySearchState,
  type SearchRequest,
  type TimerPort
} from '../lib/search';

class ManualTimers implements TimerPort {
  private nextId = 0;
  callbacks = new Map<number, () => void>();
  setTimeout(callback: () => void, _delayMs: number) { const id = ++this.nextId; this.callbacks.set(id, callback); return id; }
  clearTimeout(id: unknown) { this.callbacks.delete(id as number); }
  fireAll() { const callbacks = [...this.callbacks.values()]; this.callbacks.clear(); callbacks.forEach((callback) => callback()); }
}

function request(q: string): SearchRequest {
  return buildSearchRequest({ ...emptySearchState(), q });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('Searchlab search state', () => {
  test('keeps filter values backend-shaped and omits empty filter arrays', () => {
    const state = emptySearchState();
    state.q = 'garage';
    state.filters = { bedrooms: [3], amenities: ['garage'], city: [] };
    const body = buildSearchRequest(state);
    expect(body).toMatchObject({ provider: 'postgres_native', mode: 'keyword', q: 'garage', page: 1, pageSize: 18, includeFacets: true, includeMap: false, mapOnly: false });
    expect(body.filters).toEqual({ bedrooms: [3], amenities: ['garage'] });
  });

  test('counts selected values and range criteria without counting query text', () => {
    expect(activeFilterCount({ bedrooms: [3, 4], amenities: ['garage'], minPrice: 250000 })).toBe(4);
  });

  test('debounces replacement input, aborts in-flight work and suppresses stale results', async () => {
    const timers = new ManualTimers();
    const first = deferred<string>();
    const second = deferred<string>();
    const signals: AbortSignal[] = [];
    const calls: string[] = [];
    const search = createLatestSearch(async (body, signal) => {
      calls.push(body.q);
      signals.push(signal);
      return body.q === 'old' ? first.promise : second.promise;
    }, 180, timers);
    const results: string[] = [];
    const callbacks = { onSuccess: (value: string) => results.push(value), onError: (error: unknown) => { throw error; } };

    search.schedule(request('discarded'), callbacks);
    search.schedule(request('old'), callbacks);
    timers.fireAll();
    expect(calls).toEqual(['old']);
    search.schedule(request('newest'), callbacks);
    expect(signals[0].aborted).toBe(true);
    timers.fireAll();
    expect(calls).toEqual(['old', 'newest']);
    first.resolve('stale');
    await Promise.resolve();
    expect(results).toEqual([]);
    second.resolve('current');
    await Promise.resolve();
    await Promise.resolve();
    expect(results).toEqual(['current']);
    search.cancel();
  });
});

// Boundary fixtures exist only in this test, never in the application runtime.
import { validateBackendResponse } from '../lib/backend';
import { requireRealRuntime } from '../../api/src/runtime-config';
test('production requires explicit connected configuration and rejects removed demo mode', () => {
  expect(() => requireRealRuntime({})).toThrow('DATABASE_URL');
  expect(() => requireRealRuntime({ DEMO_MEMORY: '1' })).toThrow('DEMO_MEMORY was removed');
  expect(() => requireRealRuntime({ DATABASE_URL: 'postgresql://localhost/any' })).toThrow('DATASET_ID');
});
test('gateway rejects missing, wrong provider, wrong dataset and wrong execution provenance', () => {
  const body = {
    provider: 'postgres_native', hits: [], mapHits: [], totalHits: 0,
    provenance: { selectedProvider: 'postgres_native', respondingProvider: 'postgres_native',
      storage: 'postgres', execution: 'postgres-fts',
      dataset: { id: 'test-db', databaseFingerprint: 'a'.repeat(24), revision: 'b'.repeat(32), count: 126,
        countSource: 'postgres-active-houses', observedAt: new Date().toISOString() },
      observedAt: new Date().toISOString(), timing: { apiMs: 3, searchMs: 2, source: 'api-monotonic-clock' } }
  };
  const validate = (value: unknown, provider = 'postgres_native', dataset = 'test-db', mode = 'keyword') =>
    validateBackendResponse(value, provider, dataset, undefined, mode, 'garage');
  expect(validate(body)).toBe(true);
  expect(validate({ ...body, provenance: undefined })).toBe(false);
  expect(validate(body, 'meilisearch')).toBe(false);
  expect(validate(body, 'postgres_native', 'other')).toBe(false);
  expect(validate(body, 'postgres_native', 'test-db', 'semantic')).toBe(false);
  expect(validate({ ...body, provenance: { ...body.provenance, respondingProvider: 'typesense' } })).toBe(false);
});

import { publicDiagnostics } from '../../api/src/public-diagnostics';
test('public diagnostics retain operational counts and redact nested upstream failures', () => {
  const raw = { queue: { failed: 2 }, lastError: 'synthetic-secret-marker', providers: { meili: { lastSyncError: 'synthetic-secret-marker' } },
    recentFailures: [{ error: 'synthetic-secret-marker', attempts: 3 }], outbox: [{ error: null }] };
  const visible = publicDiagnostics(raw);
  expect(JSON.stringify(visible)).not.toContain('synthetic-secret-marker');
  expect(visible).toMatchObject({ queue: { failed: 2 }, recentFailures: [{ attempts: 3 }], outbox: [{ error: null }] });
});
