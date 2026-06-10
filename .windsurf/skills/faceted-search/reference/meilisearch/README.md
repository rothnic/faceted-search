# Meilisearch

External search engine with PostgreSQL as source of truth.

## Architecture

```
PostgreSQL (source of truth)
  ↓ triggers → search_sync_outbox
  ↓
Sync Worker
  ├─ Reads outbox events
  ├─ Fetches normalized data
  ├─ Transforms to flattened documents
  └─ Upserts to Meilisearch
      ↓
Meilisearch (external search index)
  ├─ Denormalized documents
  ├─ BM25 search
  ├─ Facets
  ├─ Geo search
  └─ Semantic search
```

**Meilisearch is an EXTERNAL service that requires a sync pipeline.**

## Documentation

- **`overview.md`** - Search queries, filters, facets, geo search, semantic search
- **`deployment.md`** - Docker Compose with sync worker, outbox setup, triggers
- **`sync-pipeline.md`** - Complete sync worker implementation with Meilisearch adapter

## When to Use

- Want fastest time-to-market
- Need good defaults immediately
- Want direct InstantSearch.js integration
- Prefer managed embeddings
- Building MVP or prototype

## What You Build

- Outbox table and triggers
- Sync worker (transforms normalized → denormalized)
- Backfill script
- Monitoring for sync health

## What You Get

- ✅ Direct InstantSearch.js adapter
- ✅ Managed embedding generation
- ✅ Typo tolerance
- ✅ Simple filter syntax
- ✅ Good search defaults

## Trade-offs

✅ **Pros:**
- Fastest implementation
- Low frontend complexity
- Good defaults
- Managed embeddings

❌ **Cons:**
- External service to manage
- Sync pipeline complexity
- Eventually consistent
- Less schema control than Typesense

## Document Format

Meilisearch uses `_geo` for geospatial:

```json
{
  "id": "house_1001",
  "_geo": {
    "lat": 34.6532,
    "lng": -86.4778
  },
  "price": 485000
}
```
