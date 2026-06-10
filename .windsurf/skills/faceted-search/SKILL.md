---
name: faceted-search
description: Implement faceted, geo-aware, and semantic search for location-based datasets using PostgreSQL, pg_search, Meilisearch, or Typesense. Use when building search UIs with filters, facets, geospatial queries, semantic/vector search, or hybrid ranking. Covers schema design, embedding generation, sync pipelines, Docker deployment, frontend integration with InstantSearch.js, and saved searches with alerting.
---

# Faceted Search

Guide for implementing faceted, geo-aware, and semantic search over location-based datasets. Covers PostgreSQL-native search, pg_search extension, Meilisearch, and Typesense with frontend integration patterns and Docker deployment.

## When to Use This Skill

- Building search UIs with faceted filtering (e.g., real estate, e-commerce, job boards)
- Implementing location-based search with radius or bounding box queries
- Adding semantic/vector search capabilities to keyword search
- Creating hybrid search combining keyword and semantic ranking
- Building saved searches with alerting functionality
- Integrating search engines with InstantSearch.js or similar UI frameworks

## Key Concepts

### Facets
A **facet** is a filterable attribute that returns counts or distribution data for the current result set. Unlike simple filters, facets show users what options are available and how many results each option would return.

Example:
```
Property type
- Single family (132)
- Townhouse (24)
- Condo (11)
```

Facets help users understand the shape of available results while narrowing their search.

### Semantic Search
Uses vector embeddings to find conceptually similar records even when exact words don't match. Better for intent-based queries like "quiet home with space for kids" than keyword search alone.

### Hybrid Search
Combines keyword search (exact terms) with semantic search (conceptual matches) for better results across different query types.

### Geo-Aware Search
Supports radius search, bounding box filtering, distance sorting, and city/neighborhood filtering for location-based datasets.

## Critical Architecture Distinction

**Understand the fundamental difference between options:**

### PostgreSQL-Native Options (No External Sync)

```
PostgreSQL database
├─ Source of truth
└─ Search indexes INSIDE Postgres
```

**Options:** Native PostgreSQL, pg_search extension

**Key trait:** No external service, no sync pipeline needed

### External Search Services (Require Sync)

```
PostgreSQL (source of truth)
  ↓ sync pipeline ↓
External search service
```

**Options:** Meilisearch, Typesense

**Key trait:** External service, requires outbox + sync worker

## Decision Framework

### Choose Your Search Engine

#### Native PostgreSQL
**Use when:**
- Dataset is small to moderate
- Search is not a core product feature
- Facet counts are limited
- You need exact transactional freshness
- You want fewer services to operate
- You're okay managing embedding generation yourself

**Capabilities:**
- `tsvector` for full-text search
- `pgvector` for semantic search
- PostGIS for geo queries
- SQL GROUP BY for facet counts

**See:** `reference/postgresql-native/`

#### pg_search Extension (Open Source)
**Use when:**
- You want search-engine capabilities inside Postgres
- You need BM25 ranking
- You want faceting without adding external services
- You want hybrid search with pgvector
- You're comfortable building custom API adapters
- You want to preserve Postgres-first architecture

**Capabilities:**
- BM25 full-text search
- Built-in faceted search
- Combines with pgvector for hybrid search
- SQL-based with search-engine features
- Open source (AGPL-3.0)

**Note:** pg_search is an open source PostgreSQL extension. ParadeDB also offers a managed service, but the extension itself is free to use.

**See:** `reference/pg-search/`

#### Meilisearch
**Use when:**
- You want to ship a search UI quickly
- You need typo tolerance and search-as-you-type
- You want straightforward facets and filters
- You want direct InstantSearch.js integration
- You want managed semantic/hybrid search
- You're comfortable with Meilisearch managing embedders

**Capabilities:**
- Strong search defaults
- Built-in semantic and hybrid search
- Automatic embedding generation with document templates
- Simple filter syntax
- Good InstantSearch.js adapter

**See:** `reference/meilisearch/`

#### Typesense
**Use when:**
- Faceted search is central to your product
- You want strong filter and facet controls
- You need geo search and distance sorting
- You want schema-by-convention for dynamic attributes
- You want explicit control over which fields generate semantic vectors
- You want embeddings to regenerate only when selected fields change

**Capabilities:**
- Strong faceting model
- Built-in vector search and auto-embedding
- Clear `embed.from` field selection
- Straightforward hybrid search
- Excellent InstantSearch.js adapter
- Useful wildcard/regex field definitions

**See:** `reference/typesense/`

### Quick Comparison

| Aspect | Native PostgreSQL | pg_search Extension | Meilisearch | Typesense |
|--------|------------------|---------------------|-------------|-----------|
| **Deployment** | Single DB | Single DB | Separate service | Separate service |
| **Source of truth** | Yes | Yes | No (sync) | No (sync) |
| **Full-text search** | Good | Strong BM25 | Strong | Strong |
| **Faceting** | Manual SQL | Built-in | Built-in | Built-in |
| **Geo search** | PostGIS | PostGIS* | Built-in | Built-in |
| **Semantic search** | pgvector | pgvector* | Built-in | Built-in |
| **Embedding management** | Manual | Manual | Managed | Managed |
| **InstantSearch.js** | Custom adapter | Custom adapter | Direct adapter | Direct adapter |
| **Frontend complexity** | High | Medium | Low | Low |
| **Best for** | Simple search | Postgres-first | Fast shipping | Advanced faceting |

*Depends on image/installation

**See:** `reference/shared/comparison.md` for detailed comparison

## Domain Modeling

### Example Schema

This skill uses a **house search** example throughout all documentation. The complete PostgreSQL schema includes:

- **Houses** - Residential properties (title, description, price, bedrooms, etc.)
- **Cities** - Cities in the metro area with geography
- **Neighborhoods** - Named subdivisions and communities
- **Amenities** - Property features (pool, garage, basement, etc.)
- **Tags** - Descriptive labels (family-friendly, luxury, walkable, etc.)

**See:** `reference/shared/example-schema.md` for complete schema, sample data, and SQL queries.

### Core Principles

**For search engines like Meilisearch and Typesense:**
- Denormalize relational data into search documents
- PostgreSQL remains source of truth
- Search engine receives flattened records

**For faceting:**
- Use convention-based fields (e.g., `*_facet` suffix)
- Separate facet fields from display fields for clarity
- Plan facetable fields early for saved searches

**For semantic embeddings:**
- Only embed fields that describe meaning (title, description, location context)
- Don't embed structured data like price, bedrooms, dates
- Use filters and facets for structured attributes

### Example Document Shape

```typescript
type HouseSearchDocument = {
  objectID: string;
  
  // Searchable text
  title: string;
  description: string;
  
  // Location
  city: string;
  state: string;
  neighborhood?: string;
  location: [number, number]; // [lat, lng]
  
  // Structured attributes
  price: number;
  bedrooms: number;
  bathrooms: number;
  square_feet: number;
  property_type: string;
  
  // Facet fields (convention-based)
  city_facet: string;
  state_facet: string;
  neighborhood_facet?: string;
  property_type_facet: string;
  
  // Amenities
  has_pool: boolean;
  has_garage: boolean;
  tags?: string[];
};
```

**See:** `reference/shared/domain-modeling.md` for complete examples

## Embedding Strategy

### Which Fields to Embed

**Do embed:**
- title
- description
- city
- neighborhood
- school_district
- property_type
- tags
- important amenities

**Don't embed:**
- price
- bedrooms/bathrooms
- square_feet
- lat/lng
- listing_status
- boolean flags

### Embedding Generation

**Native PostgreSQL & pg_search:**
- Application-managed embedding pipeline
- Manual semantic text builder
- Update embeddings only when relevant fields change

**Meilisearch:**
- Document templates control what gets embedded
- Automatic batching and caching
- Regenerates when document changes

**Typesense:**
- `embed.from` field list
- Auto-regenerates only when source fields change
- Can use built-in models or external embeddings

**See:** `reference/shared/embeddings.md` for implementation details

## Frontend Integration

### With Meilisearch or Typesense

Direct InstantSearch.js integration:

```typescript
import instantsearch from 'instantsearch.js';
import TypesenseInstantSearchAdapter from 'typesense-instantsearch-adapter';

const adapter = new TypesenseInstantSearchAdapter({
  server: { /* config */ },
  additionalSearchParameters: {
    query_by: 'title,description,city,neighborhood,embedding'
  }
});

const search = instantsearch({
  indexName: 'houses',
  searchClient: adapter.searchClient,
  routing: true
});

search.addWidgets([
  searchBox({ container: '#searchbox' }),
  refinementList({ container: '#city-facet', attribute: 'city_facet' }),
  rangeSlider({ container: '#price-range', attribute: 'price' }),
  hits({ container: '#hits' }),
  pagination({ container: '#pagination' })
]);

search.start();
```

### With PostgreSQL or pg_search

Custom backend adapter:

```typescript
const searchClient = {
  search(requests: any[]) {
    return fetch('/api/search/houses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    }).then(response => response.json());
  }
};
```

Backend must handle:
- Search query parsing
- Filter and facet aggregation
- InstantSearch-compatible response format

**See:** `reference/shared/frontend-integration.md` for complete patterns

## Saved Searches and Alerting

### Key Requirements

1. **Allow zero-hit saved searches** - Users should be able to save searches with no current matches
2. **Validate filter attributes** - Only allow known, safe filterable fields
3. **Track seen results** - Prevent duplicate notifications
4. **Support multiple alert frequencies** - Instant, daily, weekly, never

### Recommended Architecture

```
PostgreSQL
  ├─ saved_searches table (criteria, alert config)
  ├─ saved_search_notifications table (history)
  └─ houses table (source of truth)

Search Engine (Typesense/Meilisearch)
  └─ Execute search criteria

Background Worker
  ├─ Evaluate saved searches
  ├─ Diff against seen_house_ids
  ├─ Confirm matches in Postgres
  └─ Send notifications
```

### Saved Search Model

```typescript
type SavedHouseSearch = {
  id: string;
  user_id: string;
  name?: string;
  criteria: HouseSearchCriteria;
  alert_enabled: boolean;
  alert_frequency: 'instant' | 'daily' | 'weekly' | 'never';
  last_evaluated_at?: string;
  last_notified_at?: string;
  seen_house_ids: string[];
  created_at: string;
  updated_at: string;
};
```

**See:** `reference/shared/saved-searches.md` for complete implementation

## Implementation Patterns

### Pattern 1: Fast Product Implementation
**Stack:** Meilisearch + PostgreSQL + InstantSearch.js  
**Best for:** Rapid prototyping, startups, MVP  
**Trade-off:** Less schema control, managed embeddings

### Pattern 2: Advanced Faceting & Control
**Stack:** Typesense + PostgreSQL + InstantSearch.js  
**Best for:** Complex faceted search, geo-heavy applications  
**Trade-off:** More configuration, better control

### Pattern 3: Postgres-First Architecture
**Stack:** pg_search + pgvector + PostGIS + Custom API  
**Best for:** Teams avoiding external services, complex permissions  
**Trade-off:** More backend work, full control

### Pattern 4: Simple Internal Tools
**Stack:** Native PostgreSQL + PostGIS + pgvector  
**Best for:** Admin dashboards, internal search, small datasets  
**Trade-off:** Limited faceting, manual plumbing

## Recommended Architecture

For customer-facing location-based search:

```
PostgreSQL (source of truth)
  ↓
Sync Pipeline (denormalization)
  ↓
Typesense or Meilisearch (search engine)
  ↓
InstantSearch.js (frontend)
```

**Primary recommendation:** Typesense for best balance of faceting, geo, semantic, and schema control.

**Fast alternative:** Meilisearch for quickest time-to-market with good defaults.

## Reference Documentation

Documentation is organized by search option:

### PostgreSQL-Native
- **`reference/postgresql-native/overview.md`** - Full-text search, faceting, geo queries
- **`reference/postgresql-native/deployment.md`** - Docker Compose, indexes, performance

### pg_search Extension
- **`reference/pg-search/overview.md`** - BM25 search, built-in faceting
- **`reference/pg-search/deployment.md`** - Docker Compose with ParadeDB image

### Meilisearch
- **`reference/meilisearch/overview.md`** - Search queries, filters, semantic search
- **`reference/meilisearch/deployment.md`** - Docker Compose with sync worker
- **`reference/meilisearch/sync-pipeline.md`** - Complete sync implementation

### Typesense
- **`reference/typesense/overview.md`** - Schema, facets, auto-embedding
- **`reference/typesense/deployment.md`** - Docker Compose with sync worker
- **`reference/typesense/sync-pipeline.md`** - Complete sync implementation

### Shared Documentation
- **`reference/shared/example-schema.md`** - Complete PostgreSQL schema with sample data
- **`reference/shared/comparison.md`** - Detailed feature comparison
- **`reference/shared/domain-modeling.md`** - Schema design patterns
- **`reference/shared/embeddings.md`** - Embedding strategies
- **`reference/shared/saved-searches.md`** - Saved search implementation
- **`reference/shared/autocomplete.md`** - Autocomplete patterns
- **`reference/shared/frontend-integration.md`** - InstantSearch.js integration
- **`reference/shared/deployment-overview.md`** - Docker conventions

## Common Pitfalls

- **Over-embedding** - Don't embed structured data like prices and counts
- **Forgetting facet configuration** - Plan facetable fields early for saved searches
- **Ignoring zero-hit searches** - Allow users to save searches with no current matches
- **Duplicate notifications** - Track seen results to avoid alert spam
- **Hardcoded field lists** - Use allow-lists for user-facing filters
- **Mixing concerns** - Keep PostgreSQL as source of truth, search engine for search
- **Sync delays** - Account for async indexing in event-driven alerts
- **Fragile sync patterns** - Use outbox pattern with retries instead of dual writes
- **No backfill strategy** - Always have a full reindex capability for schema changes

## Quick Start Checklist

- [ ] Choose search engine based on requirements (see Decision Framework)
- [ ] Design domain model with facet fields
- [ ] Plan which fields to embed semantically
- [ ] Set up embedding generation pipeline (if needed)
- [ ] Configure search engine schema/settings
- [ ] Build sync pipeline from PostgreSQL to search engine (if using external service)
  - [ ] Create outbox table for reliable sync
  - [ ] Add triggers to enqueue sync events
  - [ ] Implement sync worker with retry logic
  - [ ] Build full backfill script
- [ ] Implement frontend with InstantSearch.js or custom adapter
- [ ] Add saved search functionality with zero-hit support
- [ ] Build alert evaluation worker
- [ ] Test hybrid search with both keyword and semantic queries
