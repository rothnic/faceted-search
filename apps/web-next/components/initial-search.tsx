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
  const criteriaKey = JSON.stringify(request);
  try {
    const response = await searchBackend(buildSearchRequest(request));
    const dataset = response.provenance?.dataset;
    // UI-only home/view history keeps the live feed; changed criteria or data resets it.
    const stateKey = JSON.stringify([criteriaKey, dataset?.id, dataset?.databaseFingerprint, dataset?.revision]);
    return <SearchPage key={stateKey} initial={{ request, response, error: null }} />;
  } catch (error) {
    return <SearchPage key={`${criteriaKey}:unavailable`} initial={{ request, response: null, error: error instanceof SearchConnectionError ? error.message : 'Search is unavailable. Please retry.' }} />;
  }
}

export default function InitialSearch({ searchParams }: { searchParams: SearchParams }) {
  return <FreshSearch searchParams={searchParams} />;
}
