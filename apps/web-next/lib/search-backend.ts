import 'server-only';
import { validateBackendResponse } from '@/lib/backend';
import type { SearchResponse } from '@/lib/search';

export class SearchConnectionError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

export async function searchBackend(criteria: Record<string, unknown>, signal?: AbortSignal): Promise<SearchResponse> {
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria) ||
    (criteria.mode !== undefined && !['keyword', 'semantic', 'hybrid'].includes(String(criteria.mode))) ||
    (criteria.q !== undefined && typeof criteria.q !== 'string') ||
    !['postgres_native', 'pg_search', 'meilisearch', 'typesense'].includes(String(criteria.provider))) {
    throw new SearchConnectionError('Select an explicit supported backend and valid search criteria.', 'INVALID_REQUEST', 400);
  }
  const origin = process.env.SEARCH_API_ORIGIN;
  const expectedDataset = process.env.SEARCH_EXPECTED_DATASET_ID;
  try {
    if (!origin || !expectedDataset) throw new Error();
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch {
    throw new SearchConnectionError('Search connection is not configured. Set SEARCH_API_ORIGIN and SEARCH_EXPECTED_DATASET_ID.', 'BACKEND_NOT_CONFIGURED', 503);
  }
  const started = performance.now();
  try {
    const upstream = await fetch(new URL('/api/search', origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(criteria), cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
    });
    if (!upstream.ok) throw new SearchConnectionError(
      upstream.status === 400 ? 'Selected backend rejected the search criteria.' : 'Selected backend is unavailable. No fallback was used.',
      upstream.status === 400 ? 'INVALID_REQUEST' : 'BACKEND_UNAVAILABLE', upstream.status === 400 ? 400 : 503
    );
    const body = await upstream.json();
    if (!validateBackendResponse(body, String(criteria.provider), expectedDataset!, process.env.SEARCH_EXPECTED_DATABASE_FINGERPRINT, String(criteria.mode ?? 'keyword'), String(criteria.q ?? ''))) {
      throw new SearchConnectionError('Backend identity could not be verified for the selected provider and dataset. No results were accepted.', 'BACKEND_IDENTITY_MISMATCH', 503);
    }
    if (criteria.includeMap === false) body.mapHits = [];
    if (criteria.mapOnly === true) body.hits = [];
    return { ...body, gatewayTimingMs: Number((performance.now() - started).toFixed(1)) };
  } catch (error) {
    if (error instanceof SearchConnectionError) throw error;
    throw new SearchConnectionError('Selected backend is unavailable. No fallback was used.', 'BACKEND_UNAVAILABLE', 503);
  }
}
