import { HouseReadError, readHouse } from '@/lib/house-backend';
import { redirect } from 'next/navigation';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

function safeReturn(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/search';
  try {
    const url = new URL(value, 'https://searchlab.invalid');
    return url.origin === 'https://searchlab.invalid' && ['/', '/search'].includes(url.pathname) ? url.pathname + url.search : '/search';
  } catch { return '/search'; }
}

export default async function HomePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const back = <a className="home-back" href={safeReturn(query.returnTo)}><span aria-hidden="true">←</span> Results</a>;
  try {
    const { house } = await readHouse(id);
    return <main className="home-page">
      {back}
      <p className="detail-price">{money(house.price)} <span className="status-badge">{label(house.listingStatus)}</span></p>
      <h1>{house.title}</h1><p>{house.city}{house.neighborhood ? ` · ${house.neighborhood}` : ''}</p>
      <dl className="home-page-facts"><div><dt>Bedrooms</dt><dd>{house.bedrooms}</dd></div><div><dt>Bathrooms</dt><dd>{house.bathrooms}</dd></div><div><dt>Living area</dt><dd>{house.squareFeet.toLocaleString()} sqft</dd></div><div><dt>Home type</dt><dd>{label(house.propertyType)}</dd></div></dl>
      <h2>About this home</h2><p className="home-page-description">{house.description}</p>
      {house.amenities.length > 0 && <><h2>Features</h2><ul>{house.amenities.map(amenity => <li key={amenity}>{label(amenity)}</li>)}</ul></>}
    </main>;
  } catch (error) {
    if (error instanceof HouseReadError && [400, 404].includes(error.status)) redirect('/homes/unavailable?returnTo=' + encodeURIComponent(safeReturn(query.returnTo)));
    return <main className="home-page">{back}<h1>Home details</h1><p role="alert">{error instanceof HouseReadError ? error.message : 'Home details are unavailable.'}</p></main>;
  }
}
