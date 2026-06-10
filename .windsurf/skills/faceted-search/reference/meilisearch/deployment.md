# Meilisearch Deployment

Docker Compose deployment for PostgreSQL + Meilisearch external search stack.

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
  └─ Upserts to Meilisearch
     ↓
Meilisearch (external search index)
  ├─ Denormalized search documents
  ├─ Full-text search with BM25
  ├─ Facets and filters
  ├─ Geo search
  └─ Semantic/hybrid search
```

**Meilisearch is an EXTERNAL service. You need a sync pipeline to keep it in sync with PostgreSQL.**

## When to Use

✅ **Good for:**
- Fast implementation
- Good search-as-you-type UX
- Straightforward filters and facets
- Simple semantic/hybrid search setup
- Direct InstantSearch.js integration
- Low frontend complexity
- MVP and rapid prototyping

❌ **Not ideal for:**
- Need for strict schema control
- Complex custom ranking logic
- Frequent schema changes

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

  meilisearch:
    image: getmeili/meilisearch:v1.11.4
    container_name: house-search-meilisearch
    restart: unless-stopped
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
      MEILI_ENV: development
      MEILI_NO_ANALYTICS: "true"
      MEILI_DB_PATH: /meili_data
    ports:
      - "7700:7700"
    volumes:
      - meili_data:/meili_data
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--spider",
          "-q",
          "http://127.0.0.1:7700/health"
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
      SEARCH_ENGINE: meilisearch
      DATABASE_URL: ${DATABASE_URL}
      MEILI_HOST: ${MEILI_HOST}
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      meilisearch:
        condition: service_healthy

volumes:
  postgres_data:
  meili_data:
```

**Version pinning:** Check [Meilisearch releases](https://github.com/meilisearch/meilisearch/releases).

## PostgreSQL Setup

### Outbox Table

`docker/postgres/init/002_outbox.sql`:

```sql
CREATE TABLE search_sync_outbox (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  reason text,
  payload jsonb,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_sync_outbox_pending_idx 
ON search_sync_outbox (available_at, id) 
WHERE processed_at IS NULL;
```

### Triggers

`docker/postgres/init/003_triggers.sql`:

```sql
-- House changes trigger
CREATE OR REPLACE FUNCTION enqueue_house_search_sync()
RETURNS trigger AS $$
BEGIN
  INSERT INTO search_sync_outbox (
    entity_type,
    entity_id,
    operation,
    reason
  )
  VALUES (
    'house',
    COALESCE(NEW.id, OLD.id),
    CASE
      WHEN TG_OP = 'DELETE' THEN 'delete'
      WHEN NEW.deleted_at IS NOT NULL THEN 'delete'
      ELSE 'upsert'
    END,
    TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER houses_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON houses
FOR EACH ROW
EXECUTE FUNCTION enqueue_house_search_sync();

-- Related tables trigger
CREATE OR REPLACE FUNCTION enqueue_related_house_search_sync()
RETURNS trigger AS $$
BEGIN
  INSERT INTO search_sync_outbox (
    entity_type,
    entity_id,
    operation,
    reason
  )
  VALUES (
    'house',
    COALESCE(NEW.house_id, OLD.house_id),
    'upsert',
    TG_TABLE_NAME || '_' || TG_OP
  );
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER house_amenities_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON house_amenities
FOR EACH ROW
EXECUTE FUNCTION enqueue_related_house_search_sync();

CREATE TRIGGER house_tags_search_sync_trigger
AFTER INSERT OR UPDATE OR DELETE ON house_tags
FOR EACH ROW
EXECUTE FUNCTION enqueue_related_house_search_sync();
```

## Search Worker

See `sync-pipeline.md` for complete sync worker implementation.

### Dockerfile

`search-worker/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

CMD ["node", "dist/index.js"]
```

### Key Files

- `src/worker.ts` - Main worker loop
- `src/db.ts` - PostgreSQL connection
- `src/outbox.ts` - Outbox event handling
- `src/transform-house.ts` - Document transformation
- `src/search/meilisearch-adapter.ts` - Meilisearch upsert/delete

## Usage

### Start

```bash
docker compose up -d --build
```

### Check Health

```bash
# Meilisearch
curl http://localhost:7700/health

# View logs
docker compose logs -f meilisearch
docker compose logs -f search-sync-worker
```

### Bootstrap Index

The sync worker should configure the index on startup:

```typescript
await client.index('houses').updateSettings({
  searchableAttributes: [
    'title',
    'description',
    'semantic_text',
    'city',
    'neighborhood',
    'school_district',
    'zip_code',
    'amenities',
    'tags'
  ],
  filterableAttributes: [
    'city_facet',
    'state_facet',
    'county_facet',
    'neighborhood_facet',
    'zip_code_facet',
    'property_type_facet',
    'listing_status_facet',
    'school_district_facet',
    'price',
    'bedrooms',
    'bathrooms',
    'square_feet',
    'amenities',
    'tags',
    '_geo'
  ],
  sortableAttributes: [
    'price',
    'square_feet',
    'days_on_market',
    '_geo'
  ]
});
```

### Manual Backfill

```bash
# Run backfill command (implement in worker)
docker compose exec search-sync-worker node dist/backfill.js
```

## Document Format

Meilisearch expects:

```json
{
  "id": "house_1001",
  "objectID": "house_1001",
  "title": "4 bedroom home",
  "city": "Owens Cross Roads",
  "_geo": {
    "lat": 34.6532,
    "lng": -86.4778
  },
  "price": 485000,
  "city_facet": "Owens Cross Roads",
  "property_type_facet": "single_family",
  "amenities": ["garage", "fenced_yard"],
  "semantic_text": "Title: 4 bedroom home..."
}
```

**Key: Use `_geo` field for geospatial queries.**

## Semantic Search Setup

Configure embedder:

```typescript
await client.index('houses').updateEmbedders({
  'houses-openai': {
    source: 'openAi',
    apiKey: process.env.OPENAI_API_KEY,
    model: 'text-embedding-3-small',
    documentTemplate: '{{doc.semantic_text}}'
  }
});
```

Meilisearch handles embedding generation automatically.

## Production Considerations

### Environment

```yaml
environment:
  MEILI_ENV: production  # Change from development
  MEILI_NO_ANALYTICS: "true"
```

### Master Key Security

- Never commit master keys to version control
- Use search-only keys for frontend
- Rotate keys periodically

**Create search-only key:**

```bash
curl -X POST 'http://localhost:7700/keys' \
  -H 'Authorization: Bearer YOUR_MASTER_KEY' \
  -H 'Content-Type: application/json' \
  --data-binary '{
    "description": "Search-only key",
    "actions": ["search"],
    "indexes": ["houses"],
    "expiresAt": null
  }'
```

### Task Monitoring

Meilisearch indexing is asynchronous:

```typescript
const task = await client.index('houses').addDocuments(documents);
await client.waitForTask(task.taskUid);
```

### Resource Limits

```yaml
services:
  meilisearch:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

### High Availability

For production, consider:
- Multiple Meilisearch replicas (if supported)
- Load balancer
- Automated backups (snapshots)
- Monitoring and alerting

## Backup Strategy

**PostgreSQL:**
```bash
docker compose exec postgres pg_dump -U app house_search > backup.sql
```

**Meilisearch:**
- Optional: Export snapshots for faster recovery
- Primary strategy: Rebuild from PostgreSQL using backfill

Meilisearch indexes are rebuildable from PostgreSQL source of truth.

## Monitoring

Monitor:
- Sync worker health
- Outbox event backlog
- Failed sync attempts
- Meilisearch health
- Query latency
- Index size growth
- Task queue status

## Common Pitfalls

❌ **Treating Meilisearch as source of truth**
- Always write to PostgreSQL first
- Let sync worker update Meilisearch

❌ **Not tracking task IDs for critical operations**
- Meilisearch is async
- Track task IDs if you need confirmation

❌ **Forgetting to create search-only keys**
- Don't expose master key to frontend

❌ **Not planning for reindexing**
- Schema changes require full reindex
- Build reindex capability early

## Next Steps

- See `overview.md` for Meilisearch query patterns
- See `sync-pipeline.md` for complete sync worker implementation
- See `../shared/comparison.md` to compare with other options
- See `../typesense/` if you need more schema control

## Summary

Meilisearch is an **external search service** that requires:

✅ Sync pipeline with outbox pattern  
✅ Search worker transforming normalized → denormalized  
✅ Triggers to enqueue changes  
✅ Backfill capability  
✅ Monitoring and alerting  

Choose Meilisearch for fastest time-to-market with good defaults.
