# pg_search Extension Deployment

Docker Compose deployment for PostgreSQL with pg_search extension.

## Critical Architecture Understanding

```
PostgreSQL with pg_search extension
├─ Source of truth (normalized data)
├─ pg_search indexes (INSIDE Postgres)
├─ BM25 full-text search
├─ Built-in faceting
└─ No external search service
```

**pg_search is a PostgreSQL EXTENSION, not an external service.**

The search indexes live INSIDE your PostgreSQL database. You do NOT need:
- ❌ External search service
- ❌ Sync worker
- ❌ Outbox table
- ❌ Search sync pipeline

This is fundamentally different from Meilisearch or Typesense, which are external services requiring sync.

## When to Use

✅ **Good for:**
- Postgres-first architecture
- BM25 ranking inside PostgreSQL
- Built-in faceted search
- Avoiding separate Meilisearch/Typesense service
- Keeping saved searches close to source data
- Reducing external sync complexity

❌ **Not ideal for:**
- Teams wanting off-the-shelf InstantSearch.js integration
- Minimal backend customization
- Managed embedding generation

## What is ParadeDB vs pg_search?

- **ParadeDB** = Company offering managed PostgreSQL with search (commercial service)
- **pg_search** = Open source Postgres extension (AGPL-3.0) providing BM25, faceting
- **paradedb/paradedb** = Docker image with Postgres + pg_search pre-installed

We use the paradedb/paradedb Docker image as a convenience for local development. In production, you can install pg_search directly into your existing Postgres environment.

## docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: paradedb/paradedb:0.13.3
    container_name: house-search-pg-search
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "5432:5432"
    volumes:
      - pg_search_data:/var/lib/postgresql
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  pg_search_data:
```

**Version pinning:** Always pin to a specific version. Check [ParadeDB releases](https://github.com/paradedb/paradedb/releases).

## Initialization Script

`docker/postgres/init/001_extensions.sql`:

```sql
-- ParadeDB pg_search extension (open source, AGPL-3.0)
CREATE EXTENSION IF NOT EXISTS pg_search;

-- Optional if available in image:
-- CREATE EXTENSION IF NOT EXISTS vector;
-- CREATE EXTENSION IF NOT EXISTS postgis;
```

## Usage

### Start

```bash
docker compose up -d
```

### Connect and Verify

```bash
docker compose exec postgres psql -U app -d house_search

-- Inside psql:
SELECT * FROM pg_available_extensions WHERE name = 'pg_search';
```

### Create Extension

```sql
CREATE EXTENSION IF NOT EXISTS pg_search;
```

### Stop

```bash
docker compose down
```

## Creating BM25 Index

Unlike external search engines, you create indexes with SQL:

```sql
-- Create BM25 index for full-text search
CREATE INDEX houses_search_idx
ON houses
USING bm25 (
  id,
  title,
  description,
  city,
  neighborhood,
  school_district,
  zip_code,
  property_type
)
WITH (key_field = 'id');
```

See `overview.md` for complete index and query patterns.

## No Sync Worker Needed

Because pg_search indexes are inside Postgres:

✅ **Changes are immediate:**
```sql
-- This immediately updates the BM25 index
INSERT INTO houses (...) VALUES (...);
UPDATE houses SET title = 'New title' WHERE id = 'house_1';
DELETE FROM houses WHERE id = 'house_2';
```

❌ **You don't need:**
- Outbox table for sync events
- Background worker to sync changes
- Flattened documents
- Denormalization (use JOIN in queries)
- External index backfill
- Drift detection

## What You Still Need to Build

Even though pg_search provides BM25 and faceting, you still own the application layer:

1. **Search API Layer:**
   - SQL query builder using `@@@` operator
   - Filter parsing
   - Facet aggregation with `pdb.agg()`
   - Pagination

2. **InstantSearch Integration:**
   - Custom backend adapter
   - Response formatter for InstantSearch format

3. **Saved Searches:**
   - Criteria storage
   - Evaluation logic
   - Alert worker

4. **Hybrid Search (if using pgvector):**
   - Embedding generation
   - RRF combining BM25 + vector scores

## Production Deployment Options

### Option 1: Use ParadeDB Docker Image

Simplest for teams comfortable with Docker:

```yaml
services:
  postgres:
    image: paradedb/paradedb:0.13.3
    # ... configuration
```

### Option 2: Install pg_search in Existing Postgres

Best if you already have a hardened Postgres setup:

1. Download pg_search from [GitHub releases](https://github.com/paradedb/paradedb/releases)
2. Install extension binary in your Postgres environment
3. Add to `shared_preload_libraries` if needed
4. `CREATE EXTENSION pg_search;`

See [ParadeDB extension docs](https://docs.paradedb.com/deploy/self-hosted/extension) for installation details.

### Option 3: Managed ParadeDB (Commercial)

If you need managed HA/support, evaluate ParadeDB's commercial offerings. But the open source extension is sufficient for most use cases.

## Adding PostGIS or pgvector

The ParadeDB Docker image may not include PostGIS or pgvector by default.

**Options:**

1. **Check current image:** Test if extensions are available
2. **Custom image:** Build ParadeDB + PostGIS + pgvector
3. **Separate databases:** Use ParadeDB for search, standard Postgres for geo/vectors
4. **Wait for official support:** ParadeDB may add these in future releases

### Custom Image Example

`Dockerfile`:

```dockerfile
FROM paradedb/paradedb:0.13.3

# Install PostGIS and pgvector
# (Adjust package names based on Postgres version in ParadeDB image)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-17-postgis-3 \
    postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
```

Then use `build:` instead of `image:` in docker-compose.yml.

## Backup Strategy

pg_search indexes are part of your PostgreSQL database:

```bash
# Backs up everything including pg_search indexes
docker compose exec postgres pg_dump -U app house_search > backup.sql
```

No separate backup strategy needed for search indexes.

## License Considerations

pg_search is licensed under AGPL-3.0:

✅ **You can:**
- Use freely for commercial applications
- Run internally without open sourcing your app
- Modify the extension source

⚠️ **You must:**
- Open source any modifications if you distribute the extension
- Open source your application if you offer it as a network service (AGPL network clause)

For most teams running pg_search internally, AGPL has minimal impact. If you're building a SaaS product with pg_search, consult legal counsel about AGPL implications.

## Performance Tips

### Tune BM25 Parameters

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
  k1 = 1.2,          -- Adjust term frequency saturation
  b = 0.75           -- Adjust length normalization
);
```

### Index Only What You Search

Don't include every column in BM25 index:

```sql
-- Bad: indexing non-searchable fields
USING bm25 (id, title, price, bedrooms, bathrooms)

-- Good: only searchable text fields
USING bm25 (id, title, description, city, neighborhood)
```

### Separate Indexes for Different Search Types

```sql
-- Title/description search
CREATE INDEX houses_content_search_idx
ON houses
USING bm25 (id, title, description)
WITH (key_field = 'id');

-- Location search
CREATE INDEX houses_location_search_idx
ON houses
USING bm25 (id, city, neighborhood, zip_code, school_district)
WITH (key_field = 'id');
```

## Monitoring

Add pg_stat_statements:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

Monitor:
- BM25 query performance
- Index size
- Facet query performance
- Connection pool usage

## Common Pitfalls

❌ **Treating pg_search like an external service**
- Don't build a sync pipeline
- Don't create outbox tables for pg_search
- Don't denormalize into separate "search documents"

❌ **Forgetting it's still SQL**
- Use proper indexes for filters
- Add WHERE clauses for permissions
- Use transactions for consistency

❌ **Not tuning BM25 parameters**
- Default k1/b values may not fit your data
- Test and adjust based on relevance

## Next Steps

- See `overview.md` for complete query patterns and faceting examples
- See `../shared/comparison.md` to compare with Meilisearch/Typesense
- See `../shared/domain-modeling.md` for schema design
- Read [ParadeDB documentation](https://docs.paradedb.com/) for latest features

## Summary

**pg_search is a Postgres extension that brings search-engine features INTO your database. It is NOT an external service like Meilisearch or Typesense.**

Use pg_search when you want:
- Postgres-first architecture
- No external sync pipeline
- BM25 and faceting inside Postgres
- Immediate consistency

Consider Meilisearch/Typesense when you want:
- Off-the-shelf InstantSearch.js integration
- Managed embeddings
- Less custom backend code
- Strong search product defaults
