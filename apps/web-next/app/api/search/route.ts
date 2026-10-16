export async function POST(request: Request) {
  let criteria: Record<string, unknown>;
  try {
    criteria = await request.json();
    if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw new Error();
  } catch {
    return Response.json({ error: 'Expected a search criteria object.' }, { status: 400 });
  }

  try {
    const origin = process.env.SEARCH_API_ORIGIN ?? 'http://127.0.0.1:5173';
    const upstream = await fetch(new URL('/api/search', origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(criteria),
      cache: 'no-store',
      signal: request.signal
    });
    const body = await upstream.json();
    if (upstream.ok) {
      // Older APIs ignore these optional flags. Keep unused records off the
      // browser wire; search evaluation, ranking and counts remain upstream.
      if (criteria.includeMap === false) body.mapHits = [];
      if (criteria.mapOnly === true) body.hits = [];
    }
    return Response.json(body, { status: upstream.status });
  } catch {
    return Response.json({ error: 'Search backend unavailable.' }, { status: 503 });
  }
}
