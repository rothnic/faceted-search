# Typesense Deployment

Docker Compose deployment for PostgreSQL + Typesense external search stack.

## Architecture

```
PostgreSQL (source of truth)
  ├─ Normalized relational data
  ├─ houses, cities, neighborhoods, amenities, tags
  └─ search_sync_outbox table
     ↓
Sync Worker (transforms and syncs)
  ├─ Reads outbox events
  ├─ Fetches normalized data
  ├─ Builds flattened documents
  └─ Upserts to Typesense
     ↓
Typesense (external search collection)
  ├─ Denormalized search documents
  ├─ Full-text search with BM25
  ├─ Strong faceting model
  ├─ Geo search
  └─ Auto-embedding for semantic search
```

**Typesense is an EXTERNAL service. You need a sync pipeline to keep it in sync with PostgreSQL.**

## When to Use

✅ **Good for:**
- Strong faceted search requirements
- Location-aware search
- Direct InstantSearch.js integration
- Schema-by-convention (`*_facet` fields)
- Auto-generated embeddings from selected fields
- Hybrid keyword + semantic search
- Explicit schema control

❌ **Not ideal for:**
- Teams wanting minimal configuration
- Frequent schema changes without planning

## docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgis/postgis:17-3.5
    container_name: house-search-postgres
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

  typesense:
    image: typesense/typesense:27.1
    container_name: house-search-typesense
    restart: unless-stopped
    ports:
      - "8108:8108"
    volumes:
      - typesense_data:/data
    command:
      [
        "--data-dir",
        "/data",
        "--api-key",
        "${TYPESENSE_API_KEY}",
        "--enable-cors"
      ]
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--spider",
          "-q",
          "http://127.0.0.1:8108/health"
        ]
      interval: 5s
      timeout: 5s
      retries: 20

  search-sync-worker:
    build:
      context: ./search-worker
    container_name: house-search-sync-worker
    restart: unless-stopped
    env_file:
      - .env
    environment:
      SEARCH_ENGINE: typesense
      DATABASE_URL: ${DATABASE_URL}
      TYPESENSE_HOST: ${TYPESENSE_HOST}
      TYPESENSE_API_KEY: ${TYPESENSE_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      typesense:
        condition: service_healthy

volumes:
  postgres_data:
  typesense_data:
```

**Version pinning:** Check [Typesense releases](https://github.com/typesense/typesense/releases).

## PostgreSQL Setup

Same outbox and trigger setup as Meilisearch. See `../meilisearch/deployment.md` for SQL scripts.

## Search Worker

See `sync-pipeline.md` for complete sync worker implementation.

### Key Difference from Meilisearch

Use `typesense-adapter.ts` instead of `meilisearch-adapter.ts`:

```typescript
// src/search/index.ts
import { typesenseAdapter } from './typesense-adapter';

export const searchAdapter = typesenseAdapter;
```

## Usage

### Start

```bash
docker compose up -d --build
```

### Check Health

```bash
# Typesense
curl http://localhost:8108/health

# View logs
docker compose logs -f typesense
docker compose logs -f search-sync-worker
```

### Bootstrap Collection

The sync worker should create the collection on startup:

```typescript
const housesSchema = {
  name: 'houses',
  fields: [
    // Wildcard patterns
    { name: '.*', type: 'auto' },
    { name: '.*_facet', type: 'auto', facet: true },

    // Explicit fields
    { name: 'id', type: 'string' },
    { name: 'objectID', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'description', type: 'string' },
    { name: 'semantic_text', type: 'string' },

    { name: 'city', type: 'string', facet: true },
    { name: 'state', type: 'string', facet: true },
    { name: 'neighborhood', type: 'string', optional: true, facet: true },
    { name: 'zip_code', type: 'string', facet: true },

    { name: 'location', type: 'geopoint' },

    { name: 'price', type: 'int32', facet: true },
    { name: 'bedrooms', type: 'int32', facet: true },
    { name: 'bathrooms', type: 'float', facet: true },
    { name: 'square_feet', type: 'int32', facet: true },

    { name: 'property_type', type: 'string', facet: true },
    { name: 'listing_status', type: 'string', facet: true },

    { name: 'amenities', type: 'string[]', optional: true, facet: true },
    { name: 'tags', type: 'string[]', optional: true, facet: true },

    // Auto-embedding
    {
      name: 'embedding',
      type: 'float[]',
      embed: {
        from: ['semantic_text'],
        model_config: {
          model_name: 'ts/all-MiniLM-L12-v2'
        }
      }
    }
  ],
  default_sorting_field: 'price'
};

await typesense.collections().create(housesSchema);
```

## Document Format

Typesense expects:

```json
{
  "id": "house_1001",
  "objectID": "house_1001",
  "title": "4 bedroom home",
  "city": "Owens Cross Roads",
  "location": [34.6532, -86.4778],
  "price": 485000,
  "city_facet": "Owens Cross Roads",
  "property_type_facet": "single_family",
  "amenities": ["garage", "fenced_yard"],
  "semantic_text": "Title: 4 bedroom home..."
}
```

**Key: Use `location: [lat, lng]` array format.**

## Semantic Search Setup

Typesense auto-generates embeddings from fields in `embed.from`:

```typescript
{
  name: 'embedding',
  type: 'float[]',
  embed: {
    from: ['semantic_text'],  // Only regenerate when this changes
    model_config: {
      model_name: 'ts/all-MiniLM-L12-v2'  // Built-in model
    }
  }
}
```

**Advantage:** Embeddings only regenerate when `semantic_text` changes, not when `price` or `days_on_market` change.

## Production Considerations

### API Key Security

- Never commit API keys to version control
- Create scoped keys for frontend (search-only)
- Rotate keys periodically

### Zero-Downtime Reindexing

Use collection aliases for schema changes:

```typescript
// 1. Create new collection
await typesense.collections().create({
  ...housesSchema,
  name: 'houses_v2'
});

// 2. Backfill
await backfillCollection('houses_v2');

// 3. Validate
const stats = await typesense.collections('houses_v2').retrieve();
console.log('Documents:', stats.num_documents);

// 4. Switch alias
await typesense.aliases().upsert('houses', {
  collection_name: 'houses_v2'
});

// 5. Delete old after safety window
// await typesense.collections('houses_v1').delete();
```

### High Availability

Multi-node Typesense cluster:

```typescript
const client = new Typesense.Client({
  nodes: [
    { host: 'node1.example.com', port: 443, protocol: 'https' },
    { host: 'node2.example.com', port: 443, protocol: 'https' },
    { host: 'node3.example.com', port: 443, protocol: 'https' }
  ],
  apiKey: process.env.TYPESENSE_API_KEY,
  connectionTimeoutSeconds: 2,
  numRetries: 3
});
```

### Resource Limits

```yaml
services:
  typesense:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### Docker Swarm/Kubernetes

For production orchestration, see [Typesense docs](https://typesense.org/docs/guide/high-availability.html).

## Backup Strategy

**PostgreSQL:**
```bash
docker compose exec postgres pg_dump -U app house_search > backup.sql
```

**Typesense:**
- Optional: Export snapshots for faster recovery
- Primary strategy: Rebuild from PostgreSQL using backfill

Typesense collections are rebuildable from PostgreSQL source of truth.

## Monitoring

Monitor:
- Sync worker health
- Outbox event backlog
- Failed sync attempts
- Typesense health (`/health` endpoint)
- Query latency (`/metrics.json`)
- Collection size
- Memory usage

### Health Check

```bash
curl http://localhost:8108/health
```

### Metrics

```bash
curl http://localhost:8108/metrics.json
```

## Common Pitfalls

❌ **Treating Typesense as source of truth**
- Always write to PostgreSQL first
- Let sync worker update Typesense

❌ **Not using aliases for schema changes**
- Direct collection updates can cause downtime
- Use alias pattern for zero-downtime reindexing

❌ **Including too many fields in embed.from**
- Only include semantic fields
- Exclude structured data to avoid unnecessary regeneration

❌ **Not validating schema changes**
- Schema errors fail the whole collection
- Test in development first

## Next Steps

- See `overview.md` for Typesense query patterns
- See `sync-pipeline.md` for complete sync worker implementation
- See `../shared/comparison.md` to compare with other options
- See `../meilisearch/` if you prefer simpler setup

## Summary

Typesense is an **external search service** that requires:

✅ Sync pipeline with outbox pattern  
✅ Search worker transforming normalized → denormalized  
✅ Triggers to enqueue changes  
✅ Backfill capability  
✅ Schema management  
✅ Collection aliases for zero-downtime updates  

Choose Typesense for best faceting + geo + semantic search control.
