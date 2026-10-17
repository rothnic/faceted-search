import { validateBackendResponse } from '@/lib/backend';
export async function POST(request: Request) {
  let criteria: Record<string, unknown>;
  try {
    criteria = await request.json();
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw new Error();
    if (criteria.mode !== undefined && !['keyword', 'semantic', 'hybrid'].includes(String(criteria.mode))) throw new Error();
    if (criteria.q !== undefined && typeof criteria.q !== 'string') throw new Error();
    if (!['postgres_native', 'pg_search', 'meilisearch', 'typesense'].includes(String(criteria.provider))) throw new Error();
  } catch {
    return Response.json({ error: 'Select an explicit supported backend and valid search criteria.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const origin = process.env.SEARCH_API_ORIGIN;
  const expectedDataset = process.env.SEARCH_EXPECTED_DATASET_ID;
  try {
    if (!origin || !expectedDataset) throw new Error();
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
  } catch {
    return Response.json({ error: 'Search connection is not configured. Set SEARCH_API_ORIGIN and SEARCH_EXPECTED_DATASET_ID.', code: 'BACKEND_NOT_CONFIGURED' }, { status: 503 });
  }
  const started = performance.now();
  try {
    const upstream = await fetch(new URL('/api/search', origin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(criteria), cache: 'no-store',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)])
    });
    if (!upstream.ok) return Response.json({
      error: upstream.status === 400 ? 'Selected backend rejected the search criteria.' : 'Selected backend is unavailable. No fallback was used.',
      code: upstream.status === 400 ? 'INVALID_REQUEST' : 'BACKEND_UNAVAILABLE', selectedProvider: criteria.provider
    }, { status: upstream.status === 400 ? 400 : 503 });
    const body = await upstream.json();
    if (!validateBackendResponse(body, String(criteria.provider), expectedDataset!, process.env.SEARCH_EXPECTED_DATABASE_FINGERPRINT, String(criteria.mode ?? 'keyword'), String(criteria.q ?? ''))) {
      return Response.json({ error: 'Backend identity could not be verified for the selected provider and dataset. No results were accepted.', code: 'BACKEND_IDENTITY_MISMATCH', selectedProvider: criteria.provider }, { status: 503 });
    }
    if (criteria.includeMap === false) body.mapHits = [];
    if (criteria.mapOnly === true) body.hits = [];
    return Response.json({ ...body, gatewayTimingMs: Number((performance.now() - started).toFixed(1)) });
  } catch {
    return Response.json({ error: 'Selected backend is unavailable. No fallback was used.', code: 'BACKEND_UNAVAILABLE', selectedProvider: criteria.provider }, { status: 503 });
  }
}
