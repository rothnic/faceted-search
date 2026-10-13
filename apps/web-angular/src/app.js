import 'leaflet/dist/leaflet.css';
import './styles.css';
import { app, escapeHtml } from './core.js';
import { loadBootstrap, loadSavedSearches, runSearch } from './search-page.js';
import { renderProviders } from './pages/providers.js';
import { renderSystem } from './pages/system.js';
import { renderSchema } from './pages/schema.js';
import { startStatusPolling } from './system-status.js';
import { renderSavedSearches } from './pages/saved-searches.js';

async function route() {
  document.querySelectorAll('nav a').forEach((link) => {
    if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page');
  });
  if (location.pathname === '/schema') return renderSchema();
  if (location.pathname === '/system') return renderSystem();
  app.innerHTML = '<section class="panel" role="status">Connecting to the search API…</section>';
  await loadBootstrap();
  if (location.pathname === '/providers') return renderProviders();
  if (location.pathname === '/saved-searches') return renderSavedSearches();
  if (location.pathname === '/search/instant/typesense') return (await import('./pages/instant.js')).renderInstant('typesense');
  if (location.pathname === '/search/instant/meilisearch') return (await import('./pages/instant.js')).renderInstant('meilisearch');
  startStatusPolling();
  void loadSavedSearches();
  return runSearch();
}

route().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Application error</h2><pre>${escapeHtml(error.message)}</pre><button onclick="location.reload()">Retry connection</button></section>`;
});
