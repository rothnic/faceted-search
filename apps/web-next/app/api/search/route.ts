import { searchBackend, SearchConnectionError } from '@/lib/search-backend';

export async function POST(request: Request) {
  let criteria: Record<string, unknown>;
  try { criteria = await request.json(); }
  catch { return Response.json({ error: 'Select an explicit supported backend and valid search criteria.', code: 'INVALID_REQUEST' }, { status: 400 }); }
  try {
    return Response.json(await searchBackend(criteria, request.signal));
  } catch (error) {
    const failure = error instanceof SearchConnectionError ? error : new SearchConnectionError('Selected backend is unavailable. No fallback was used.', 'BACKEND_UNAVAILABLE', 503);
    return Response.json({ error: failure.message, code: failure.code, selectedProvider: criteria?.provider }, { status: failure.status });
  }
}
