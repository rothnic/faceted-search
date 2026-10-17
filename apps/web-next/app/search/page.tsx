import InitialSearch, { type SearchParams } from '@/components/initial-search';

export default function SearchRoute({ searchParams }: { searchParams: SearchParams }) {
  return <InitialSearch searchParams={searchParams} />;
}
