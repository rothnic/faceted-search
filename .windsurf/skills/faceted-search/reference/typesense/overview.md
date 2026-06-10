# Typesense

Complete guide for implementing faceted, geo-aware, and semantic search using Typesense.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Collection Schema](#collection-schema)
- [Auto-Embedding Configuration](#auto-embedding-configuration)
- [Document Structure](#document-structure)
- [Search Queries](#search-queries)
- [Facets and Filters](#facets-and-filters)
- [Geo Search](#geo-search)
- [Semantic and Hybrid Search](#semantic-and-hybrid-search)
- [Sorting](#sorting)
- [Typo Tolerance](#typo-tolerance)
- [Synonyms](#synonyms)
- [Syncing from PostgreSQL](#syncing-from-postgresql)
- [Frontend Integration](#frontend-integration)
- [Performance and Scaling](#performance-and-scaling)

## Overview

Typesense is a dedicated search engine with strong schema control:

- **Schema-by-convention** - Wildcard field patterns (e.g., `*_facet`)
- **Built-in vector search** - Native semantic search support
- **Auto-embedding** - Configure which fields to embed
- **Strong faceting** - Excellent facet performance
- **Geo search** - Built-in geopoint support
- **Hybrid search** - Easy keyword + semantic combination
- **InstantSearch.js** - Excellent adapter available

**Best for:** Advanced faceting, strong schema control, geo-heavy applications

## Installation

### Docker

```bash
docker run -p 8108:8108 \
  -v $(pwd)/typesense-data:/data \
  typesense/typesense:latest \
  --data-dir /data \
  --api-key=your_api_key
```

### Typesense Cloud

Managed hosting available at https://cloud.typesense.org

### Self-hosted

Download from https://typesense.org/downloads/

```bash
./typesense-server \
  --data-dir=/var/lib/typesense \
  --api-key=your_api_key \
  --enable-cors
```

## Collection Schema

Typesense requires explicit schema definition with powerful pattern matching:

```typescript
import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [{
    host: 'search.example.com',
    port: 443,
    protocol: 'https'
  }],
  apiKey: 'your_api_key',
  connectionTimeoutSeconds: 2
});

const housesSchema = {
  name: 'houses',
  fields: [
    // Wildcard: auto-detect all fields
    { name: '.*', type: 'auto' },
    
    // Wildcard: all *_facet fields are facetable
    { name: '.*_facet', type: 'auto', facet: true },
    
    // Explicit searchable fields
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    
    // Location fields
    { name: 'city', type: 'string', facet: true },
    { name: 'state', type: 'string', facet: true },
    { name: 'county', type: 'string', optional: true, facet: true },
    { name: 'neighborhood', type: 'string', optional: true, facet: true },
    { name: 'zip_code', type: 'string', facet: true },
    
    { name: 'location', type: 'geopoint' },
    
    // Numeric fields
    { name: 'price', type: 'int32', facet: true },
    { name: 'bedrooms', type: 'int32', facet: true },
    { name: 'bathrooms', type: 'float', facet: true },
    { name: 'square_feet', type: 'int32', facet: true },
    { name: 'lot_size_acres', type: 'float', optional: true, facet: true },
    { name: 'year_built', type: 'int32', optional: true, facet: true },
    
    // Categorical fields
    { name: 'property_type', type: 'string', facet: true },
    { name: 'listing_status', type: 'string', facet: true },
    { name: 'school_district', type: 'string', optional: true, facet: true },
    
    // Boolean amenities
    { name: 'has_pool', type: 'bool', facet: true },
    { name: 'has_garage', type: 'bool', facet: true },
    { name: 'has_basement', type: 'bool', facet: true },
    { name: 'has_fenced_yard', type: 'bool', facet: true },
    { name: 'waterfront', type: 'bool', facet: true },
    { name: 'new_construction', type: 'bool', facet: true },
    
    // Arrays
    { name: 'tags', type: 'string[]', optional: true, facet: true },
    
    // Auto-embedding field
    {
      name: 'embedding',
      type: 'float[]',
      embed: {
        from: [
          'title',
          'description',
          'city',
          'neighborhood',
          'school_district',
          'property_type',
          'tags'
        ],
        model_config: {
          model_name: 'ts/all-MiniLM-L12-v2'
        }
      }
    }
  ],
  default_sorting_field: 'price'
};

await client.collections().create(housesSchema);
```

### Schema field types

- **string** - Text field
- **int32** / **int64** - Integer
- **float** - Floating point
- **bool** - Boolean
- **geopoint** - Location [lat, lng]
- **string[]** - Array of strings
- **auto** - Auto-detect type
- **float[]** - Vector embeddings

### Field options

- **facet: true** - Enable faceting
- **optional: true** - Field not required
- **index: false** - Don't index (store only)
- **sort: true** - Enable sorting (implicit for numeric/bool)

## Auto-Embedding Configuration

One of Typesense's strongest features: explicit control over embedding sources.

### Built-in embedding models

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: ['title', 'description', 'city', 'neighborhood'],
    model_config: {
      model_name: 'ts/all-MiniLM-L12-v2'
    }
  }
}
```

Supported models:
- `ts/all-MiniLM-L12-v2` - Fast, 384 dimensions
- `ts/all-MiniLM-L6-v2` - Faster, 384 dimensions
- `ts/paraphrase-multilingual-MiniLM-L12-v2` - Multilingual

### OpenAI embeddings

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: ['title', 'description', 'city'],
    model_config: {
      model_name: 'openai/text-embedding-3-small',
      api_key: 'your_openai_key'
    }
  }
}
```

### External embeddings

Provide your own embeddings:

```typescript
{
  name: 'embedding',
  type: 'float[]',
  num_dim: 1536
}
```

Then include embedding in documents:

```json
{
  "id": "house_1001",
  "title": "...",
  "embedding": [0.123, -0.456, ...]
}
```

### Embedding regeneration

Typesense only regenerates embeddings when fields in `embed.from` change:

**These changes regenerate embedding:**
- title changed
- description changed
- city changed
- Any field listed in `embed.from`

**These changes don't regenerate:**
- price changed
- listing_status changed
- days_on_market changed
- Fields not in `embed.from`

## Document Structure

```json
{
  "id": "house_1001",
  "title": "4 bedroom home near Hampton Cove",
  "description": "Spacious single-family home with fenced yard, two-car garage, mountain views, and access to nearby walking trails.",
  
  "city": "Owens Cross Roads",
  "state": "AL",
  "county": "Madison",
  "neighborhood": "Hampton Cove",
  "zip_code": "35763",
  
  "location": [34.6532, -86.4778],
  
  "price": 485000,
  "bedrooms": 4,
  "bathrooms": 3,
  "square_feet": 2750,
  "lot_size_acres": 0.31,
  "year_built": 2018,
  
  "property_type": "single_family",
  "listing_status": "active",
  "school_district": "Madison County",
  
  "has_pool": false,
  "has_garage": true,
  "has_basement": false,
  "has_fenced_yard": true,
  "waterfront": false,
  "new_construction": false,
  
  "city_facet": "Owens Cross Roads",
  "state_facet": "AL",
  "county_facet": "Madison",
  "neighborhood_facet": "Hampton Cove",
  "property_type_facet": "single_family",
  "listing_status_facet": "active",
  "school_district_facet": "Madison County",
  
  "tags": ["mountain_view", "family_friendly", "near_trails"]
}
```

**Note:** When using auto-embedding, don't include `embedding` field. Typesense generates it from `embed.from` fields.

### Importing documents

```typescript
// Single document
await client
  .collections('houses')
  .documents()
  .create(document);

// Batch import
await client
  .collections('houses')
  .documents()
  .import(documents, { action: 'upsert' });
```

## Search Queries

### Basic keyword search

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hampton cove garage',
    query_by: 'title,description,city,neighborhood',
    per_page: 20,
    page: 1
  });
```

### With filters

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hampton cove',
    query_by: 'title,description,city,neighborhood',
    filter_by: [
      'listing_status:=active',
      'price:>=300000',
      'price:<=600000',
      'bedrooms:>=3',
      'location:(34.7304, -86.5861, 10 mi)'
    ].join(' && '),
    per_page: 20,
    page: 1
  });
```

### With facets

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hampton cove',
    query_by: 'title,description,city,neighborhood',
    filter_by: 'listing_status:=active',
    facet_by: [
      'city_facet',
      'neighborhood_facet',
      'property_type_facet',
      'school_district_facet',
      'bedrooms',
      'has_pool',
      'has_garage'
    ].join(','),
    per_page: 20
  });
```

Response includes:
```json
{
  "hits": [...],
  "facet_counts": [
    {
      "field_name": "city_facet",
      "counts": [
        { "value": "Huntsville", "count": 620 },
        { "value": "Madison", "count": 310 }
      ]
    }
  ],
  "found": 1240
}
```

## Facets and Filters

### Filter syntax

```typescript
// Equality
'city:=Huntsville'

// Multiple values (OR)
'city:=[Huntsville, Madison]'

// Numeric comparison
'price:>=300000'
'price:<=600000'

// Range
'price:[300000..600000]'

// Boolean
'has_garage:=true'

// Null checks
'neighborhood:!=null'

// String prefix
'zip_code:357*'

// Geo radius
'location:(34.7304, -86.5861, 10 mi)'

// Combine with AND
filter_by: 'listing_status:=active && price:>=300000 && bedrooms:>=3'

// Combine with OR
filter_by: 'city:=Huntsville || city:=Madison'

// Complex
filter_by: '(city:=Huntsville || city:=Madison) && price:>=300000'
```

### Facet queries

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: '*',  // Match all
    filter_by: 'listing_status:=active',
    facet_by: 'city_facet,property_type_facet,bedrooms',
    max_facet_values: 100,  // Return top 100 values per facet
    per_page: 0  // Only get facets, no results
  });
```

### Numeric range facets

Typesense doesn't have built-in range facets. Use facet stats or query for min/max:

```typescript
// Get all documents to compute ranges client-side
// Or maintain separate stats
const stats = await getNumericStats('price');
```

## Geo Search

### Radius search

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: '*',
    filter_by: [
      'listing_status:=active',
      'location:(34.7304, -86.5861, 10 mi)'
    ].join(' && '),
    sort_by: 'location(34.7304, -86.5861):asc',
    per_page: 20
  });
```

### Multiple radius filters

```typescript
filter_by: [
  'listing_status:=active',
  'location:(34.7304, -86.5861, 10 mi)',
  'location:(34.8, -86.6, 5 mi)'  // Must be within BOTH
].join(' && ')
```

### Polygon search

Typesense supports polygon filtering:

```typescript
filter_by: 'location:(34.7, -86.6, 34.8, -86.5, 34.75, -86.4)'
```

Each pair is a vertex of the polygon.

### Exclude by radius

```typescript
// Exclude houses within 2 miles
filter_by: 'location:!(34.7304, -86.5861, 2 mi)'
```

## Semantic and Hybrid Search

### Semantic search only

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'quiet home with a fenced yard near good schools',
    query_by: 'embedding',
    filter_by: [
      'listing_status:=active',
      'price:>=300000',
      'price:<=600000',
      'bedrooms:>=3'
    ].join(' && '),
    facet_by: 'city_facet,neighborhood_facet,property_type_facet',
    per_page: 20
  });
```

### Hybrid search

Include both text fields and embedding field in `query_by`:

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hampton cove family home with mountain views',
    query_by: [
      'title',
      'description',
      'city',
      'neighborhood',
      'school_district',
      'zip_code',
      'embedding'
    ].join(','),
    filter_by: [
      'listing_status:=active',
      'price:>=300000',
      'price:<=600000',
      'bedrooms:>=3',
      'has_garage:=true',
      'location:(34.7304, -86.5861, 10 mi)'
    ].join(' && '),
    facet_by: [
      'city_facet',
      'neighborhood_facet',
      'property_type_facet',
      'school_district_facet',
      'bedrooms',
      'has_pool',
      'has_garage'
    ].join(','),
    sort_by: 'location(34.7304, -86.5861):asc',
    per_page: 20
  });
```

### Field weights

Control importance of different fields:

```typescript
query_by: 'title,description,city,embedding',
query_by_weights: '3,2,2,1'  // Title 3x, description/city 2x, embedding 1x
```

### Vector query

For semantic-only search with explicit vector:

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: '*',
    vector_query: `embedding:([0.123, -0.456, ...], k:20)`,
    filter_by: 'listing_status:=active'
  });
```

## Sorting

### Basic sorting

```typescript
sort_by: 'price:asc'
sort_by: 'price:desc'
sort_by: 'square_feet:desc'
```

### Multiple sort fields

```typescript
sort_by: 'listing_status:asc,price:asc'
```

### Sort by distance

```typescript
sort_by: 'location(34.7304, -86.5861):asc'
```

### Sort with text match

```typescript
sort_by: '_text_match:desc,price:asc'
```

`_text_match` is relevance score. Use as primary sort to maintain search relevance.

### Custom ranking

```typescript
// Boost specific criteria
sort_by: '_text_match:desc,has_garage:desc,price:asc'
```

## Typo Tolerance

Typesense has built-in typo tolerance:

### Configure per query

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hamton cove',  // Typo in "hampton"
    query_by: 'title,description,city',
    num_typos: 2,  // Allow up to 2 typos
    typo_tokens_threshold: 1  // Minimum tokens before enabling typo tolerance
  });
```

### Per-field typo tolerance

```typescript
const results = await client
  .collections('houses')
  .documents()
  .search({
    q: 'hampton',
    query_by: 'title,description,zip_code',
    num_typos: '2,1,0'  // 2 typos for title, 1 for description, 0 for zip_code
  });
```

### Typo tolerance modes

- `num_typos: 0` - No typos allowed
- `num_typos: 1` - Up to 1 typo
- `num_typos: 2` - Up to 2 typos (default)

## Synonyms

### One-way synonyms

```typescript
await client
  .collections('houses')
  .synonyms()
  .upsert('home-synonyms', {
    synonyms: ['home', 'house', 'property', 'residence']
  });
```

When user searches "home", it also matches "house", "property", "residence".

### Multi-directional synonyms

```typescript
await client
  .collections('houses')
  .synonyms()
  .upsert('bedroom-synonyms', {
    synonyms: ['br', 'bedroom', 'bedrooms']
  });

await client
  .collections('houses')
  .synonyms()
  .upsert('bathroom-synonyms', {
    synonyms: ['ba', 'bath', 'bathroom', 'bathrooms']
  });
```

### Retrieve synonyms

```typescript
const synonyms = await client
  .collections('houses')
  .synonyms()
  .retrieve();
```

## Syncing from PostgreSQL

### Full sync

```typescript
import { pool } from './db';
import Typesense from 'typesense';

const client = new Typesense.Client({
  nodes: [{ host: 'search.example.com', port: 443, protocol: 'https' }],
  apiKey: 'your_api_key'
});

async function syncHouses() {
  const result = await pool.query(`
    SELECT
      id,
      title,
      description,
      city,
      state,
      county,
      neighborhood,
      zip_code,
      lat,
      lng,
      price,
      bedrooms,
      bathrooms,
      square_feet,
      lot_size_acres,
      year_built,
      property_type,
      listing_status,
      school_district,
      has_pool,
      has_garage,
      has_basement,
      has_fenced_yard,
      waterfront,
      new_construction,
      tags
    FROM houses
    WHERE listing_status = 'active'
  `);
  
  const documents = result.rows.map(row => ({
    id: row.id,
    title: row.title,
    description: row.description,
    city: row.city,
    state: row.state,
    county: row.county,
    neighborhood: row.neighborhood,
    zip_code: row.zip_code,
    location: [row.lat, row.lng],
    price: row.price,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    square_feet: row.square_feet,
    lot_size_acres: row.lot_size_acres,
    year_built: row.year_built,
    property_type: row.property_type,
    listing_status: row.listing_status,
    school_district: row.school_district,
    has_pool: row.has_pool,
    has_garage: row.has_garage,
    has_basement: row.has_basement,
    has_fenced_yard: row.has_fenced_yard,
    waterfront: row.waterfront,
    new_construction: row.new_construction,
    tags: row.tags,
    // Facet fields
    city_facet: row.city,
    state_facet: row.state,
    county_facet: row.county,
    neighborhood_facet: row.neighborhood,
    property_type_facet: row.property_type,
    listing_status_facet: row.listing_status,
    school_district_facet: row.school_district
  }));
  
  // Batch import with upsert
  const jsonl = documents.map(doc => JSON.stringify(doc)).join('\n');
  
  await client
    .collections('houses')
    .documents()
    .import(jsonl, { action: 'upsert' });
}
```

### Incremental sync

```typescript
async function syncHousesIncremental(since: Date) {
  const result = await pool.query(
    `SELECT * FROM houses WHERE updated_at >= $1`,
    [since]
  );
  
  const documents = result.rows.map(transformToSearchDocument);
  
  if (documents.length > 0) {
    const jsonl = documents.map(doc => JSON.stringify(doc)).join('\n');
    await client.collections('houses').documents().import(jsonl, { action: 'upsert' });
  }
}
```

### Delete removed documents

```typescript
async function syncDeletes() {
  // Get IDs that should be deleted
  const result = await pool.query(`
    SELECT id FROM houses_deleted 
    WHERE deleted_at >= $1
  `, [lastSyncTime]);
  
  const idsToDelete = result.rows.map(r => r.id);
  
  if (idsToDelete.length > 0) {
    await client
      .collections('houses')
      .documents()
      .delete({ filter_by: `id:=[${idsToDelete.join(',')}]` });
  }
}
```

## Frontend Integration

Typesense has excellent InstantSearch.js support:

### Installation

```bash
npm install typesense typesense-instantsearch-adapter instantsearch.js
```

### Angular component

```typescript
import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';
import {
  searchBox,
  hits,
  refinementList,
  rangeSlider,
  stats,
  pagination,
  currentRefinements,
  clearRefinements,
  sortBy
} from 'instantsearch.js/es/widgets';

@Component({
  selector: 'app-house-search',
  templateUrl: './house-search.component.html'
})
export class HouseSearchComponent implements AfterViewInit, OnDestroy {
  private search?: any;

  ngAfterViewInit() {
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
        ].join(',')
      }
    });

    this.search = instantsearch({
      indexName: 'houses',
      searchClient: adapter.searchClient,
      routing: true
    });

    this.search.addWidgets([
      searchBox({
        container: '#searchbox',
        placeholder: 'Search by city, neighborhood, school, or features'
      }),
      
      stats({ container: '#stats' }),
      currentRefinements({ container: '#current-refinements' }),
      clearRefinements({ container: '#clear-refinements' }),
      
      refinementList({
        container: '#city-facet',
        attribute: 'city_facet',
        searchable: true,
        searchablePlaceholder: 'Search cities',
        limit: 10,
        showMore: true
      }),
      
      refinementList({
        container: '#neighborhood-facet',
        attribute: 'neighborhood_facet',
        searchable: true,
        limit: 10,
        showMore: true
      }),
      
      refinementList({
        container: '#property-type-facet',
        attribute: 'property_type_facet'
      }),
      
      refinementList({
        container: '#bedrooms-facet',
        attribute: 'bedrooms'
      }),
      
      refinementList({
        container: '#amenities-facet',
        attribute: 'tags',
        limit: 8
      }),
      
      rangeSlider({
        container: '#price-range',
        attribute: 'price',
        tooltips: {
          format: (value: number) => `$${value.toLocaleString()}`
        }
      }),
      
      rangeSlider({
        container: '#square-feet-range',
        attribute: 'square_feet'
      }),
      
      sortBy({
        container: '#sort-by',
        items: [
          { label: 'Relevance', value: 'houses' },
          { label: 'Price low to high', value: 'houses/sort/price:asc' },
          { label: 'Price high to low', value: 'houses/sort/price:desc' },
          { label: 'Newest', value: 'houses/sort/days_on_market:asc' },
          { label: 'Largest', value: 'houses/sort/square_feet:desc' }
        ]
      }),
      
      hits({
        container: '#hits',
        templates: {
          item: `
            <article class="house-card">
              <h2>{{#helpers.highlight}}{ "attribute": "title" }{{/helpers.highlight}}</h2>
              <p>{{city}}, {{state}} · {{neighborhood}}</p>
              <p>
                <strong>\${{price}}</strong>
                · {{bedrooms}} bd
                · {{bathrooms}} ba
                · {{square_feet}} sqft
              </p>
              <p>{{property_type}} · {{school_district}}</p>
              {{#tags}}
                <span class="tag">{{.}}</span>
              {{/tags}}
            </article>
          `
        }
      }),
      
      pagination({ container: '#pagination' })
    ]);

    this.search.start();
  }

  ngOnDestroy() {
    this.search?.dispose();
  }
}
```

## Performance and Scaling

### Indexing performance

- **Batch imports**: Use JSONL format for best performance
- **Upsert mode**: Efficient for updates
- **Parallel imports**: Split large datasets

```typescript
// Efficient batch import
const jsonl = documents.map(doc => JSON.stringify(doc)).join('\n');
await client.collections('houses').documents().import(jsonl, { 
  action: 'upsert',
  batch_size: 1000
});
```

### Search performance

- Fast text search (<10ms typical)
- Vector search adds 10-50ms
- Facets add minimal overhead
- Geo queries are fast

### Scaling strategies

1. **Vertical scaling** - Increase server resources
2. **Replication** - Multiple nodes for high availability
3. **Sharding** - Split large collections
4. **Caching** - Cache common queries

### High availability cluster

```typescript
const client = new Typesense.Client({
  nodes: [
    { host: 'node1.example.com', port: 443, protocol: 'https' },
    { host: 'node2.example.com', port: 443, protocol: 'https' },
    { host: 'node3.example.com', port: 443, protocol: 'https' }
  ],
  apiKey: 'your_api_key',
  connectionTimeoutSeconds: 2,
  numRetries: 3,
  retryIntervalSeconds: 0.1
});
```

### Monitoring

```typescript
// Health check
const health = await client.health.retrieve();

// Collection stats
const stats = await client.collections('houses').retrieve();
console.log(stats.num_documents);

// Search analytics (if enabled)
const analytics = await client.analytics.rules().retrieve();
```

## Best Practices

1. **Schema Design**
   - Use wildcard patterns (`*_facet`) for convention-based fields
   - Enable faceting only where needed
   - Use appropriate field types

2. **Embedding Strategy**
   - Explicitly list fields in `embed.from`
   - Only include semantic fields
   - Exclude structured data (price, dates)

3. **Hybrid Search**
   - Include both text and embedding fields in `query_by`
   - Tune field weights based on query types
   - Test with real user queries

4. **Faceting**
   - Use descriptive facet field names
   - Limit facet values with `max_facet_values`
   - Consider searchable facets for large value sets

5. **Performance**
   - Batch document imports
   - Use incremental syncing
   - Monitor embedding regeneration costs
   - Cache common searches

6. **Frontend**
   - Use InstantSearch adapter for rapid development
   - Implement proper error handling
   - Add loading states
   - Use query suggestions

7. **Geo Search**
   - Store locations as geopoint type
   - Use appropriate radius units (miles/km)
   - Consider polygon filtering for complex areas

8. **Monitoring**
   - Track search latency
   - Monitor index size
   - Watch embedding costs (if using external)
   - Log sync failures
