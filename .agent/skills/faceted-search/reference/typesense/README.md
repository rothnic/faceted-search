# Typesense

External search engine with strong schema control and faceting.

## Architecture

```
PostgreSQL (source of truth)
  ↓ triggers → search_sync_outbox
  ↓
Sync Worker
  ├─ Reads outbox events
  ├─ Fetches normalized data
  ├─ Transforms to flattened documents
  └─ Upserts to Typesense
      ↓
Typesense (external search collection)
  ├─ Denormalized documents
  ├─ BM25 search
  ├─ Strong faceting
  ├─ Geo search
  └─ Auto-embedding
```

**Typesense is an EXTERNAL service that requires a sync pipeline.**

## Documentation

- **`overview.md`** - Schema definition, search queries, facets, geo search, auto-embedding
- **`deployment.md`** - Docker Compose with sync worker, collection schema, zero-downtime reindexing
- **`sync-pipeline.md`** - Complete sync worker implementation with Typesense adapter

## When to Use

- Faceting is central to product
- Need strong schema control
- Want explicit control over embedding fields
- Need geo + faceting + semantic search
- Want InstantSearch.js integration

## What You Build

- Outbox table and triggers
- Sync worker (transforms normalized → denormalized)
- Collection schema
- Backfill script
- Alias management for reindexing

## What You Get

- ✅ Direct InstantSearch.js adapter
- ✅ Strong faceting model
- ✅ Schema-by-convention (`*_facet` fields)
- ✅ Auto-embedding from selected fields
- ✅ Explicit control over embedding regeneration

## Trade-offs

✅ **Pros:**
- Best faceting + geo + semantic fit
- Strong schema control
- Efficient embedding regeneration
- Wildcard field patterns

❌ **Cons:**
- External service to manage
- Sync pipeline complexity
- Eventually consistent
- More schema planning required

## Document Format

Typesense uses `location` array for geospatial:

```json
{
  "id": "house_1001",
  "location": [34.6532, -86.4778],
  "price": 485000,
  "city_facet": "Owens Cross Roads"
}
```

## Auto-Embedding

Explicit control over which fields generate embeddings:

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: ['semantic_text'],  // Only regenerate when this changes
    model_config: {
      model_name: 'ts/all-MiniLM-L12-v2'
    }
  }
}
```

Embeddings only regenerate when `semantic_text` changes, not when `price` or `days_on_market` change.
