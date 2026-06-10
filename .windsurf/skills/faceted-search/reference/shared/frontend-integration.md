# Frontend Integration

Complete guide for integrating search backends with frontend UI frameworks using InstantSearch.js and custom implementations.

## Contents

- [Overview](#overview)
- [InstantSearch.js Basics](#instantsearchjs-basics)
- [Meilisearch Integration](#meilisearch-integration)
- [Typesense Integration](#typesense-integration)
- [Custom Backend Adapter](#custom-backend-adapter)
- [Angular Integration](#angular-integration)
- [React Integration](#react-integration)
- [Widget Patterns](#widget-patterns)
- [URL Routing](#url-routing)
- [Performance Optimization](#performance-optimization)

## Overview

### InstantSearch.js

InstantSearch.js is a UI library for building search interfaces. It provides:

- **Widgets**: Pre-built search components (searchbox, facets, hits, pagination)
- **State management**: Automatic sync between UI and search
- **Adapters**: Official support for Algolia, Meilisearch, Typesense
- **Routing**: URL synchronization
- **Server-side rendering**: SSR support

**Best for:**
- Rapid development
- Consistent UX patterns
- Meilisearch or Typesense backends

**Custom adapter needed for:**
- PostgreSQL native search
- pg_search extension

## InstantSearch.js Basics

### Installation

```bash
npm install instantsearch.js
```

With search engine adapters:

```bash
# Meilisearch
npm install @meilisearch/instant-meilisearch

# Typesense
npm install typesense-instantsearch-adapter
```

### Core Concepts

**Search instance**: Manages state and widgets

```typescript
const search = instantsearch({
  indexName: 'houses',
  searchClient: searchClient,
  routing: true
});
```

**Widgets**: UI components that connect to search

```typescript
search.addWidgets([
  searchBox({ container: '#searchbox' }),
  hits({ container: '#hits' }),
  pagination({ container: '#pagination' })
]);
```

**Search client**: Handles communication with backend

```typescript
const searchClient = {
  search(requests) {
    // Implementation varies by backend
  }
};
```

## Meilisearch Integration

### Setup

```typescript
import instantsearch from 'instantsearch.js';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import {
  searchBox,
  hits,
  refinementList,
  rangeSlider,
  pagination
} from 'instantsearch.js/es/widgets';

const { searchClient } = instantMeiliSearch(
  'https://search.example.com',
  'MEILI_SEARCH_KEY',
  {
    primaryKey: 'id'
  }
);

const search = instantsearch({
  indexName: 'houses',
  searchClient,
  routing: true
});
```

### Complete Example

```typescript
search.addWidgets([
  // Search box
  searchBox({
    container: '#searchbox',
    placeholder: 'Search by city, neighborhood, or features',
    showReset: true,
    showSubmit: true,
    showLoadingIndicator: true
  }),
  
  // Stats
  stats({
    container: '#stats',
    templates: {
      text: '{{#hasNoResults}}No results{{/hasNoResults}}{{#hasOneResult}}1 result{{/hasOneResult}}{{#hasManyResults}}{{#helpers.formatNumber}}{{nbHits}}{{/helpers.formatNumber}} results{{/hasManyResults}}'
    }
  }),
  
  // Current refinements (selected filters)
  currentRefinements({
    container: '#current-refinements'
  }),
  
  // Clear all filters
  clearRefinements({
    container: '#clear-refinements',
    templates: {
      resetLabel: 'Clear all filters'
    }
  }),
  
  // City facet
  refinementList({
    container: '#city-facet',
    attribute: 'city_facet',
    searchable: true,
    searchablePlaceholder: 'Search cities',
    limit: 10,
    showMore: true,
    showMoreLimit: 50
  }),
  
  // Neighborhood facet
  refinementList({
    container: '#neighborhood-facet',
    attribute: 'neighborhood_facet',
    searchable: true,
    limit: 10,
    showMore: true
  }),
  
  // Property type facet
  refinementList({
    container: '#property-type-facet',
    attribute: 'property_type_facet',
    templates: {
      item: '{{label}} ({{count}})'
    }
  }),
  
  // Bedrooms facet
  refinementList({
    container: '#bedrooms-facet',
    attribute: 'bedrooms',
    sortBy: ['name:asc']
  }),
  
  // Price range slider
  rangeSlider({
    container: '#price-range',
    attribute: 'price',
    tooltips: {
      format: (value) => `$${(value / 1000).toFixed(0)}k`
    },
    pips: false
  }),
  
  // Square feet range
  rangeSlider({
    container: '#square-feet-range',
    attribute: 'square_feet',
    tooltips: true
  }),
  
  // Amenity toggles
  refinementList({
    container: '#has-pool-toggle',
    attribute: 'has_pool',
    operator: 'and'
  }),
  
  refinementList({
    container: '#has-garage-toggle',
    attribute: 'has_garage',
    operator: 'and'
  }),
  
  // Sorting
  sortBy({
    container: '#sort-by',
    items: [
      { label: 'Relevance', value: 'houses' },
      { label: 'Price: Low to High', value: 'houses/sort/price:asc' },
      { label: 'Price: High to Low', value: 'houses/sort/price:desc' },
      { label: 'Newest', value: 'houses/sort/days_on_market:asc' }
    ]
  }),
  
  // Results
  hits({
    container: '#hits',
    templates: {
      item: (hit, { html, components }) => html`
        <article class="house-card">
          <img src="${hit.image_url}" alt="${hit.title}" />
          <div class="house-info">
            <h2>${components.Highlight({ hit, attribute: 'title' })}</h2>
            <p class="location">
              ${hit.city}, ${hit.state} · ${hit.neighborhood}
            </p>
            <p class="price">
              <strong>$${hit.price.toLocaleString()}</strong>
            </p>
            <p class="details">
              ${hit.bedrooms} bd · ${hit.bathrooms} ba · ${hit.square_feet.toLocaleString()} sqft
            </p>
            <p class="type">${hit.property_type} · ${hit.school_district}</p>
            ${hit.tags && hit.tags.length > 0 ? html`
              <div class="tags">
                ${hit.tags.map(tag => html`<span class="tag">${tag}</span>`)}
              </div>
            ` : ''}
          </div>
        </article>
      `,
      empty: 'No houses match your search.'
    }
  }),
  
  // Pagination
  pagination({
    container: '#pagination',
    padding: 2,
    showFirst: true,
    showLast: true
  })
]);

search.start();
```

## Typesense Integration

### Setup

```typescript
import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';

const adapter = new TypesenseInstantSearchAdapter({
  server: {
    apiKey: 'your_search_only_key',
    nodes: [{
      host: 'search.example.com',
      port: 443,
      protocol: 'https'
    }]
  },
  additionalSearchParameters: {
    query_by: [
      'title',
      'description',
      'city',
      'neighborhood',
      'school_district',
      'zip_code',
      'embedding'
    ].join(','),
    num_typos: 2
  }
});

const search = instantsearch({
  indexName: 'houses',
  searchClient: adapter.searchClient,
  routing: true
});
```

### Widgets (Same as Meilisearch)

The widget configuration is identical to Meilisearch. Use the same pattern from above.

### Advanced: Dynamic query_by

```typescript
const adapter = new TypesenseInstantSearchAdapter({
  server: { /* ... */ },
  additionalSearchParameters: {
    query_by: 'title,description,city',
    // Can be overridden per search
  }
});

// Override for semantic search
search.helper.setQueryParameter('additionalSearchParameters', {
  query_by: 'embedding',
  num_typos: 0
});
```

## Custom Backend Adapter

For PostgreSQL or pg_search, create a custom search client:

### Custom Search Client

```typescript
const searchClient = {
  async search(requests: any[]) {
    try {
      const response = await fetch('/api/search/houses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      });
      
      if (!response.ok) {
        throw new Error('Search request failed');
      }
      
      return await response.json();
    } catch (error) {
      console.error('Search error:', error);
      return {
        results: requests.map(() => ({
          hits: [],
          nbHits: 0,
          page: 0,
          nbPages: 0,
          hitsPerPage: 20,
          processingTimeMS: 0,
          facets: {}
        }))
      };
    }
  },
  
  // Optional: For autocomplete
  async searchForFacetValues(requests: any[]) {
    const response = await fetch('/api/search/facets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });
    return await response.json();
  }
};
```

### Backend API Endpoint

```typescript
import express from 'express';
import { pool } from './db';

const router = express.Router();

router.post('/api/search/houses', async (req, res) => {
  const { requests } = req.body;
  const request = requests[0]; // InstantSearch sends array
  
  const {
    query = '',
    params = {}
  } = request;
  
  const {
    filters = '',
    facets = [],
    hitsPerPage = 20,
    page = 0
  } = params;
  
  // Parse filters (implement proper parser)
  const parsedFilters = parseInstantSearchFilters(filters);
  
  // Build and execute query
  const result = await searchHouses({
    query,
    filters: parsedFilters,
    facets,
    limit: hitsPerPage,
    offset: page * hitsPerPage
  });
  
  // Return InstantSearch-compatible response
  res.json({
    results: [
      {
        hits: result.hits,
        nbHits: result.totalHits,
        page,
        nbPages: Math.ceil(result.totalHits / hitsPerPage),
        hitsPerPage,
        processingTimeMS: result.processingTimeMS,
        facets: result.facets || {},
        facets_stats: result.facets_stats || {}
      }
    ]
  });
});

export default router;
```

### Filter Parser

```typescript
function parseInstantSearchFilters(filterString: string) {
  const filters: any = {};
  
  if (!filterString) return filters;
  
  // Parse format: "field:value AND field>=value AND field<=value"
  const parts = filterString.split(' AND ');
  
  for (const part of parts) {
    // Equality: "city_facet:Huntsville"
    if (part.includes(':') && !part.includes('>=') && !part.includes('<=')) {
      const [field, value] = part.split(':');
      filters[field] = value.replace(/['"]/g, '');
    }
    // Greater than or equal: "price>=300000"
    else if (part.includes('>=')) {
      const [field, value] = part.split('>=');
      filters[`${field}_min`] = parseInt(value);
    }
    // Less than or equal: "price<=600000"
    else if (part.includes('<=')) {
      const [field, value] = part.split('<=');
      filters[`${field}_max`] = parseInt(value);
    }
  }
  
  return filters;
}
```

## Angular Integration

### Component

```typescript
import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import instantsearch from 'instantsearch.js';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';

@Component({
  selector: 'app-house-search',
  templateUrl: './house-search.component.html',
  styleUrls: ['./house-search.component.css']
})
export class HouseSearchComponent implements AfterViewInit, OnDestroy {
  private search?: any;

  ngAfterViewInit() {
    const { searchClient } = instantMeiliSearch(
      environment.meilisearchUrl,
      environment.meilisearchKey,
      { primaryKey: 'id' }
    );

    this.search = instantsearch({
      indexName: 'houses',
      searchClient,
      routing: {
        router: historyRouter(),
        stateMapping: {
          stateToRoute(uiState: any) {
            const indexUiState = uiState.houses || {};
            return {
              q: indexUiState.query,
              city: indexUiState.refinementList?.city_facet,
              type: indexUiState.refinementList?.property_type_facet,
              beds: indexUiState.refinementList?.bedrooms,
              price_min: indexUiState.range?.price?.min,
              price_max: indexUiState.range?.price?.max,
              page: indexUiState.page
            };
          },
          routeToState(routeState: any) {
            return {
              houses: {
                query: routeState.q,
                refinementList: {
                  city_facet: routeState.city,
                  property_type_facet: routeState.type,
                  bedrooms: routeState.beds
                },
                range: {
                  price: {
                    min: routeState.price_min,
                    max: routeState.price_max
                  }
                },
                page: routeState.page
              }
            };
          }
        }
      }
    });

    this.addWidgets();
    this.search.start();
  }

  ngOnDestroy() {
    this.search?.dispose();
  }

  private addWidgets() {
    // Add widgets here (same as previous examples)
  }
}
```

### Template

```html
<div class="search-page">
  <header class="search-header">
    <div id="searchbox"></div>
    <div id="stats"></div>
  </header>

  <div class="search-layout">
    <aside class="filters">
      <section>
        <h3>Current Filters</h3>
        <div id="current-refinements"></div>
        <div id="clear-refinements"></div>
      </section>

      <section>
        <h3>City</h3>
        <div id="city-facet"></div>
      </section>

      <section>
        <h3>Neighborhood</h3>
        <div id="neighborhood-facet"></div>
      </section>

      <section>
        <h3>Property Type</h3>
        <div id="property-type-facet"></div>
      </section>

      <section>
        <h3>Bedrooms</h3>
        <div id="bedrooms-facet"></div>
      </section>

      <section>
        <h3>Price Range</h3>
        <div id="price-range"></div>
      </section>

      <section>
        <h3>Square Feet</h3>
        <div id="square-feet-range"></div>
      </section>

      <section>
        <h3>Amenities</h3>
        <label>
          <div id="has-pool-toggle"></div>
        </label>
        <label>
          <div id="has-garage-toggle"></div>
        </label>
      </section>
    </aside>

    <main class="results">
      <div class="results-header">
        <div id="sort-by"></div>
      </div>
      <div id="hits"></div>
      <div id="pagination"></div>
    </main>
  </div>
</div>
```

## React Integration

### Using react-instantsearch

```bash
npm install react-instantsearch
```

```tsx
import React from 'react';
import {
  InstantSearch,
  SearchBox,
  Hits,
  RefinementList,
  RangeSlider,
  Pagination,
  Stats,
  CurrentRefinements,
  ClearRefinements,
  SortBy
} from 'react-instantsearch';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';

const searchClient = instantMeiliSearch(
  'https://search.example.com',
  'MEILI_SEARCH_KEY'
).searchClient;

function HouseSearchPage() {
  return (
    <InstantSearch
      searchClient={searchClient}
      indexName="houses"
      routing={true}
    >
      <div className="search-page">
        <header className="search-header">
          <SearchBox placeholder="Search by city, neighborhood, or features" />
          <Stats />
        </header>

        <div className="search-layout">
          <aside className="filters">
            <CurrentRefinements />
            <ClearRefinements />

            <section>
              <h3>City</h3>
              <RefinementList
                attribute="city_facet"
                searchable={true}
                searchablePlaceholder="Search cities"
                limit={10}
                showMore={true}
              />
            </section>

            <section>
              <h3>Neighborhood</h3>
              <RefinementList
                attribute="neighborhood_facet"
                searchable={true}
                limit={10}
                showMore={true}
              />
            </section>

            <section>
              <h3>Property Type</h3>
              <RefinementList attribute="property_type_facet" />
            </section>

            <section>
              <h3>Bedrooms</h3>
              <RefinementList attribute="bedrooms" />
            </section>

            <section>
              <h3>Price Range</h3>
              <RangeSlider
                attribute="price"
                format={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
            </section>
          </aside>

          <main className="results">
            <div className="results-header">
              <SortBy
                items={[
                  { label: 'Relevance', value: 'houses' },
                  { label: 'Price: Low to High', value: 'houses/sort/price:asc' },
                  { label: 'Price: High to Low', value: 'houses/sort/price:desc' }
                ]}
              />
            </div>
            
            <Hits hitComponent={HouseCard} />
            <Pagination />
          </main>
        </div>
      </div>
    </InstantSearch>
  );
}

function HouseCard({ hit }: any) {
  return (
    <article className="house-card">
      <img src={hit.image_url} alt={hit.title} />
      <div className="house-info">
        <h2>{hit.title}</h2>
        <p className="location">{hit.city}, {hit.state} · {hit.neighborhood}</p>
        <p className="price"><strong>${hit.price.toLocaleString()}</strong></p>
        <p className="details">
          {hit.bedrooms} bd · {hit.bathrooms} ba · {hit.square_feet.toLocaleString()} sqft
        </p>
        <p className="type">{hit.property_type} · {hit.school_district}</p>
      </div>
    </article>
  );
}

export default HouseSearchPage;
```

## Widget Patterns

### Custom Hit Template

```typescript
hits({
  container: '#hits',
  templates: {
    item: (hit, { html, components }) => html`
      <article class="house-card" data-house-id="${hit.id}">
        ${hit.image_url ? html`
          <img src="${hit.image_url}" alt="${hit.title}" />
        ` : ''}
        
        <div class="house-info">
          <h2>${components.Highlight({ hit, attribute: 'title' })}</h2>
          
          <p class="location">
            ${components.Highlight({ hit, attribute: 'city' })}, ${hit.state}
            ${hit.neighborhood ? html` · ${components.Highlight({ hit, attribute: 'neighborhood' })}` : ''}
          </p>
          
          <p class="price">
            <strong>$${hit.price.toLocaleString()}</strong>
          </p>
          
          <p class="details">
            ${hit.bedrooms} bed · ${hit.bathrooms} bath · 
            ${hit.square_feet.toLocaleString()} sqft
          </p>
          
          ${hit.school_district ? html`
            <p class="school">${hit.school_district}</p>
          ` : ''}
          
          ${hit.tags && hit.tags.length > 0 ? html`
            <div class="tags">
              ${hit.tags.map(tag => html`<span class="tag">${tag}</span>`)}
            </div>
          ` : ''}
        </div>
      </article>
    `,
    empty: html`
      <div class="no-results">
        <p>No houses match your search.</p>
        <p>Try adjusting your filters or search terms.</p>
      </div>
    `
  }
})
```

## URL Routing

### Configure Routing

```typescript
import { historyRouter } from 'instantsearch.js/es/lib/routers';

const search = instantsearch({
  indexName: 'houses',
  searchClient,
  routing: {
    router: historyRouter(),
    stateMapping: {
      stateToRoute(uiState) {
        const indexUiState = uiState.houses || {};
        return {
          q: indexUiState.query,
          city: indexUiState.refinementList?.city_facet,
          page: indexUiState.page
        };
      },
      routeToState(routeState) {
        return {
          houses: {
            query: routeState.q,
            refinementList: {
              city_facet: routeState.city
            },
            page: routeState.page
          }
        };
      }
    }
  }
});
```

## Performance Optimization

### 1. Debounce Search Input

```typescript
searchBox({
  container: '#searchbox',
  queryHook(query, search) {
    clearTimeout(this.timerId);
    this.timerId = setTimeout(() => search(query), 300);
  }
});
```

### 2. Lazy Load Facets

Only load facets when expanded:

```typescript
refinementList({
  container: '#city-facet',
  attribute: 'city_facet',
  limit: 10,
  showMore: true,
  showMoreLimit: 50
});
```

### 3. Virtual Scrolling for Results

Use intersection observer for infinite scroll:

```typescript
const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    search.helper.nextPage().search();
  }
});

observer.observe(document.querySelector('#load-more'));
```

### 4. Cache Search Results

```typescript
const searchCache = new Map();

const cachingSearchClient = {
  search(requests) {
    const key = JSON.stringify(requests);
    
    if (searchCache.has(key)) {
      return Promise.resolve(searchCache.get(key));
    }
    
    return actualSearchClient.search(requests).then(results => {
      searchCache.set(key, results);
      return results;
    });
  }
};
```
