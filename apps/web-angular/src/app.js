import './styles.css';
import { app, escapeHtml, state } from './core.js';
import { loadBootstrap, loadSavedSearches, prepareSearchShell, runSearch } from './search-page.js';
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
  if (location.pathname === '/providers') { app.innerHTML = '<section class="panel" role="status">Connecting to the search API…</section>'; await loadBootstrap(); return renderProviders(); }
  if (location.pathname === '/saved-searches') { app.innerHTML = '<section class="panel" role="status">Connecting to the search API…</section>'; await loadBootstrap(); return renderSavedSearches(); }
  if (location.pathname === '/search/instant/typesense' || location.pathname === '/search/instant/meilisearch') {
    app.innerHTML = '<section class="panel" role="status">Connecting to the search API…</section>';
    await loadBootstrap();
    return (await import('./pages/instant.js')).renderInstant(location.pathname.endsWith('typesense') ? 'typesense' : 'meilisearch');
  }
  startStatusPolling();
  prepareSearchShell();
  await loadBootstrap();
  void loadSavedSearches();
  if (!state.isSearching) return runSearch();
}

route().catch((error) => {
  app.innerHTML = `<section class="panel"><h2>Application error</h2><pre>${escapeHtml(error.message)}</pre><button class="btn btn-sm btn-outline" onclick="location.reload()">Retry connection</button></section>`;
});
