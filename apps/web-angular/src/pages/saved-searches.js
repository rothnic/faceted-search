import { api, app, escapeHtml, savedSearchCountLabel } from '../core.js';

export async function renderSavedSearches() {
  const data = await api('/api/saved-searches');
  app.innerHTML = `
    <section class="panel">
      <h2>Saved Searches</h2>
      <p class="stats">Saved criteria are kept even when the current hit count is zero.</p>
      <div class="saved-list">
        ${data.savedSearches.map((search) => `
          <article class="saved-row">
            <h3>${escapeHtml(search.name)}</h3>
            <div class="meta">
              <span>${search.provider}</span>
              <span>${search.lastEvaluatedAt ? `${savedSearchCountLabel(search)} current hits` : 'Not evaluated yet'}</span>
              <span>${search.newMatchesSinceLastEvaluation} new matches</span>
              <span>${search.lastEvaluatedAt ? `Evaluated ${new Date(search.lastEvaluatedAt).toLocaleString()}` : 'Never evaluated'}</span>
            </div>
            ${search.evaluationError ? `<p class="notice error">Count unavailable: ${escapeHtml(search.evaluationError)}</p>` : ''}
            <pre>${escapeHtml(JSON.stringify(search.criteria, null, 2))}</pre>
            <div class="action-row">
              <a class="button-link" href="/search?savedSearchId=${encodeURIComponent(search.id)}">Apply</a>
              <button class="btn btn-sm btn-outline" data-evaluate="${search.id}">Evaluate now</button>
            </div>
          </article>
        `).join('') || '<p>No saved searches yet.</p>'}
      </div>
    </section>
  `;
  document.querySelectorAll('[data-evaluate]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/saved-searches/${button.dataset.evaluate}/evaluate`, { method: 'POST', body: '{}' });
      await renderSavedSearches();
    } catch (error) {
      const message = document.createElement('p'); message.className = 'notice error'; message.setAttribute('role', 'alert'); message.textContent = error.message; button.closest('.saved-row').append(message); button.disabled = false;
    }
  }));
}
