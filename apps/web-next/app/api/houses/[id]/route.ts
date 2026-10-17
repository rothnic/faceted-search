// Read-only bridge to the existing PostgreSQL detail contract. No search or map request.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return Response.json({ error: 'Invalid home ID.' }, { status: 400 });
  const origin = process.env.SEARCH_API_ORIGIN;
  const dataset = process.env.SEARCH_EXPECTED_DATASET_ID;
  const fingerprint = process.env.SEARCH_EXPECTED_DATABASE_FINGERPRINT;
  try {
    if (!origin || !dataset) throw new Error();
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
    const metadata = await fetch(new URL('/api/providers', url), { cache: 'no-store', signal });
    if (!metadata.ok) throw new Error();
    const identity = await metadata.json();
    if (identity.storageMode !== 'postgres' || identity.dataset?.id !== dataset || !/^[a-f0-9]{24}$/.test(identity.dataset?.databaseFingerprint ?? '') || (fingerprint && identity.dataset.databaseFingerprint !== fingerprint)) throw new Error();
    const response = await fetch(new URL(`/api/houses/${encodeURIComponent(id)}`, url), { cache: 'no-store', signal });
    if (response.status === 404) return Response.json({ error: 'This home is no longer available.' }, { status: 404 });
    if (!response.ok) throw new Error();
    const { house } = await response.json();
    if (house?.id !== id || ['title', 'description', 'city', 'propertyType', 'listingStatus'].some((key) => typeof house[key] !== 'string') || ['price', 'bedrooms', 'bathrooms', 'squareFeet', 'lat', 'lng'].some((key) => !Number.isFinite(house[key])) || !Array.isArray(house.amenities) || house.amenities.some((item: unknown) => typeof item !== 'string')) throw new Error();
    const keys = ['id', 'title', 'description', 'addressLine1', 'price', 'bedrooms', 'bathrooms', 'squareFeet', 'lat', 'lng', 'city', 'neighborhood', 'propertyType', 'listingStatus', 'amenities'];
    return Response.json({ house: Object.fromEntries(keys.map((key) => [key, house[key]])), dataset: identity.dataset });
  } catch {
    return Response.json({ error: 'Home details are unavailable. Return to your results or try again.' }, { status: 503 });
  }
}
