# pg_search Extension

Complete guide for implementing faceted, geo-aware, and semantic search using the pg_search extension.

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Table Schema](#table-schema)
- [BM25 Index](#bm25-index)
- [Full-Text Search with BM25](#full-text-search-with-bm25)
- [Semantic Search](#semantic-search)
- [Hybrid Search](#hybrid-search)
- [Faceted Search](#faceted-search)
- [Geo Search](#geo-search)
- [Embedding Management](#embedding-management)
- [Frontend Integration](#frontend-integration)
- [Performance Tuning](#performance-tuning)
- [When to Use pg_search](#when-to-use-pg_search)

## Overview

The `pg_search` extension is a Postgres extension that brings search-engine-style capabilities into Postgres:

- **BM25 ranking** for better text search relevance
- **Faceted search** with aggregations
- **Filtering** with search-engine-like syntax
- Combines with **pgvector** for hybrid search
- Combines with **PostGIS** for geo search
- **SQL-based** architecture keeps everything in Postgres

**Best for:** Postgres-first teams wanting search-engine features without external services

## Installation

```sql
CREATE EXTENSION IF NOT EXISTS pg_search;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
```

Note: Installation steps vary by deployment method. See ParadeDB docs for:
- Docker images
- Cloud installations
- Self-hosted setup

## Table Schema

Same base schema as native Postgres, with additional considerations for BM25 indexing:

```sql
CREATE TABLE houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Text fields (searchable)
  title text NOT NULL,
  description text,
  
  -- Location
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  neighborhood text,
  county text,
  
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geom geography(Point, 4326),
  
  -- Structured attributes (filterable/facetable)
  price integer NOT NULL,
  bedrooms integer NOT NULL,
  bathrooms numeric NOT NULL,
  square_feet integer NOT NULL,
  lot_size_acres numeric,
  year_built integer,
  
  property_type text NOT NULL,
  listing_status text NOT NULL,
  school_district text,
  
  -- Amenities (filterable/facetable)
  has_pool boolean DEFAULT false,
  has_garage boolean DEFAULT false,
  has_basement boolean DEFAULT false,
  has_fenced_yard boolean DEFAULT false,
  waterfront boolean DEFAULT false,
  new_construction boolean DEFAULT false,
  
  hoa_fee integer,
  days_on_market integer,
  
  -- Semantic search fields
  semantic_text text,
  embedding vector(1536),
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## BM25 Index

ParadeDB uses a special BM25 index for full-text search with better relevance than native tsvector:

```sql
CREATE INDEX houses_search_idx
ON houses
USING bm25 (
  id,
  title,
  description,
  city,
  state,
  neighborhood,
  county,
  zip_code,
  property_type,
  listing_status,
  school_district,
  price,
  bedrooms,
  bathrooms,
  square_feet,
  lot_size_acres,
  year_built,
  has_pool,
  has_garage,
  has_basement,
  has_fenced_yard,
  waterfront,
  new_construction,
  days_on_market
)
WITH (key_field = 'id');
```

### Index configuration options

```sql
CREATE INDEX houses_search_idx
ON houses
USING bm25 (
  id,
  title,
  description
)
WITH (
  key_field = 'id',
  text_fields = '{
    "title": {"tokenizer": {"type": "en_stem"}},
    "description": {"tokenizer": {"type": "en_stem"}}
  }',
  numeric_fields = '{
    "price": {"fast": true},
    "bedrooms": {"fast": true}
  }',
  boolean_fields = '{
    "has_pool": {"fast": true},
    "has_garage": {"fast": true}
  }'
);
```

### Additional indexes for semantic and geo

```sql
-- pgvector for semantic search
CREATE INDEX houses_embedding_hnsw_idx
ON houses
USING hnsw (embedding vector_cosine_ops);

-- PostGIS for geo search
CREATE INDEX houses_geom_idx
ON houses
USING gist (geom);
```

## Full-Text Search with BM25

### Basic BM25 search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  pdb.score(id) AS bm25_score
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
ORDER BY bm25_score DESC
LIMIT 20;
```

The `@@@` operator invokes BM25 search.

### Multi-field search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  pdb.score(id) AS bm25_score
FROM houses
WHERE (title @@@ $1 OR description @@@ $1 OR city @@@ $1)
  AND listing_status = 'active'
ORDER BY bm25_score DESC
LIMIT 20;
```

### With filters

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  pdb.score(id) AS bm25_score
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
  AND price BETWEEN $2 AND $3
  AND bedrooms >= $4
  AND city = ANY($5)
ORDER BY bm25_score DESC
LIMIT 20;
```

### Phrase search

```sql
SELECT
  id,
  title,
  pdb.score(id) AS bm25_score
FROM houses
WHERE title @@@ '"mountain view"'
  AND listing_status = 'active'
ORDER BY bm25_score DESC
LIMIT 20;
```

### Boolean operators

```sql
SELECT
  id,
  title,
  pdb.score(id) AS bm25_score
FROM houses
WHERE title @@@ 'hampton AND cove'
  AND listing_status = 'active'
ORDER BY bm25_score DESC
LIMIT 20;
```

Supported operators:
- `AND` - Both terms must match
- `OR` - Either term must match
- `NOT` - Term must not match
- `"phrase"` - Exact phrase match

## Semantic Search

ParadeDB doesn't manage embeddings. Combine with pgvector for semantic search:

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  1 - (embedding <=> $1) AS semantic_score
FROM houses
WHERE listing_status = 'active'
  AND price BETWEEN $2 AND $3
ORDER BY embedding <=> $1
LIMIT 20;
```

## Hybrid Search

Combine ParadeDB BM25 with pgvector using Reciprocal Rank Fusion:

```sql
WITH
lexical AS (
  SELECT
    id,
    row_number() OVER (ORDER BY pdb.score(id) DESC) AS rank
  FROM houses
  WHERE title @@@ $1
    AND listing_status = 'active'
  LIMIT 200
),
semantic AS (
  SELECT
    id,
    row_number() OVER (ORDER BY embedding <=> $2) AS rank
  FROM houses
  WHERE listing_status = 'active'
  LIMIT 200
),
combined AS (
  SELECT
    id,
    sum(score) AS hybrid_score
  FROM (
    SELECT id, 1.0 / (60 + rank) AS score FROM lexical
    UNION ALL
    SELECT id, 1.0 / (60 + rank) AS score FROM semantic
  ) ranked
  GROUP BY id
)
SELECT
  h.id,
  h.title,
  h.city,
  h.state,
  h.price,
  h.bedrooms,
  h.bathrooms,
  h.square_feet,
  combined.hybrid_score
FROM combined
JOIN houses h ON h.id = combined.id
WHERE h.price BETWEEN $3 AND $4
  AND h.bedrooms >= $5
ORDER BY combined.hybrid_score DESC
LIMIT 20;
```

### Adjustable hybrid weights

```sql
WITH
lexical AS (
  SELECT
    id,
    row_number() OVER (ORDER BY pdb.score(id) DESC) AS rank
  FROM houses
  WHERE title @@@ $1
    AND listing_status = 'active'
  LIMIT 200
),
semantic AS (
  SELECT
    id,
    row_number() OVER (ORDER BY embedding <=> $2) AS rank
  FROM houses
  WHERE listing_status = 'active'
  LIMIT 200
),
combined AS (
  SELECT
    id,
    sum(score) AS hybrid_score
  FROM (
    SELECT id, $6 * (1.0 / (60 + rank)) AS score FROM lexical
    UNION ALL
    SELECT id, (1.0 - $6) * (1.0 / (60 + rank)) AS score FROM semantic
  ) ranked
  GROUP BY id
)
SELECT
  h.id,
  h.title,
  h.city,
  h.state,
  h.price,
  h.bedrooms,
  combined.hybrid_score
FROM combined
JOIN houses h ON h.id = combined.id
WHERE h.price BETWEEN $3 AND $4
  AND h.bedrooms >= $5
ORDER BY combined.hybrid_score DESC
LIMIT 20;
```

## Faceted Search

ParadeDB supports faceted search through aggregations:

### Basic facets

```sql
SELECT
  id AS "objectID",
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  property_type,
  pdb.score(id) AS score,
  pdb.agg('{
    "property_type": {
      "terms": { "field": "property_type" }
    },
    "city": {
      "terms": { "field": "city" }
    },
    "bedrooms": {
      "terms": { "field": "bedrooms" }
    }
  }') OVER () AS facets
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
ORDER BY score DESC
LIMIT 20;
```

### Numeric range facets

```sql
SELECT
  id AS "objectID",
  title,
  city,
  price,
  bedrooms,
  pdb.score(id) AS score,
  pdb.agg('{
    "city": {
      "terms": { "field": "city" }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          {"to": 300000},
          {"from": 300000, "to": 500000},
          {"from": 500000, "to": 750000},
          {"from": 750000}
        ]
      }
    }
  }') OVER () AS facets
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
ORDER BY score DESC
LIMIT 20;
```

### With filters applied

```sql
SELECT
  id AS "objectID",
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  pdb.score(id) AS score,
  pdb.agg('{
    "property_type": {
      "terms": { "field": "property_type" }
    },
    "city": {
      "terms": { "field": "city" }
    },
    "bedrooms": {
      "terms": { "field": "bedrooms" }
    },
    "has_garage": {
      "terms": { "field": "has_garage" }
    }
  }') OVER () AS facets
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
  AND price BETWEEN $2 AND $3
  AND ($4::text[] IS NULL OR city = ANY($4::text[]))
ORDER BY score DESC
LIMIT 20
OFFSET 0;
```

## Geo Search

ParadeDB doesn't have built-in geo search. Combine with PostGIS:

### BM25 search with radius filter

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  pdb.score(id) AS bm25_score,
  ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1609.344 AS distance_miles
FROM houses
WHERE title @@@ $1
  AND listing_status = 'active'
  AND ST_DWithin(
    geom,
    ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
    $4 * 1609.344  -- radius in miles to meters
  )
ORDER BY bm25_score DESC
LIMIT 20;
```

### Hybrid search with geo filter

```sql
WITH
lexical AS (
  SELECT
    id,
    row_number() OVER (ORDER BY pdb.score(id) DESC) AS rank
  FROM houses
  WHERE title @@@ $1
    AND listing_status = 'active'
    AND ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
      $4 * 1609.344
    )
  LIMIT 200
),
semantic AS (
  SELECT
    id,
    row_number() OVER (ORDER BY embedding <=> $5) AS rank
  FROM houses
  WHERE listing_status = 'active'
    AND ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
      $4 * 1609.344
    )
  LIMIT 200
),
combined AS (
  SELECT
    id,
    sum(score) AS hybrid_score
  FROM (
    SELECT id, 1.0 / (60 + rank) AS score FROM lexical
    UNION ALL
    SELECT id, 1.0 / (60 + rank) AS score FROM semantic
  ) ranked
  GROUP BY id
)
SELECT
  h.id,
  h.title,
  h.city,
  h.state,
  h.price,
  h.bedrooms,
  combined.hybrid_score,
  ST_Distance(h.geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1609.344 AS distance_miles
FROM combined
JOIN houses h ON h.id = combined.id
WHERE h.price BETWEEN $6 AND $7
ORDER BY combined.hybrid_score DESC
LIMIT 20;
```

## Embedding Management

Same as native PostgreSQL - application-managed:

```typescript
function buildHouseSemanticText(house: House): string {
  return [
    `Title: ${house.title}`,
    `Description: ${house.description}`,
    `Location: ${house.neighborhood ?? ''} ${house.city}, ${house.state}`,
    `School district: ${house.school_district ?? 'Unknown'}`,
    `Property type: ${house.property_type}`,
    `Bedrooms: ${house.bedrooms}`,
    `Bathrooms: ${house.bathrooms}`,
    house.has_garage ? 'Has garage' : '',
    house.has_fenced_yard ? 'Has fenced yard' : '',
    house.waterfront ? 'Waterfront' : '',
    house.new_construction ? 'New construction' : '',
    `Tags: ${(house.tags ?? []).join(', ')}`
  ]
    .filter(Boolean)
    .join('\n');
}

async function updateHouseEmbedding(house: House) {
  const semanticText = buildHouseSemanticText(house);
  const embedding = await embed(semanticText);
  
  await db.query(
    `
    UPDATE houses
    SET semantic_text = $1,
        embedding = $2,
        updated_at = now()
    WHERE id = $3
    `,
    [semanticText, embedding, house.id]
  );
}
```

## Frontend Integration

ParadeDB doesn't have a direct InstantSearch.js adapter. Build a custom API endpoint:

### Backend API endpoint

```typescript
import { Router } from 'express';
import { pool } from './db';

const router = Router();

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
  
  // Parse filters (implement filter parser)
  const parsedFilters = parseFilters(filters);
  
  // Build SQL query
  const result = await searchHouses({
    query,
    filters: parsedFilters,
    facets,
    limit: hitsPerPage,
    offset: page * hitsPerPage
  });
  
  // Format as InstantSearch response
  res.json({
    results: [
      {
        hits: result.hits,
        nbHits: result.totalHits,
        page,
        nbPages: Math.ceil(result.totalHits / hitsPerPage),
        hitsPerPage,
        processingTimeMS: result.processingTimeMS,
        facets: result.facets
      }
    ]
  });
});

export default router;
```

### Frontend search client

```typescript
import instantsearch from 'instantsearch.js';

const searchClient = {
  search(requests: any[]) {
    return fetch('/api/search/houses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }).then(response => response.json());
  }
};

const search = instantsearch({
  indexName: 'houses',
  searchClient,
  routing: true
});
```

### Filter parsing example

```typescript
function parseFilters(filterString: string): any {
  // Parse InstantSearch filter syntax
  // Example: "listing_status:active AND price>=300000 AND price<=500000"
  
  const filters: any = {};
  
  // Simple regex-based parser (production should use proper parser)
  const parts = filterString.split(' AND ');
  
  for (const part of parts) {
    if (part.includes('>=')) {
      const [field, value] = part.split('>=');
      filters[`${field}_min`] = parseInt(value);
    } else if (part.includes('<=')) {
      const [field, value] = part.split('<=');
      filters[`${field}_max`] = parseInt(value);
    } else if (part.includes(':')) {
      const [field, value] = part.split(':');
      filters[field] = value;
    }
  }
  
  return filters;
}
```

## Performance Tuning

### BM25 index parameters

```sql
CREATE INDEX houses_search_idx
ON houses
USING bm25 (id, title, description)
WITH (
  key_field = 'id',
  -- Tune BM25 parameters
  k1 = 1.2,  -- Term frequency saturation (default: 1.2)
  b = 0.75   -- Length normalization (default: 0.75)
);
```

### Query optimization

```sql
-- Use EXPLAIN to analyze queries
EXPLAIN (ANALYZE, BUFFERS)
SELECT ...
FROM houses
WHERE title @@@ 'query'
  AND listing_status = 'active';
```

### Maintenance

```sql
-- Refresh statistics
ANALYZE houses;

-- Vacuum
VACUUM ANALYZE houses;

-- Reindex if needed
REINDEX INDEX houses_search_idx;
```

## When to Use pg_search

### Good fit when:

- ✅ Want to keep search inside Postgres
- ✅ Need BM25 ranking (better than tsvector)
- ✅ Need faceting without external services
- ✅ Want hybrid search with pgvector
- ✅ Need transactional consistency with source data
- ✅ Comfortable building custom API adapters
- ✅ Team prefers Postgres-first architecture

### Not ideal when:

- ❌ Want fastest frontend implementation
- ❌ Want off-the-shelf InstantSearch integration
- ❌ Don't want to maintain query mapping layer
- ❌ Want managed embedding generation
- ❌ Need advanced search features like typo tolerance at search engine level
- ❌ Want to minimize backend code for search

## Comparison with Alternatives

| Feature | ParadeDB | Native Postgres | Meilisearch | Typesense |
|---------|----------|----------------|-------------|-----------|
| **Ranking** | BM25 | ts_rank | BM25-like | BM25-like |
| **Faceting** | Built-in | Manual SQL | Built-in | Built-in |
| **Location** | Postgres | Postgres | Sync required | Sync required |
| **Embeddings** | Manual | Manual | Managed | Managed |
| **Frontend** | Custom adapter | Custom adapter | Direct | Direct |
| **Learning curve** | Medium | Medium | Low | Low |

## Best Practices

1. **Index Strategy**
   - Include all searchable and filterable fields in BM25 index
   - Use pgvector HNSW index for semantic search
   - Use PostGIS GIST index for geo queries

2. **Hybrid Search**
   - Always use RRF for combining BM25 and vector scores
   - Tune RRF constant (typically 60) based on result quality
   - Consider adjustable weights for different query types

3. **Faceting**
   - Request facets through `pdb.agg()` function
   - Apply filters before facet aggregation
   - Cache common facet combinations if needed

4. **API Design**
   - Build InstantSearch-compatible response format
   - Implement proper filter parsing
   - Handle pagination correctly
   - Return accurate hit counts

5. **Embedding Pipeline**
   - Generate embeddings asynchronously
   - Only regenerate when semantic fields change
   - Batch embed operations for efficiency
   - Monitor embedding staleness
