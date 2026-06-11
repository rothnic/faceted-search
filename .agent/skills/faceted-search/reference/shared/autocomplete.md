# Autocomplete and Suggestions

Guide for implementing autocomplete, search suggestions, and query refinement for search UIs.

## Contents

- [Overview](#overview)
- [Types of Autocomplete](#types-of-autocomplete)
- [Basic InstantSearch Autocomplete](#basic-instantsearch-autocomplete)
- [Algolia Autocomplete Library](#algolia-autocomplete-library)
- [Multi-Source Autocomplete](#multi-source-autocomplete)
- [Meilisearch Autocomplete](#meilisearch-autocomplete)
- [Typesense Autocomplete](#typesense-autocomplete)
- [PostgreSQL Autocomplete](#postgresql-autocomplete)
- [Best Practices](#best-practices)

## Overview

Autocomplete helps users by:
- Suggesting queries as they type
- Showing matching records immediately
- Providing category/facet suggestions
- Correcting typos
- Completing partial inputs

**Two approaches:**

1. **Simple search-as-you-type**: InstantSearch built-in
2. **Rich autocomplete dropdown**: Multi-source suggestions with Algolia Autocomplete

## Types of Autocomplete

### 1. Query Suggestions

Suggest common search queries:

```
User types: "hamp"
Suggestions:
- hampton cove
- hampton cove homes
- hampton cove elementary
```

### 2. Record Suggestions

Show actual matching records:

```
User types: "4 bed"
Suggestions:
- 4 bedroom home near Hampton Cove
- 4 bedroom townhouse in Madison
- 4 bed 3 bath single family home
```

### 3. Facet Value Suggestions

Suggest facet values:

```
User types: "hunt"
Suggestions:
Cities:
- Huntsville
- Hunter Creek

Neighborhoods:
- Hunter's Ridge
- Huntington Park
```

### 4. Semantic Suggestions

Suggest related concepts:

```
User types: "family"
Suggestions:
- family friendly neighborhood
- large family home
- homes near elementary school
- houses with fenced yard
```

## Basic InstantSearch Autocomplete

InstantSearch's `searchBox` widget with `searchAsYouType`:

```typescript
import { searchBox, hits } from 'instantsearch.js/es/widgets';

search.addWidgets([
  searchBox({
    container: '#searchbox',
    placeholder: 'Search houses...',
    searchAsYouType: true,
    showReset: true,
    showLoadingIndicator: true
  }),
  
  hits({
    container: '#hits',
    templates: {
      item: (hit, { html }) => html`
        <div class="hit">
          <h3>${hit.title}</h3>
          <p>${hit.city}, ${hit.state}</p>
        </div>
      `
    }
  })
]);
```

**Pros:**
- Simple to implement
- Zero configuration
- Works with all backends

**Cons:**
- Limited customization
- No multi-source suggestions
- Basic UI

## Algolia Autocomplete Library

Powerful autocomplete with multi-source support:

### Installation

```bash
npm install @algolia/autocomplete-js
```

### Basic Setup

```typescript
import { autocomplete } from '@algolia/autocomplete-js';
import '@algolia/autocomplete-theme-classic';

autocomplete({
  container: '#autocomplete',
  placeholder: 'Search houses...',
  getSources({ query }) {
    return [
      {
        sourceId: 'houses',
        getItems() {
          return searchHouses(query);
        },
        templates: {
          item({ item }) {
            return `
              <div class="house-suggestion">
                <div class="house-title">${item.title}</div>
                <div class="house-location">${item.city}, ${item.state}</div>
                <div class="house-price">$${item.price.toLocaleString()}</div>
              </div>
            `;
          }
        }
      }
    ];
  }
});
```

## Multi-Source Autocomplete

Combine multiple suggestion types:

```typescript
import { autocomplete } from '@algolia/autocomplete-js';

autocomplete({
  container: '#autocomplete',
  placeholder: 'Search by city, neighborhood, school, or features',
  
  getSources({ query }) {
    if (!query) {
      return [];
    }
    
    return [
      // Cities
      {
        sourceId: 'cities',
        getItems() {
          return searchCities(query);
        },
        templates: {
          header() {
            return 'Cities';
          },
          item({ item, html }) {
            return html`
              <div class="city-suggestion">
                <span class="icon">📍</span>
                <span class="name">${item.name}, ${item.state}</span>
                <span class="count">${item.house_count} homes</span>
              </div>
            `;
          }
        },
        onSelect({ item }) {
          window.location.href = `/search?city=${item.name}`;
        }
      },
      
      // Neighborhoods
      {
        sourceId: 'neighborhoods',
        getItems() {
          return searchNeighborhoods(query);
        },
        templates: {
          header() {
            return 'Neighborhoods';
          },
          item({ item, html }) {
            return html`
              <div class="neighborhood-suggestion">
                <span class="icon">🏘️</span>
                <span class="name">${item.name}</span>
                <span class="location">${item.city}, ${item.state}</span>
              </div>
            `;
          }
        },
        onSelect({ item }) {
          window.location.href = `/search?neighborhood=${item.name}`;
        }
      },
      
      // School Districts
      {
        sourceId: 'schools',
        getItems() {
          return searchSchools(query);
        },
        templates: {
          header() {
            return 'School Districts';
          },
          item({ item, html }) {
            return html`
              <div class="school-suggestion">
                <span class="icon">🏫</span>
                <span class="name">${item.name}</span>
                <span class="rating">Rating: ${item.rating}/10</span>
              </div>
            `;
          }
        }
      },
      
      // Houses
      {
        sourceId: 'houses',
        getItems() {
          return searchHouses(query);
        },
        templates: {
          header() {
            return 'Matching Houses';
          },
          item({ item, html }) {
            return html`
              <div class="house-suggestion">
                <img src="${item.image_url}" alt="${item.title}" class="thumbnail" />
                <div class="house-info">
                  <div class="title">${item.title}</div>
                  <div class="location">${item.city}, ${item.state}</div>
                  <div class="details">
                    <span class="price">$${item.price.toLocaleString()}</span>
                    <span class="specs">${item.bedrooms} bd · ${item.bathrooms} ba</span>
                  </div>
                </div>
              </div>
            `;
          }
        },
        onSelect({ item }) {
          window.location.href = `/houses/${item.id}`;
        }
      }
    ];
  }
});
```

## Meilisearch Autocomplete

### Search Cities

```typescript
async function searchCities(query: string) {
  const results = await meilisearch.index('cities').search(query, {
    limit: 5,
    attributesToRetrieve: ['name', 'state', 'house_count'],
    attributesToHighlight: ['name']
  });
  
  return results.hits;
}
```

### Search Neighborhoods

```typescript
async function searchNeighborhoods(query: string) {
  const results = await meilisearch.index('neighborhoods').search(query, {
    limit: 5,
    attributesToRetrieve: ['name', 'city', 'state', 'house_count'],
    sort: ['house_count:desc']
  });
  
  return results.hits;
}
```

### Search Houses

```typescript
async function searchHouses(query: string) {
  const results = await meilisearch.index('houses').search(query, {
    filter: ['listing_status_facet = active'],
    limit: 5,
    attributesToRetrieve: [
      'id',
      'title',
      'city',
      'state',
      'price',
      'bedrooms',
      'bathrooms',
      'image_url'
    ]
  });
  
  return results.hits;
}
```

### Complete Meilisearch Integration

```typescript
import { autocomplete, getAlgoliaResults } from '@algolia/autocomplete-js';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';

const { searchClient } = instantMeiliSearch(
  'https://search.example.com',
  'MEILI_SEARCH_KEY'
);

autocomplete({
  container: '#autocomplete',
  placeholder: 'Search houses...',
  
  getSources({ query }) {
    return [
      {
        sourceId: 'houses',
        getItems() {
          return getAlgoliaResults({
            searchClient,
            queries: [
              {
                indexName: 'houses',
                query,
                params: {
                  filters: 'listing_status_facet = active',
                  hitsPerPage: 5
                }
              }
            ]
          });
        },
        templates: {
          item({ item, html }) {
            return html`
              <div class="house-result">
                <div class="title">${item.title}</div>
                <div class="location">${item.city}, ${item.state}</div>
                <div class="price">$${item.price.toLocaleString()}</div>
              </div>
            `;
          }
        }
      }
    ];
  },
  
  onSubmit({ state }) {
    window.location.href = `/search?q=${encodeURIComponent(state.query)}`;
  }
});
```

## Typesense Autocomplete

### Search Implementation

```typescript
async function searchTypesense(collection: string, query: string, options: any = {}) {
  const results = await typesense
    .collections(collection)
    .documents()
    .search({
      q: query,
      query_by: options.query_by || 'name',
      per_page: options.limit || 5,
      ...options
    });
  
  return results.hits?.map((hit: any) => hit.document) || [];
}
```

### Multi-Source with Typesense

```typescript
autocomplete({
  container: '#autocomplete',
  placeholder: 'Search houses...',
  
  getSources({ query }) {
    if (!query) return [];
    
    return [
      // Cities
      {
        sourceId: 'cities',
        async getItems() {
          return await searchTypesense('cities', query, {
            query_by: 'name',
            sort_by: 'house_count:desc'
          });
        },
        templates: {
          header: () => 'Cities',
          item: ({ item, html }) => html`
            <div class="suggestion">
              📍 ${item.name}, ${item.state} (${item.house_count} homes)
            </div>
          `
        }
      },
      
      // Neighborhoods
      {
        sourceId: 'neighborhoods',
        async getItems() {
          return await searchTypesense('neighborhoods', query, {
            query_by: 'name,city'
          });
        },
        templates: {
          header: () => 'Neighborhoods',
          item: ({ item, html }) => html`
            <div class="suggestion">
              🏘️ ${item.name} · ${item.city}, ${item.state}
            </div>
          `
        }
      },
      
      // Houses
      {
        sourceId: 'houses',
        async getItems() {
          return await searchTypesense('houses', query, {
            query_by: 'title,description,city,neighborhood',
            filter_by: 'listing_status:=active',
            limit: 5
          });
        },
        templates: {
          header: () => 'Matching Houses',
          item: ({ item, html }) => html`
            <div class="house-result">
              <div class="title">${item.title}</div>
              <div class="location">${item.city}, ${item.state}</div>
              <div class="price">$${item.price.toLocaleString()}</div>
              <div class="specs">${item.bedrooms} bd · ${item.bathrooms} ba</div>
            </div>
          `
        },
        onSelect: ({ item }) => {
          window.location.href = `/houses/${item.id}`;
        }
      }
    ];
  }
});
```

## PostgreSQL Autocomplete

### City Autocomplete

```sql
SELECT
  name,
  state,
  count(*) OVER () as house_count
FROM cities
WHERE name ILIKE $1 || '%'
  OR name ILIKE '% ' || $1 || '%'
ORDER BY population DESC NULLS LAST
LIMIT 5;
```

### Neighborhood Autocomplete

```sql
SELECT DISTINCT
  neighborhood,
  city,
  state,
  count(*) as house_count
FROM houses
WHERE neighborhood ILIKE $1 || '%'
  AND listing_status = 'active'
GROUP BY neighborhood, city, state
ORDER BY house_count DESC
LIMIT 5;
```

### House Title Autocomplete

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  ts_rank(search_vector, websearch_to_tsquery('english', $1)) as rank
FROM houses
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND listing_status = 'active'
ORDER BY rank DESC
LIMIT 5;
```

### Prefix Search with pg_trgm

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX cities_name_trgm_idx ON cities USING gin (name gin_trgm_ops);

SELECT
  name,
  state,
  similarity(name, $1) as sim
FROM cities
WHERE name % $1  -- Similar to
ORDER BY sim DESC
LIMIT 5;
```

### Backend API

```typescript
router.get('/api/autocomplete/cities', async (req, res) => {
  const { q } = req.query;
  
  const results = await pool.query(`
    SELECT name, state, population
    FROM cities
    WHERE name ILIKE $1 || '%'
    ORDER BY population DESC NULLS LAST
    LIMIT 5
  `, [q]);
  
  res.json(results.rows);
});

router.get('/api/autocomplete/neighborhoods', async (req, res) => {
  const { q } = req.query;
  
  const results = await pool.query(`
    SELECT DISTINCT
      neighborhood,
      city,
      state,
      count(*) as house_count
    FROM houses
    WHERE neighborhood ILIKE $1 || '%'
      AND listing_status = 'active'
    GROUP BY neighborhood, city, state
    ORDER BY house_count DESC
    LIMIT 5
  `, [q]);
  
  res.json(results.rows);
});

router.get('/api/autocomplete/houses', async (req, res) => {
  const { q } = req.query;
  
  const results = await pool.query(`
    SELECT
      id,
      title,
      city,
      state,
      price,
      bedrooms,
      bathrooms
    FROM houses
    WHERE search_vector @@ websearch_to_tsquery('english', $1)
      AND listing_status = 'active'
    ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $1)) DESC
    LIMIT 5
  `, [q]);
  
  res.json(results.rows);
});
```

## Best Practices

### 1. Debounce Input

Wait for user to stop typing:

```typescript
autocomplete({
  container: '#autocomplete',
  debounce: 300, // milliseconds
  // ...
});
```

### 2. Minimum Query Length

Don't search for very short queries:

```typescript
getSources({ query }) {
  if (query.length < 2) {
    return [];
  }
  // ...
}
```

### 3. Limit Results Per Source

Don't overwhelm users:

```typescript
{
  sourceId: 'houses',
  getItems() {
    return searchHouses(query, { limit: 5 }); // Max 5 per source
  }
}
```

### 4. Show Result Counts

Help users understand what's available:

```typescript
templates: {
  header({ items }) {
    return `Houses (${items.length})`;
  }
}
```

### 5. Highlight Matches

Show what matched the query:

```typescript
function highlightMatch(text: string, query: string) {
  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}

templates: {
  item({ item, query }) {
    return `
      <div>${highlightMatch(item.title, query)}</div>
    `;
  }
}
```

### 6. Handle Empty States

Guide users when no results:

```typescript
templates: {
  noResults() {
    return 'No results found. Try a different search term.';
  }
}
```

### 7. Keyboard Navigation

Ensure accessibility:

```typescript
autocomplete({
  container: '#autocomplete',
  openOnFocus: true,
  // Keyboard navigation built-in
});
```

### 8. Recent Searches

Store and show recent searches:

```typescript
{
  sourceId: 'recent',
  getItems() {
    return getRecentSearches(); // From localStorage
  },
  templates: {
    header: () => 'Recent Searches',
    item: ({ item, html }) => html`
      <div class="recent-search">
        🕐 ${item.query}
      </div>
    `
  }
}
```

### 9. Popular Searches

Show trending queries:

```typescript
{
  sourceId: 'popular',
  getItems() {
    if (query) return []; // Only show when empty
    return getPopularSearches(); // From API
  },
  templates: {
    header: () => 'Popular Searches',
    item: ({ item, html }) => html`
      <div class="popular-search">
        🔥 ${item.query}
      </div>
    `
  }
}
```

### 10. Analytics

Track autocomplete usage:

```typescript
autocomplete({
  container: '#autocomplete',
  
  onSubmit({ state }) {
    analytics.track('autocomplete_submit', {
      query: state.query
    });
  },
  
  getSources({ query }) {
    analytics.track('autocomplete_search', {
      query,
      length: query.length
    });
    
    return sources;
  }
});
```

### 11. Mobile Optimization

```css
@media (max-width: 768px) {
  .aa-Autocomplete {
    width: 100%;
  }
  
  .aa-Panel {
    max-height: 50vh;
    overflow-y: auto;
  }
}
```

### 12. Error Handling

Handle network errors gracefully:

```typescript
{
  sourceId: 'houses',
  async getItems() {
    try {
      return await searchHouses(query);
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }
}
```

## Complete Example

Full implementation with all features:

```typescript
import { autocomplete } from '@algolia/autocomplete-js';
import '@algolia/autocomplete-theme-classic';

autocomplete({
  container: '#autocomplete',
  placeholder: 'Search by city, neighborhood, school, or features',
  debounce: 300,
  openOnFocus: true,
  
  getSources({ query, setIsOpen }) {
    // Show recent/popular when empty
    if (!query) {
      return [
        {
          sourceId: 'recent',
          getItems: () => getRecentSearches(),
          templates: {
            header: () => 'Recent Searches',
            item: ({ item, html }) => html`
              <div class="recent">${item.query}</div>
            `
          }
        }
      ];
    }
    
    // Minimum length
    if (query.length < 2) {
      return [];
    }
    
    return [
      {
        sourceId: 'cities',
        getItems: () => searchCities(query),
        templates: {
          header: ({ items }) => items.length > 0 ? 'Cities' : '',
          item: ({ item, html }) => html`
            <div class="city-item">
              <span class="icon">📍</span>
              <span class="name">${item.name}, ${item.state}</span>
              <span class="count">${item.house_count} homes</span>
            </div>
          `
        },
        onSelect: ({ item }) => {
          saveRecentSearch(query);
          window.location.href = `/search?city=${item.name}`;
        }
      },
      
      {
        sourceId: 'neighborhoods',
        getItems: () => searchNeighborhoods(query),
        templates: {
          header: ({ items }) => items.length > 0 ? 'Neighborhoods' : '',
          item: ({ item, html }) => html`
            <div class="neighborhood-item">
              <span class="icon">🏘️</span>
              <span class="name">${item.name}</span>
              <span class="location">${item.city}</span>
            </div>
          `
        }
      },
      
      {
        sourceId: 'houses',
        getItems: () => searchHouses(query),
        templates: {
          header: ({ items }) => items.length > 0 ? 'Matching Houses' : '',
          item: ({ item, html }) => html`
            <div class="house-item">
              <img src="${item.image_url}" alt="${item.title}" />
              <div class="info">
                <div class="title">${item.title}</div>
                <div class="location">${item.city}, ${item.state}</div>
                <div class="details">
                  <span class="price">$${item.price.toLocaleString()}</span>
                  <span class="specs">${item.bedrooms}bd · ${item.bathrooms}ba</span>
                </div>
              </div>
            </div>
          `,
          noResults: () => 'No houses found'
        },
        onSelect: ({ item }) => {
          window.location.href = `/houses/${item.id}`;
        }
      }
    ];
  },
  
  onSubmit({ state }) {
    saveRecentSearch(state.query);
    window.location.href = `/search?q=${encodeURIComponent(state.query)}`;
  }
});

// Helper functions
function getRecentSearches() {
  const recent = localStorage.getItem('recentSearches');
  return recent ? JSON.parse(recent) : [];
}

function saveRecentSearch(query: string) {
  const recent = getRecentSearches();
  const updated = [{ query }, ...recent.filter(r => r.query !== query)].slice(0, 5);
  localStorage.setItem('recentSearches', JSON.stringify(updated));
}
```
