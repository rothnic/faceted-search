import { app, label, state } from '../core.js';

export function renderProviders() {
  const capabilityNames = ['keywordSearch', 'faceting', 'rangeFacets', 'geoRadius', 'geoSort', 'semanticSearch', 'hybridSearch', 'instantSearchDirectAdapter', 'requiresExternalSync', 'supportsSavedSearchEvaluation'];
  app.innerHTML = `
    <section class="panel">
      <h2>Provider Comparison</h2>
      <table class="matrix">
        <thead>
          <tr><th>Capability</th>${state.providers.map((item) => `<th>${item.label}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${capabilityNames.map((name) => `
            <tr>
              <th>${label(name)}</th>
              ${state.providers.map((item) => `<td>${String(item.capabilities[name])}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
    <section class="grid-two" style="margin-top:14px">
      ${state.providers.map((item) => `
        <article class="panel">
          <h3>${item.label}</h3>
          <p><strong>Sync requirements:</strong> ${item.syncRequirements}</p>
          <p><strong>Setup notes:</strong> ${item.setupNotes.join('; ')}</p>
          <p><strong>Schema/index requirements:</strong> ${item.schemaRequirements.join('; ')}</p>
          <p><strong>Known limitations:</strong> ${item.knownLimitations.join('; ')}</p>
        </article>
      `).join('')}
    </section>
  `;
}
