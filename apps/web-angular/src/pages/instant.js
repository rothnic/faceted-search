import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import {
  clearRefinements,
  configure,
  currentRefinements,
  hits,
  pagination,
  rangeInput,
  refinementList,
  searchBox,
  stats
} from 'instantsearch.js/es/widgets';
import { app, currency, escapeHtml, label } from '../core.js';

const instantFacetAttributes = ['cityFacet', 'neighborhoodFacet', 'schoolDistrictFacet', 'propertyTypeFacet', 'bedrooms', 'amenities', 'listingStatusFacet'];

function directInstantSearchClient(providerId) {
  if (providerId === 'typesense') {
    const adapter = new TypesenseInstantSearchAdapter({
      server: {
        apiKey: 'dev_typesense_api_key',
        nodes: [{ host: '127.0.0.1', port: 8108, protocol: 'http' }]
      },
      additionalSearchParameters: {
        query_by: 'title,description,semanticText,city,neighborhood,schoolDistrict,amenities,tags',
        facet_by: instantFacetAttributes.join(','),
        max_facet_values: 20
      }
    });
    return adapter.searchClient;
  }

  return instantMeiliSearch('http://127.0.0.1:7700', 'dev_meili_master_key', {
    finitePagination: true,
    primaryKey: 'id',
    meiliSearchParams: {
      facets: instantFacetAttributes,
      attributesToRetrieve: ['*']
    }
  }).searchClient;
}

function instantResultTemplate(hit) {
  const amenities = Array.isArray(hit.amenities) ? hit.amenities : [];
  return `
    <article class="result instant-hit" data-house-id="${escapeHtml(hit.id)}">
      <h3>${escapeHtml(hit.title)}</h3>
      <div class="meta">
        <span>${currency(hit.price || 0)}</span>
        <span>${escapeHtml(hit.bedrooms)} bd</span>
        <span>${escapeHtml(hit.bathrooms)} ba</span>
        <span>${Number(hit.squareFeet || 0).toLocaleString()} sqft</span>
        <span>${escapeHtml(hit.city)}${hit.neighborhood ? `, ${escapeHtml(hit.neighborhood)}` : ''}</span>
        <span>${escapeHtml(hit.schoolDistrict || '')}</span>
        <span>${label(hit.listingStatus)}</span>
      </div>
      <p>${escapeHtml(hit.description)}</p>
      <div class="amenities">${amenities.map((item) => `<span class="pill">${label(item)}</span>`).join('')}</div>
    </article>
  `;
}

export async function renderInstant(providerId) {
  const title = providerId === 'typesense' ? 'Typesense InstantSearch Demo' : 'Meilisearch InstantSearch Demo';
  const adapterLabel = providerId === 'typesense' ? 'typesense-instantsearch-adapter' : '@meilisearch/instant-meilisearch';
  app.innerHTML = `
    <section class="instant-shell" data-instant-provider="${providerId}">
      <div class="results-head">
        <div>
          <h2>${title}</h2>
          <p class="stats">Bundled with Vite using InstantSearch.js widgets and ${adapterLabel}: searchBox, refinementList, rangeInput, currentRefinements, clearRefinements, hits, stats, and pagination.</p>
        </div>
      </div>
      <p class="notice">This page connects directly to a separate local ${providerId === 'typesense' ? 'Typesense server on port 8108' : 'Meilisearch server on port 7700'}. It does not use the in-memory fallback or local CPU semantic runtime.</p>
      <div id="instant-feedback" role="status">Connecting to the search engine…</div>
      <div class="instant-grid">
        <aside class="panel instant-panel">
          <div id="instant-searchbox"></div>
          <div id="instant-current-refinements"></div>
          <div id="instant-clear-refinements"></div>
          <h3>Facets</h3>
          <strong>City</strong>
          <div id="instant-city"></div>
          <strong>Property type</strong>
          <div id="instant-property-type"></div>
          <strong>Amenities</strong>
          <div id="instant-amenities"></div>
          <strong>Listing status</strong>
          <div id="instant-listing-status"></div>
          <h3>Ranges</h3>
          <strong>Price</strong>
          <div id="instant-price"></div>
          <strong>Square feet</strong>
          <div id="instant-square-feet"></div>
        </aside>
        <div>
          <section class="panel">
            <div id="instant-stats"></div>
            <div id="instant-hits"></div>
            <div id="instant-pagination"></div>
          </section>
        </div>
      </div>
    </section>
  `;

  const search = instantsearch({
    indexName: 'houses',
    searchClient: directInstantSearchClient(providerId),
    routing: false
  });

  search.addWidgets([
    configure({ hitsPerPage: 12 }),
    searchBox({
      container: '#instant-searchbox',
      placeholder: 'hampton cove garage',
      autofocus: true,
      showReset: true,
      showSubmit: true
    }),
    currentRefinements({ container: '#instant-current-refinements' }),
    clearRefinements({ container: '#instant-clear-refinements' }),
    refinementList({ container: '#instant-city', attribute: 'cityFacet', limit: 8 }),
    refinementList({ container: '#instant-property-type', attribute: 'propertyTypeFacet', limit: 8 }),
    refinementList({ container: '#instant-amenities', attribute: 'amenities', limit: 8 }),
    refinementList({ container: '#instant-listing-status', attribute: 'listingStatusFacet', limit: 8 }),
    rangeInput({ container: '#instant-price', attribute: 'price' }),
    rangeInput({ container: '#instant-square-feet', attribute: 'squareFeet' }),
    stats({ container: '#instant-stats' }),
    hits({
      container: '#instant-hits',
      templates: {
        item: instantResultTemplate,
        empty: '<p>No listings match this direct adapter search.</p>'
      }
    }),
    pagination({ container: '#instant-pagination' })
  ]);
  const feedback = document.querySelector('#instant-feedback');
  search.on('error', (error) => {
    feedback.setAttribute('role', 'alert');
    feedback.innerHTML = `<p class="notice error">Direct search engine unavailable: ${escapeHtml(error.message || 'Connection failed')}. Start and backfill the real service, then retry.</p><button id="retry-instant">Retry direct search</button> <a href="/search?mode=keyword">Use the main search</a>`;
    document.querySelector('#retry-instant').onclick = () => { feedback.setAttribute('role', 'status'); feedback.textContent = 'Retrying direct search…'; search.refresh(); };
  });
  search.on('render', () => {
    if (search.status === 'idle') { feedback.setAttribute('role', 'status'); feedback.textContent = 'Direct engine response received. This page uses the external index.'; }
  });
  search.start();
}
