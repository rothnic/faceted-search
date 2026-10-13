import { api, app, escapeHtml as e } from '../core.js';
import { storageLabel } from '../system-status.js';

export async function renderSchema() {
  app.innerHTML = `<section class="page-heading"><div><span class="eyebrow">Data model</span><h1>Schema explorer</h1><p>Inspect tables, fields, relationships and declared indexes.</p></div><a href="/system">System status →</a></section><div id="schema-content" role="status">Loading declared schema…</div>`;
  const content = document.querySelector('#schema-content');
  try {
    const schema = await api('/api/schema');
    content.removeAttribute('role');
    content.innerHTML = `<section class="panel"><div class="action-row"><span class="status-badge">${e(storageLabel(schema.storageMode))}</span><span class="status-badge">Application DDL · not live introspection</span></div>
      <p class="notice">${e(schema.note)}</p>
      <p class="stats">Generated from the same SQL used to initialize PostgreSQL. No database rows, credentials or connection strings are shown.</p>
      <div class="field"><label for="schema-filter">Find a table or field</label><input class="input input-sm" type="search" id="schema-filter" placeholder="houses, city_id, jsonb…" /></div>
      <p id="schema-count" class="stats" role="status"></p><div id="schema-tables"></div></section>`;
    const draw = () => {
      const query = document.querySelector('#schema-filter').value.trim().toLowerCase();
      const tables = schema.tables.filter((table) => `${table.name} ${table.ddl} ${JSON.stringify(table.indexes)}`.toLowerCase().includes(query));
      document.querySelector('#schema-count').textContent = `${tables.length} of ${schema.tables.length} declared tables`;
      document.querySelector('#schema-tables').innerHTML = tables.map((table) => `<details class="schema-table" ${query || table.name === 'houses' ? 'open' : ''}><summary><strong>${e(table.name)}</strong><span>${table.columns.length} fields · ${table.indexes.length} explicit indexes</span></summary>
        <div class="table-scroll" tabindex="0" role="region" aria-label="${e(table.name)} columns"><table class="matrix"><caption class="sr-only">${e(table.name)} declared fields</caption><thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Nullable</th><th scope="col">Key / relationship</th></tr></thead><tbody>
        ${table.columns.map((column) => `<tr><th scope="row">${e(column.name)}</th><td>${e(column.type)}</td><td>${column.nullable ? 'Yes' : 'No'}</td><td>${column.primaryKey ? '<span class="status-badge">Primary key</span>' : ''}${column.reference ? ` → ${e(column.reference)}` : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${table.constraints.length ? `<h3>Table constraints</h3><ul>${table.constraints.map((constraint) => `<li>${e(constraint)}</li>`).join('')}</ul>` : ''}
        <h3>Explicit indexes</h3>${table.indexes.length ? `<ul>${table.indexes.map((index) => `<li><strong>${e(index.name)}</strong> (${e(index.columns)})</li>`).join('')}</ul>` : '<p class="stats">No additional CREATE INDEX declarations. Primary keys may create implicit indexes.</p>'}
        <details><summary>Exact CREATE TABLE statement</summary><pre>${e(table.ddl)}</pre></details></details>`).join('') || '<p class="empty-state">No declared table or field matches. Try a shorter name.</p>';
    };
    document.querySelector('#schema-filter').addEventListener('input', draw);
    draw();
  } catch (error) { content.innerHTML = `<p class="notice error" role="alert">Schema unavailable: ${e(error.message)}</p><button class="btn btn-sm btn-outline" id="retry-schema">Retry schema</button>`; document.querySelector('#retry-schema').onclick = renderSchema; }
}
