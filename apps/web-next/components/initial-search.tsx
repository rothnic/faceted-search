import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SearchPage from '@/components/search-page';
import { buildSearchRequest, buildSearchUrl, readSearchState } from '@/lib/search';
import { searchBackend, SearchConnectionError } from '@/lib/search-backend';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function toUrlSearchParams(searchParams: SearchParams) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  return params;
}

async function canonicalOrigin() {
  const configured = process.env.SEARCHLAB_SITE_URL;
  if (configured) {
    try {
      const url = new URL(configured);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.origin;
    } catch { /* Use the request origin when no valid public origin is configured. */ }
  }

  const requestHeaders = await headers();
  const host = (requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'))?.split(',')[0].trim();
  if (!host) return undefined;
  const forwardedProtocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase();
  const protocol = forwardedProtocol === 'http' ? 'http' : 'https';
  try {
    const url = new URL(`${protocol}://${host}`);
    if (url.username || url.password || url.pathname !== '/') return undefined;
    return url.origin;
  } catch { return undefined; }
}

export async function generateSearchMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const state = readSearchState(await toUrlSearchParams(searchParams));
  const query = state.q.trim().replace(/\s+/g, ' ');
  const subject = query ? `Homes matching ${query}` : 'Homes for sale';
  const title = `${subject}${state.page > 1 ? ` · Page ${state.page}` : ''} | Searchlab`;
  const description = `${query ? `Browse homes matching ${query}.` : 'Browse available homes and refine results by location, price, bedrooms, and amenities.'}${state.page > 1 ? ` Page ${state.page} of the search results.` : ''}`.slice(0, 160);
  const origin = await canonicalOrigin();
  const canonical = origin ? new URL(buildSearchUrl(state), origin).toString() : undefined;

  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    robots: { index: true, follow: true },
    openGraph: { title, description, type: 'website', url: canonical }
  };
}

async function FreshSearch({ searchParams }: { searchParams: SearchParams }) {
  const params = await toUrlSearchParams(searchParams);
  const request = readSearchState(params);
  const criteriaKey = JSON.stringify(request);
  let response: Awaited<ReturnType<typeof searchBackend>>;
  try {
    response = await searchBackend(buildSearchRequest(request));
  } catch (error) {
    return <SearchPage key={`${criteriaKey}:unavailable`} initial={{ request, response: null, error: error instanceof SearchConnectionError ? error.message : 'Search is unavailable. Please retry.' }} />;
  }
  const lastPage = Math.max(1, Math.ceil(response.totalHits / response.pageSize));
  if (request.page > lastPage) redirect(buildSearchUrl(request, lastPage));
  const dataset = response.provenance?.dataset;
  // UI-only home/view history keeps the live feed; changed criteria or data resets it.
  const stateKey = JSON.stringify([criteriaKey, dataset?.id, dataset?.databaseFingerprint, dataset?.revision]);
  return <SearchPage key={stateKey} initial={{ request, response, error: null }} />;
}

export default function InitialSearch({ searchParams }: { searchParams: SearchParams }) {
  return <FreshSearch searchParams={searchParams} />;
}
