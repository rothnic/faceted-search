# Meilisearch

Complete guide for implementing faceted, geo-aware, and semantic search using Meilisearch.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Document Structure](#document-structure)
- [Index Configuration](#index-configuration)
- [Embedders and Semantic Search](#embedders-and-semantic-search)
- [Search Queries](#search-queries)
- [Facets and Filters](#facets-and-filters)
- [Geo Search](#geo-search)
- [Hybrid Search](#hybrid-search)
- [Sorting](#sorting)
- [Typo Tolerance](#typo-tolerance)
- [Synonyms and Stop Words](#synonyms-and-stop-words)
- [Syncing from PostgreSQL](#syncing-from-postgresql)
- [Frontend Integration](#frontend-integration)
- [Performance and Scaling](#performance-and-scaling)

## Overview

Meilisearch is a dedicated search engine with excellent defaults:

- **Fast setup** - Production-ready with minimal configuration
- **Typo tolerance** - Built-in fuzzy matching
- **Search-as-you-type** - Optimized for instant results
- **Faceting** - Simple, powerful faceted search
- **Geo search** - Built-in location filtering and sorting
- **Semantic search** - Managed embedding generation
- **Hybrid search** - Combines keyword and semantic search
- **InstantSearch.js** - Direct adapter available

**Best for:** Fast product implementation, MVPs, startups wanting polished search quickly

## Installation

### Docker

```bash
docker run -p 7700:7700 \
  -e MEILI_MASTER_KEY=your_master_key \
  -v $(pwd)/meili_data:/meili_data \
  getmeili/meilisearch:latest
```

### Cloud

- Meilisearch Cloud (managed)
- Self-hosted on any cloud provider
- Platform.sh, DigitalOcean, AWS, GCP, Azure

### Local development

```bash
curl -L https://install.meilisearch.com | sh
./meilisearch --master-key=your_master_key
```

## Document Structure

Meilisearch works with JSON documents. Design documents to be denormalized and search-friendly:

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
  
  "_geo": {
    "lat": 34.6532,
    "lng": -86.4778
  },
  
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
  
  "hoa_fee": 450,
  "days_on_market": 18,
  
  "tags": ["mountain_view", "family_friendly", "near_trails"],
  
  "city_facet": "Owens Cross Roads",
  "state_facet": "AL",
  "county_facet": "Madison",
  "neighborhood_facet": "Hampton Cove",
  "property_type_facet": "single_family",
  "listing_status_facet": "active",
  "school_district_facet": "Madison County"
}
```

### Key conventions

- **`_geo` field** - Special field for geo search (must have `lat` and `lng`)
- **Facet fields** - Suffix with `_facet` for clarity (optional but recommended)
- **Primary key** - Use `id` or configure custom primary key

## Index Configuration

### Creating an index

```typescript
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
  host: 'https://search.example.com',
  apiKey: 'MEILI_MASTER_KEY'
});

// Create index
await client.createIndex('houses', { primaryKey: 'id' });
```

### Configuring searchable attributes

```typescript
await client.index('houses').updateSettings({
  searchableAttributes: [
    'title',
    'description',
    'city',
    'neighborhood',
    'school_district',
    'zip_code',
    'tags'
  ]
});
```

Fields are searched in order. Put most important fields first.

### Configuring filterable attributes

```typescript
await client.index('houses').updateSettings({
  filterableAttributes: [
    'city_facet',
    'state_facet',
    'county_facet',
    'neighborhood_facet',
    'property_type_facet',
    'listing_status_facet',
    'school_district_facet',
    'price',
    'bedrooms',
    'bathrooms',
    'square_feet',
    'lot_size_acres',
    'year_built',
    'has_pool',
    'has_garage',
    'has_basement',
    'has_fenced_yard',
    'waterfront',
    'new_construction',
    '_geo'
  ]
});
```

### Configuring sortable attributes

```typescript
await client.index('houses').updateSettings({
  sortableAttributes: [
    'price',
    'square_feet',
    'days_on_market',
    'year_built'
  ]
});
```

### Complete settings example

```typescript
await client.index('houses').updateSettings({
  searchableAttributes: [
    'title',
    'description',
    'city',
    'neighborhood',
    'school_district',
    'zip_code',
    'tags'
  ],
  
  filterableAttributes: [
    'city_facet',
    'state_facet',
    'neighborhood_facet',
    'property_type_facet',
    'listing_status_facet',
    'school_district_facet',
    'price',
    'bedrooms',
    'bathrooms',
    'has_pool',
    'has_garage',
    'has_basement',
    'has_fenced_yard',
    'waterfront',
    'new_construction',
    '_geo'
  ],
  
  sortableAttributes: [
    'price',
    'square_feet',
    'days_on_market',
    '_geo'
  ],
  
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness'
  ],
  
  distinctAttribute: null,
  
  stopWords: [],
  
  synonyms: {
    'home': ['house', 'property'],
    'apartment': ['apt', 'condo', 'flat'],
    'br': ['bedroom', 'bedrooms'],
    'ba': ['bath', 'bathroom', 'bathrooms']
  }
});
```

## Embedders and Semantic Search

Meilisearch can generate embeddings automatically using configured embedders.

### Configure OpenAI embedder

```typescript
await client.index('houses').updateEmbedders({
  'houses-openai': {
    source: 'openAi',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    documentTemplate: `House: {{doc.title}}. 
Description: {{doc.description}}. 
Location: {{doc.neighborhood}}, {{doc.city}}, {{doc.state}}. 
School district: {{doc.school_district}}. 
Property type: {{doc.property_type}}. 
Bedrooms: {{doc.bedrooms}}. 
Bathrooms: {{doc.bathrooms}}. 
Features: {{doc.tags}}.`
  }
});
```

### Document template best practices

**Do include:**
- title
- description
- location context (city, neighborhood)
- categorical attributes (property_type, school_district)
- meaningful features/tags

**Don't include:**
- price (use filter)
- exact numbers (bedrooms/bathrooms - mention for context but don't emphasize)
- dates
- IDs
- boolean flags without context

### Supported embedders

```typescript
// OpenAI
{
  source: 'openAi',
  apiKey: 'your_key',
  model: 'text-embedding-3-small',
  dimensions: 1536
}

// HuggingFace
{
  source: 'huggingFace',
  model: 'sentence-transformers/all-MiniLM-L6-v2'
}

// User-provided embeddings
{
  source: 'userProvided',
  dimensions: 1536
}
```

### How embeddings are managed

When you configure an embedder:
1. Meilisearch generates embeddings for all documents
2. Embeddings are cached
3. Only changed documents are re-embedded
4. Batching is automatic
5. No manual embedding generation needed

### Updating embeddings

Embeddings regenerate automatically when documents change:

```typescript
// Update document - embedding regenerates automatically
await client.index('houses').updateDocuments([
  {
    id: 'house_1001',
    description: 'Updated description...'
  }
]);
```

If the document template fields haven't changed, embedding is reused from cache.

## Search Queries

### Basic keyword search

```typescript
const results = await client.index('houses').search('hampton cove garage', {
  limit: 20,
  offset: 0
});
```

### With filters

```typescript
const results = await client.index('houses').search('hampton cove', {
  filter: [
    'listing_status_facet = active',
    'price >= 300000',
    'price <= 600000',
    'bedrooms >= 3'
  ],
  limit: 20
});
```

### With facets

```typescript
const results = await client.index('houses').search('hampton cove', {
  filter: [
    'listing_status_facet = active'
  ],
  facets: [
    'city_facet',
    'neighborhood_facet',
    'property_type_facet',
    'school_district_facet',
    'bedrooms',
    'has_pool',
    'has_garage'
  ],
  limit: 20
});
```

Response includes:
```json
{
  "hits": [...],
  "facetDistribution": {
    "city_facet": {
      "Huntsville": 620,
      "Madison": 310,
      "Owens Cross Roads": 82
    },
    "property_type_facet": {
      "single_family": 880,
      "townhouse": 170
    }
  },
  "estimatedTotalHits": 1240
}
```

### Semantic search

```typescript
const results = await client.index('houses').search(
  'quiet home with a large yard near good schools',
  {
    hybrid: {
      embedder: 'houses-openai',
      semanticRatio: 1.0  // 1.0 = semantic only
    },
    filter: [
      'listing_status_facet = active',
      'price >= 300000',
      'price <= 600000',
      'bedrooms >= 3'
    ],
    facets: [
      'city_facet',
      'neighborhood_facet',
      'property_type_facet'
    ]
  }
);
```

## Facets and Filters

### Filter syntax

```typescript
// Equality
'city_facet = "Huntsville"'

// Inequality
'price >= 300000'
'price <= 600000'

// Array membership
'city_facet IN ["Huntsville", "Madison"]'

// Boolean
'has_garage = true'

// Multiple conditions (AND)
filter: [
  'listing_status_facet = active',
  'price >= 300000',
  'bedrooms >= 3'
]

// OR conditions
'city_facet = "Huntsville" OR city_facet = "Madison"'

// Complex
'(city_facet = "Huntsville" OR city_facet = "Madison") AND price >= 300000'
```

### Facet distribution

```typescript
const results = await client.index('houses').search('', {
  filter: ['listing_status_facet = active'],
  facets: ['city_facet', 'property_type_facet', 'bedrooms'],
  limit: 0  // Only get facets, no hits
});

console.log(results.facetDistribution);
// {
//   "city_facet": { "Huntsville": 620, "Madison": 310 },
//   "property_type_facet": { "single_family": 880 },
//   "bedrooms": { "3": 410, "4": 370 }
// }
```

### Facet stats (numeric)

Meilisearch doesn't provide min/max stats directly. For range sliders, query for all values or maintain stats separately.

## Geo Search

Meilisearch has built-in geo support via the `_geo` field.

### Radius search

```typescript
const results = await client.index('houses').search('', {
  filter: [
    'listing_status_facet = active',
    '_geoRadius(34.7304, -86.5861, 16093)'  // lat, lng, radius in meters
  ],
  limit: 20
});
```

### Bounding box search

```typescript
const results = await client.index('houses').search('', {
  filter: [
    'listing_status_facet = active',
    '_geoBoundingBox([34.8, -86.7], [34.6, -86.4])'  // [lat, lng] top-left, bottom-right
  ],
  limit: 20
});
```

### Sort by distance

```typescript
const results = await client.index('houses').search('', {
  filter: ['listing_status_facet = active'],
  sort: ['_geoPoint(34.7304, -86.5861):asc'],
  limit: 20
});
```

### Combined search with geo

```typescript
const results = await client.index('houses').search('hampton cove', {
  filter: [
    'listing_status_facet = active',
    '_geoRadius(34.7304, -86.5861, 16093)',
    'price >= 300000',
    'bedrooms >= 3'
  ],
  sort: ['_geoPoint(34.7304, -86.5861):asc'],
  facets: ['city_facet', 'property_type_facet'],
  limit: 20
});
```

## Hybrid Search

Hybrid search combines keyword and semantic search:

```typescript
const results = await client.index('houses').search(
  'hampton cove family home with mountain views',
  {
    hybrid: {
      embedder: 'houses-openai',
      semanticRatio: 0.5  // Balance keyword and semantic
    },
    filter: [
      'listing_status_facet = active',
      '_geoRadius(34.7304, -86.5861, 16093)',
      'price >= 300000',
      'price <= 600000',
      'bedrooms >= 3',
      'has_garage = true'
    ],
    facets: [
      'city_facet',
      'neighborhood_facet',
      'property_type_facet',
      'school_district_facet',
      'bedrooms',
      'has_pool',
      'has_garage'
    ],
    sort: ['_geoPoint(34.7304, -86.5861):asc']
  }
);
```

### Semantic ratio tuning

- **0.0** - Keyword only
- **0.3** - Mostly keyword, semantic assist
- **0.5** - Balanced hybrid (recommended default)
- **0.8** - Mostly semantic, keyword assist
- **1.0** - Semantic only

Choose based on query type:
- Exact terms (addresses, IDs) → Lower ratio (0.0-0.3)
- Intent-based ("quiet family home") → Higher ratio (0.7-1.0)
- Mixed queries → Balanced (0.4-0.6)

## Sorting

### Available sort options

```typescript
// Price ascending
sort: ['price:asc']

// Price descending
sort: ['price:desc']

// Multiple sort criteria
sort: ['price:asc', 'square_feet:desc']

// Distance (geo)
sort: ['_geoPoint(34.7304, -86.5861):asc']

// Combined
sort: ['_geoPoint(34.7304, -86.5861):asc', 'price:asc']
```

### Sort with search relevance

By default, results are sorted by relevance. To sort by attribute while preserving relevance:

```typescript
// Custom ranking rule
await client.index('houses').updateSettings({
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',      // Sort rule position matters
    'exactness'
  ]
});

// Then search with sort
const results = await client.index('houses').search('hampton cove', {
  sort: ['price:asc']
});
```

## Typo Tolerance

Meilisearch has built-in typo tolerance:

```typescript
// These all match "Hampton Cove":
// "hamton cove"
// "hampton cove"
// "Hampton Cove"
// "haMpton CovE"
```

### Configure typo tolerance

```typescript
await client.index('houses').updateSettings({
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 5,   // Allow 1 typo for words >= 5 chars
      twoTypos: 9   // Allow 2 typos for words >= 9 chars
    },
    disableOnWords: ['app', 'condo'],
    disableOnAttributes: ['zip_code']
  }
});
```

## Synonyms and Stop Words

### Configure synonyms

```typescript
await client.index('houses').updateSettings({
  synonyms: {
    'home': ['house', 'property', 'residence'],
    'apartment': ['apt', 'condo', 'flat', 'unit'],
    'br': ['bedroom', 'bedrooms'],
    'ba': ['bath', 'bathroom', 'bathrooms'],
    'sqft': ['square feet', 'sq ft'],
    'garage': ['carport', 'parking']
  }
});
```

### Configure stop words

```typescript
await client.index('houses').updateSettings({
  stopWords: ['the', 'a', 'an']
});
```

Note: Meilisearch has minimal default stop words. Add more if needed.

## Syncing from PostgreSQL

Meilisearch is not the source of truth. Sync from PostgreSQL:

### Simple sync script

```typescript
import { pool } from './db';
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
  host: process.env.MEILI_HOST,
  apiKey: process.env.MEILI_API_KEY
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
      hoa_fee,
      days_on_market,
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
    _geo: {
      lat: row.lat,
      lng: row.lng
    },
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
    hoa_fee: row.hoa_fee,
    days_on_market: row.days_on_market,
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
  
  await client.index('houses').addDocuments(documents);
}

// Run periodically
syncHouses();
```

### Incremental sync

```typescript
async function syncHousesIncremental(since: Date) {
  const result = await pool.query(
    `
    SELECT * FROM houses
    WHERE updated_at >= $1
    `,
    [since]
  );
  
  const documents = result.rows.map(transformToSearchDocument);
  
  if (documents.length > 0) {
    await client.index('houses').addDocuments(documents);
  }
}
```

### Delete removed houses

```typescript
async function syncDeletes() {
  // Get all IDs from Meilisearch
  const searchResults = await client.index('houses').search('', {
    limit: 10000,
    attributesToRetrieve: ['id']
  });
  
  const meiliIds = new Set(searchResults.hits.map(h => h.id));
  
  // Get all IDs from Postgres
  const pgResult = await pool.query('SELECT id FROM houses WHERE listing_status = $1', ['active']);
  const pgIds = new Set(pgResult.rows.map(r => r.id));
  
  // Find IDs in Meili but not in Postgres
  const toDelete = [...meiliIds].filter(id => !pgIds.has(id));
  
  if (toDelete.length > 0) {
    await client.index('houses').deleteDocuments(toDelete);
  }
}
```

## Frontend Integration

Meilisearch has excellent InstantSearch.js support:

### Installation

```bash
npm install meilisearch @meilisearch/instant-meilisearch instantsearch.js
```

### Angular component

```typescript
import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import instantsearch from 'instantsearch.js';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import {
  searchBox,
  hits,
  refinementList,
  rangeSlider,
  stats,
  pagination,
  currentRefinements,
  clearRefinements
} from 'instantsearch.js/es/widgets';

@Component({
  selector: 'app-house-search',
  templateUrl: './house-search.component.html'
})
export class HouseSearchComponent implements AfterViewInit, OnDestroy {
  private search?: any;

  ngAfterViewInit() {
    const { searchClient } = instantMeiliSearch(
      'https://search.example.com',
      'MEILI_SEARCH_KEY',
      {
        primaryKey: 'id'
      }
    );

    this.search = instantsearch({
      indexName: 'houses',
      searchClient,
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
        searchablePlaceholder: 'Search cities'
      }),
      
      refinementList({
        container: '#neighborhood-facet',
        attribute: 'neighborhood_facet',
        searchable: true
      }),
      
      refinementList({
        container: '#property-type-facet',
        attribute: 'property_type_facet'
      }),
      
      refinementList({
        container: '#bedrooms-facet',
        attribute: 'bedrooms'
      }),
      
      rangeSlider({
        container: '#price-range',
        attribute: 'price'
      }),
      
      rangeSlider({
        container: '#square-feet-range',
        attribute: 'square_feet'
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

- Batch document uploads (1000-10000 at a time)
- Use async/await for task completion
- Monitor task queue

```typescript
const task = await client.index('houses').addDocuments(documents);

// Wait for completion
await client.waitForTask(task.taskUid);
```

### Search performance

- Meilisearch is typically sub-10ms for most queries
- Facets add minimal overhead
- Geo queries are fast
- Semantic search adds 10-50ms depending on embedder

### Scaling

- **Single instance**: Up to millions of documents
- **Replica scaling**: Read replicas for high query volume
- **Index splitting**: Separate indexes for different regions/categories
- **Caching**: CDN for static responses

### Monitoring

```typescript
const health = await client.health();
const stats = await client.index('houses').getStats();

console.log(stats);
// {
//   numberOfDocuments: 15420,
//   isIndexing: false,
//   fieldDistribution: { ... }
// }
```

## Best Practices

1. **Configuration**
   - Configure filterable/sortable attributes before indexing
   - Plan facet fields early (difficult to change later)
   - Use descriptive attribute names

2. **Document Templates**
   - Keep templates focused on meaning, not structure
   - Exclude numeric fields from embeddings
   - Test template quality with sample queries

3. **Semantic Ratio**
   - Start with 0.5 (balanced)
   - Tune per query type
   - Monitor search quality metrics

4. **Syncing**
   - Run incremental syncs frequently
   - Handle deletes explicitly
   - Monitor sync lag

5. **Frontend**
   - Use InstantSearch.js for rapid development
   - Implement proper loading states
   - Handle errors gracefully

6. **Monitoring**
   - Track search latency
   - Monitor embedding costs
   - Watch index size growth
