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
