import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Searchlab',
  description: 'Search listings with shared filters, map and results views.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
    <header className="global-header">
      <Link className="brand" href="/" aria-label="Searchlab home"><span className="brand-mark">S</span><span>Searchlab</span></Link>
      <nav className="primary-nav" aria-label="Primary"><Link className="nav-active" href="/">Search</Link><a href="#saved" aria-disabled="true" title="Saved-search migration is outside this foundation">Saved Searches</a><a href="#providers" aria-disabled="true">Providers</a><a href="#system" aria-disabled="true">System</a></nav>
      <span className="account-mark" aria-label="Account">JD</span>
    </header>
      {children}</body>
    </html>
  );
}
