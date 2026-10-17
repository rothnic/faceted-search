import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Home unavailable · Searchlab', robots: { index: false, follow: false } };

export default async function HomeUnavailable({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { returnTo } = await searchParams;
  let back = '/search';
  if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    try {
      const url = new URL(returnTo, 'https://searchlab.invalid');
      if (url.origin === 'https://searchlab.invalid' && ['/', '/search'].includes(url.pathname)) back = url.pathname + url.search;
    } catch {}
  }
  return <main className="home-page"><a className="home-back" href={back}><span aria-hidden="true">←</span> Results</a><h1>This home is no longer available</h1><p>Return to search to see matching homes.</p></main>;
}
