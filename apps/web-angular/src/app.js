import 'leaflet/dist/leaflet.css';
import './styles.css';
import { app } from './core.js';
import { loadBootstrap, loadSavedSearches, runSearch } from './search-page.js';
import { renderInstant } from './pages/instant.js';
import { renderProviders } from './pages/providers.js';
import { renderSavedSearches } from './pages/saved-searches.js';

async function route() {
  await loadBootstrap();
  await loadSavedSearches();
  if (location.pathname === '/providers') return renderProviders();
  if (location.pathname === '/saved-searches') return renderSavedSearches();
  if (location.pathname === '/search/instant/typesense') return renderInstant('typesense');
  if (location.pathname === '/search/instant/meilisearch') return renderInstant('meilisearch');
  return runSearch();
}

route().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Application error</h2><pre>${error.stack || error.message}</pre></section>`;
});
