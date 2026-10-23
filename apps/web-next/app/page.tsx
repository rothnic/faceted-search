import InitialSearch, { generateSearchMetadata, type SearchParams } from '@/components/initial-search';

export const generateMetadata = generateSearchMetadata;

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <InitialSearch searchParams={searchParams} />;
}
