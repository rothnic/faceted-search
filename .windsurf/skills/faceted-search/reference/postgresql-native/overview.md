# Native PostgreSQL Search

Complete guide for implementing faceted, geo-aware, and semantic search using native PostgreSQL extensions.

## Contents

- [Overview](#overview)
- [Required Extensions](#required-extensions)
- [Table Schema](#table-schema)
- [Indexes](#indexes)
- [Full-Text Search](#full-text-search)
- [Semantic Search with pgvector](#semantic-search-with-pgvector)
- [Hybrid Search](#hybrid-search)
- [Geo Search with PostGIS](#geo-search-with-postgis)
- [Facet Counts](#facet-counts)
- [Embedding Management](#embedding-management)
- [Performance Tuning](#performance-tuning)
- [Limitations](#limitations)

## Overview

Native PostgreSQL can support comprehensive search using:
- **tsvector** for full-text search
- **GIN indexes** for text search performance
- **pg_trgm** for fuzzy matching and similarity
- **PostGIS** for location search
- **pgvector** for semantic vector search
- **SQL GROUP BY** for facet counts
- **Materialized views** for precomputed counts

**Best for:** Simple/internal search, small to moderate datasets, Postgres-first architectures

## Required Extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

## Table Schema

```sql
CREATE TABLE houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Text fields
  title text NOT NULL,
  description text,
  
  -- Location
  address_line_1 text,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  neighborhood text,
  county text,
  
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geom geography(Point, 4326),
  
  -- Structured attributes
  price integer NOT NULL,
  bedrooms integer NOT NULL,
  bathrooms numeric NOT NULL,
  square_feet integer NOT NULL,
  lot_size_acres numeric,
  year_built integer,
  
  -- Categorical
  property_type text NOT NULL,
  listing_status text NOT NULL,
  
  school_district text,
  
  -- Amenities
  has_pool boolean DEFAULT false,
  has_garage boolean DEFAULT false,
  has_basement boolean DEFAULT false,
  has_fenced_yard boolean DEFAULT false,
  waterfront boolean DEFAULT false,
  new_construction boolean DEFAULT false,
  
  hoa_fee integer,
  days_on_market integer,
  
  -- Search fields
  semantic_text text,
  embedding vector(1536),
  
  -- Generated full-text search vector
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(city, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(neighborhood, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(school_district, '')), 'B')
  ) STORED,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### Trigger for geom column

```sql
CREATE OR REPLACE FUNCTION update_geom()
RETURNS TRIGGER AS $$
BEGIN
  NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER houses_update_geom
BEFORE INSERT OR UPDATE OF lat, lng ON houses
FOR EACH ROW
EXECUTE FUNCTION update_geom();
```

## Indexes

```sql
-- Full-text search
CREATE INDEX houses_search_vector_idx
ON houses
USING gin (search_vector);

-- Semantic search (HNSW for faster approximate nearest neighbor)
CREATE INDEX houses_embedding_hnsw_idx
ON houses
USING hnsw (embedding vector_cosine_ops);

-- Geo search
CREATE INDEX houses_geom_idx
ON houses
USING gist (geom);

-- Facets and filters
CREATE INDEX houses_city_idx ON houses (city);
CREATE INDEX houses_state_idx ON houses (state);
CREATE INDEX houses_neighborhood_idx ON houses (neighborhood);
CREATE INDEX houses_property_type_idx ON houses (property_type);
CREATE INDEX houses_listing_status_idx ON houses (listing_status);
CREATE INDEX houses_school_district_idx ON houses (school_district);
CREATE INDEX houses_price_idx ON houses (price);
CREATE INDEX houses_bedrooms_idx ON houses (bedrooms);
CREATE INDEX houses_bathrooms_idx ON houses (bathrooms);
CREATE INDEX houses_year_built_idx ON houses (year_built);

-- Composite indexes for common filter combinations
CREATE INDEX houses_status_price_idx 
ON houses (listing_status, price);

CREATE INDEX houses_city_status_idx 
ON houses (city, listing_status);
```

## Full-Text Search

### Basic keyword search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  square_feet,
  ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
FROM houses
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND listing_status = 'active'
ORDER BY rank DESC
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
  ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
FROM houses
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND listing_status = 'active'
  AND price BETWEEN $2 AND $3
  AND bedrooms >= $4
  AND city = ANY($5)
ORDER BY rank DESC
LIMIT 20;
```

### Search with highlighting

```sql
SELECT
  id,
  title,
  ts_headline('english', title, websearch_to_tsquery('english', $1)) AS highlighted_title,
  ts_headline('english', description, websearch_to_tsquery('english', $1)) AS highlighted_description,
  city,
  state,
  price,
  ts_rank(search_vector, websearch_to_tsquery('english', $1)) AS rank
FROM houses
WHERE search_vector @@ websearch_to_tsquery('english', $1)
  AND listing_status = 'active'
ORDER BY rank DESC
LIMIT 20;
```

## Semantic Search with pgvector

### Simple semantic search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  square_feet,
  1 - (embedding <=> $1) AS semantic_score
FROM houses
WHERE listing_status = 'active'
  AND price BETWEEN $2 AND $3
  AND bedrooms >= $4
ORDER BY embedding <=> $1
LIMIT 20;
```

### Semantic search with geo filter

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  square_feet,
  1 - (embedding <=> $1) AS semantic_score,
  ST_Distance(geom, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) / 1609.344 AS distance_miles
FROM houses
WHERE listing_status = 'active'
  AND ST_DWithin(
    geom,
    ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
    $4 * 1609.344  -- radius in miles converted to meters
  )
ORDER BY embedding <=> $1
LIMIT 20;
```

## Hybrid Search

Combine lexical and semantic search using Reciprocal Rank Fusion (RRF):

```sql
WITH
lexical AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $1)) DESC
    ) AS rank
  FROM houses
  WHERE search_vector @@ websearch_to_tsquery('english', $1)
    AND listing_status = 'active'
  LIMIT 200
),
semantic AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY embedding <=> $2
    ) AS rank
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
  ) scores
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

### Adjustable hybrid weight

```sql
WITH
lexical AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $1)) DESC
    ) AS rank
  FROM houses
  WHERE search_vector @@ websearch_to_tsquery('english', $1)
    AND listing_status = 'active'
  LIMIT 200
),
semantic AS (
  SELECT
    id,
    row_number() OVER (
      ORDER BY embedding <=> $2
    ) AS rank
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
  ) scores
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

Parameter `$6` is the lexical weight (0.0 to 1.0):
- 0.0 = semantic only
- 0.5 = balanced
- 1.0 = lexical only

## Geo Search with PostGIS

### Radius search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms,
  ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1609.344 AS distance_miles
FROM houses
WHERE listing_status = 'active'
  AND ST_DWithin(
    geom,
    ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
    $3 * 1609.344  -- radius in miles to meters
  )
ORDER BY distance_miles
LIMIT 20;
```

### Bounding box search

```sql
SELECT
  id,
  title,
  city,
  state,
  price,
  bedrooms,
  bathrooms
FROM houses
WHERE listing_status = 'active'
  AND geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
LIMIT 100;
```

Parameters: `$1` = west, `$2` = south, `$3` = east, `$4` = north

### City/neighborhood filter

```sql
SELECT
  id,
  title,
  city,
  state,
  neighborhood,
  price,
  bedrooms,
  bathrooms
FROM houses
WHERE listing_status = 'active'
  AND city = ANY($1::text[])
  AND ($2::text[] IS NULL OR neighborhood = ANY($2::text[]))
ORDER BY price
LIMIT 20;
```

## Facet Counts

### Basic facet aggregation

```sql
SELECT
  property_type,
  count(*) AS count
FROM houses
WHERE listing_status = 'active'
  AND price BETWEEN $1 AND $2
GROUP BY property_type
ORDER BY count DESC;
```

### Multiple facets

```sql
WITH filtered_houses AS (
  SELECT *
  FROM houses
  WHERE listing_status = 'active'
    AND price BETWEEN $1 AND $2
    AND ($3::text[] IS NULL OR city = ANY($3::text[]))
)
SELECT
  'city' AS facet_name,
  city AS facet_value,
  count(*) AS count
FROM filtered_houses
GROUP BY city
UNION ALL
SELECT
  'property_type' AS facet_name,
  property_type AS facet_value,
  count(*) AS count
FROM filtered_houses
GROUP BY property_type
UNION ALL
SELECT
  'bedrooms' AS facet_name,
  bedrooms::text AS facet_value,
  count(*) AS count
FROM filtered_houses
GROUP BY bedrooms
ORDER BY facet_name, count DESC;
```

### Facets with search results

```sql
WITH search_results AS (
  SELECT id
  FROM houses
  WHERE search_vector @@ websearch_to_tsquery('english', $1)
    AND listing_status = 'active'
    AND price BETWEEN $2 AND $3
),
paginated_results AS (
  SELECT
    h.id,
    h.title,
    h.city,
    h.state,
    h.price,
    h.bedrooms,
    h.bathrooms,
    ts_rank(h.search_vector, websearch_to_tsquery('english', $1)) AS rank
  FROM search_results sr
  JOIN houses h ON h.id = sr.id
  ORDER BY rank DESC
  LIMIT 20
  OFFSET $4
),
facet_counts AS (
  SELECT
    jsonb_object_agg(
      city,
      count
    ) AS city_facet
  FROM (
    SELECT city, count(*) AS count
    FROM houses h
    WHERE h.id IN (SELECT id FROM search_results)
    GROUP BY city
  ) city_counts
)
SELECT
  (SELECT jsonb_agg(to_jsonb(pr)) FROM paginated_results pr) AS hits,
  (SELECT * FROM facet_counts) AS facets,
  (SELECT count(*) FROM search_results) AS total_hits;
```

### Materialized view for common facets

```sql
CREATE MATERIALIZED VIEW house_facets_mv AS
SELECT
  listing_status,
  city,
  property_type,
  count(*) AS count
FROM houses
GROUP BY listing_status, city, property_type;

CREATE INDEX house_facets_mv_idx 
ON house_facets_mv (listing_status, city, property_type);

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY house_facets_mv;
```

## Embedding Management

Native PostgreSQL doesn't generate embeddings automatically. You need an application pipeline.

### Building semantic text

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
```

### Updating embeddings

```typescript
import { embed } from './embedding-service';

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

### Batch embedding generation

```typescript
async function batchGenerateEmbeddings(limit: number = 100) {
  const houses = await db.query(
    `
    SELECT id, title, description, city, state, neighborhood,
           school_district, property_type, bedrooms, bathrooms,
           has_garage, has_fenced_yard, waterfront, new_construction
    FROM houses
    WHERE embedding IS NULL
    LIMIT $1
    `,
    [limit]
  );
  
  for (const house of houses.rows) {
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
}
```

### Only regenerate when semantic fields change

```typescript
const SEMANTIC_FIELDS = new Set([
  'title',
  'description',
  'city',
  'neighborhood',
  'school_district',
  'property_type',
  'has_garage',
  'has_fenced_yard',
  'waterfront',
  'new_construction',
  'tags'
]);

function shouldRegenerateEmbedding(changedFields: string[]): boolean {
  return changedFields.some(field => SEMANTIC_FIELDS.has(field));
}
```

## Performance Tuning

### tsvector configuration

```sql
-- Custom text search configuration with stop words
CREATE TEXT SEARCH CONFIGURATION house_search (COPY = english);

-- Add custom synonyms
ALTER TEXT SEARCH DICTIONARY english_stem (
  RULES = 'english_stem'
);
```

### pgvector index tuning

```sql
-- HNSW index parameters
CREATE INDEX houses_embedding_hnsw_idx
ON houses
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

Parameters:
- `m`: Number of connections per layer (higher = better recall, slower build)
- `ef_construction`: Size of candidate list during construction (higher = better recall, slower build)

### Query tuning

```sql
-- Set search parameters for better recall
SET hnsw.ef_search = 100;

-- Analyze query plans
EXPLAIN (ANALYZE, BUFFERS) 
SELECT ...;
```

### Vacuum and analyze

```sql
-- Regular maintenance
VACUUM ANALYZE houses;

-- Update statistics
ANALYZE houses;
```

## Limitations

### When NOT to use native PostgreSQL

- Large-scale faceted search (>1M records with many facets)
- Real-time search-as-you-type with typo tolerance
- Complex autocomplete with multiple sources
- Frequent schema changes for searchable fields
- Team wants plug-and-play InstantSearch.js

### Challenges

1. **Facet performance** - GROUP BY can be slow on large result sets
2. **Frontend integration** - Custom adapter required for InstantSearch.js
3. **Embedding management** - Fully application-managed
4. **Typo tolerance** - Limited compared to dedicated search engines
5. **Search-as-you-type** - Requires careful index tuning
6. **Relevance tuning** - Limited scoring options compared to BM25

### Mitigation strategies

- Use materialized views for common facet combinations
- Implement smart caching at application layer
- Batch embed operations during off-peak hours
- Use pg_trgm for fuzzy matching
- Consider ParadeDB if staying in Postgres but need better search
