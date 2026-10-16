import type { Metadata } from 'next';
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
      <a className="brand" href="/" aria-label="Searchlab home"><span className="brand-mark">S</span><span>Searchlab</span></a>
      <nav className="primary-nav" aria-label="Primary"><a className="nav-active" href="/">Search</a><a href="#saved" aria-disabled="true" title="Saved-search migration is outside this foundation">Saved Searches</a><a href="#providers" aria-disabled="true">Providers</a><a href="#system" aria-disabled="true">System</a></nav>
      <span className="account-mark" aria-label="Account">JD</span>
    </header>
      {children}</body>
    </html>
  );
}
