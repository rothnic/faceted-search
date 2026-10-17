import { app, escapeHtml } from '../core.js';
export async function renderInstant(providerId) {
  app.innerHTML = '<section class="panel"><h1>Direct adapter unavailable</h1><p>Direct browser adapters have no verified backend or dataset configuration. Use the connected Search page to select ' + escapeHtml(providerId) + ' and inspect its response provenance.</p><a href="/search">Open Search</a></section>';
}
