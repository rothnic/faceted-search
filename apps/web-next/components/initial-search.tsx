import SearchPage from '@/components/search-page';
import { buildSearchRequest, readSearchState } from '@/lib/search';
import { searchBackend, SearchConnectionError } from '@/lib/search-backend';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function FreshSearch({ searchParams }: { searchParams: SearchParams }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach(item => params.append(key, item));
    else if (value !== undefined) params.set(key, value);
  }
  const request = readSearchState(params);
  try {
    const response = await searchBackend(buildSearchRequest(request));
    return <SearchPage key={params.toString()} initial={{ request, response, error: null }} />;
  } catch (error) {
    return <SearchPage key={params.toString()} initial={{ request, response: null, error: error instanceof SearchConnectionError ? error.message : 'Search is unavailable. Please retry.' }} />;
  }
}

export default function InitialSearch({ searchParams }: { searchParams: SearchParams }) {
  return <FreshSearch searchParams={searchParams} />;
}
