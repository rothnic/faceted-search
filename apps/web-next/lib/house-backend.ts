import 'server-only';
import type { SearchHit } from '@/lib/search';

export class HouseReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readHouse(id: string, signal?: AbortSignal): Promise<{ house: SearchHit; dataset: Record<string, unknown> }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new HouseReadError('Invalid home ID.', 400);
  const origin = process.env.SEARCH_API_ORIGIN;
  const dataset = process.env.SEARCH_EXPECTED_DATASET_ID;
  const fingerprint = process.env.SEARCH_EXPECTED_DATABASE_FINGERPRINT;
  try {
    if (!origin || !dataset) throw new Error();
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    const timeout = AbortSignal.timeout(10_000);
    const active = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const metadata = await fetch(new URL('/api/providers', url), { cache: 'no-store', signal: active });
    if (!metadata.ok) throw new Error();
    const identity = await metadata.json();
    if (identity.storageMode !== 'postgres' || identity.dataset?.id !== dataset || !/^[a-f0-9]{24}$/.test(identity.dataset?.databaseFingerprint ?? '') || (fingerprint && identity.dataset.databaseFingerprint !== fingerprint)) throw new Error();
    const response = await fetch(new URL(`/api/houses/${encodeURIComponent(id)}`, url), { cache: 'no-store', signal: active });
    if (response.status === 404) throw new HouseReadError('This home is no longer available.', 404);
    if (!response.ok) throw new Error();
    const { house } = await response.json();
    if (house?.id !== id || ['title', 'description', 'city', 'propertyType', 'listingStatus'].some(key => typeof house[key] !== 'string') || ['price', 'bedrooms', 'bathrooms', 'squareFeet', 'lat', 'lng'].some(key => !Number.isFinite(house[key])) || !Array.isArray(house.amenities) || house.amenities.some((item: unknown) => typeof item !== 'string')) throw new Error();
    const keys = ['id', 'title', 'description', 'addressLine1', 'price', 'bedrooms', 'bathrooms', 'squareFeet', 'lat', 'lng', 'city', 'neighborhood', 'propertyType', 'listingStatus', 'amenities'];
    return { house: Object.fromEntries(keys.map(key => [key, house[key]])) as SearchHit, dataset: identity.dataset };
  } catch (error) {
    if (error instanceof HouseReadError) throw error;
    throw new HouseReadError('Home details are unavailable. Return to your results or try again.', 503);
  }
}
