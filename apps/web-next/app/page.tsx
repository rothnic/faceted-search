import InitialSearch, { type SearchParams } from '@/components/initial-search';

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <InitialSearch searchParams={searchParams} />;
}
