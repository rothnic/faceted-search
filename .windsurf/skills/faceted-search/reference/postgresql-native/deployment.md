# PostgreSQL-Only Deployment

Docker Compose deployment for PostgreSQL-only search stack.

## Architecture

```
PostgreSQL
├─ Source of truth (normalized data)
├─ Search layer (tsvector, pg_trgm)
├─ Geo layer (PostGIS)
└─ Vector layer (pgvector, optional)
```

**No external services needed.**

## When to Use

✅ **Good for:**
- Small to moderate datasets (<100k records)
- Internal tools and admin dashboards
- Exact transactional data requirements
- Simple facets
- PostGIS-based geo queries
- Minimal infrastructure

❌ **Not ideal for:**
- Customer-facing search UIs
- Heavy faceting requirements
- Typo tolerance
- Large datasets (>500k records)

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

volumes:
  postgres_data:
```

## Initialization Script

`docker/postgres/init/001_extensions.sql`:

```sql
-- Full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Geospatial
CREATE EXTENSION IF NOT EXISTS postgis;

-- Vector search (only if image includes pgvector)
-- CREATE EXTENSION IF NOT EXISTS vector;
```

## Usage

### Start

```bash
docker compose up -d
```

### Connect

```bash
docker compose exec postgres psql -U app -d house_search
```

### Stop

```bash
docker compose down
```

### Backup

```bash
docker compose exec postgres pg_dump -U app house_search > backup.sql
```

### Restore

```bash
docker compose exec -T postgres psql -U app -d house_search < backup.sql
```

## Adding pgvector Support

If you need both PostGIS and pgvector, create a custom image.

### Dockerfile

`docker/postgres-search/Dockerfile`:

```dockerfile
FROM postgis/postgis:17-3.5

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-17-pgvector \
  && rm -rf /var/lib/apt/lists/*
```

### Updated docker-compose.yml

```yaml
services:
  postgres:
    build:
      context: .
      dockerfile: docker/postgres-search/Dockerfile
    container_name: house-search-postgres
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro

volumes:
  postgres_data:
```

### Enable All Extensions

`docker/postgres/init/001_extensions.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
```

## Production Considerations

### Resource Limits

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
        reservations:
          cpus: '2'
          memory: 4G
```

### Connection Pooling

For production, add PgBouncer:

```yaml
services:
  pgbouncer:
    image: pgbouncer/pgbouncer:latest
    environment:
      DATABASES_HOST: postgres
      DATABASES_PORT: 5432
      DATABASES_USER: ${POSTGRES_USER}
      DATABASES_PASSWORD: ${POSTGRES_PASSWORD}
      DATABASES_DBNAME: ${POSTGRES_DB}
      PGBOUNCER_POOL_MODE: transaction
      PGBOUNCER_MAX_CLIENT_CONN: 1000
      PGBOUNCER_DEFAULT_POOL_SIZE: 25
    ports:
      - "6432:6432"
    depends_on:
      - postgres
```

Connect applications to `pgbouncer:6432` instead of `postgres:5432`.

### Backup Strategy

**Automated backups:**

```yaml
services:
  backup:
    image: prodrigestivill/postgres-backup-local:latest
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      SCHEDULE: "@daily"
      BACKUP_KEEP_DAYS: 7
      BACKUP_KEEP_WEEKS: 4
      BACKUP_KEEP_MONTHS: 6
    volumes:
      - ./backups:/backups
    depends_on:
      - postgres
```

### Monitoring

Add monitoring with pg_stat_statements:

```sql
-- In init script
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Configure in postgresql.conf or environment
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
```

## What You Need to Build

Since this is PostgreSQL-only, you need to implement:

1. **Search API Layer:**
   - SQL query builder
   - tsvector search queries
   - Filter parsing
   - Facet aggregation (GROUP BY)
   - Pagination

2. **Geo Search:**
   - PostGIS queries for radius search
   - Bounding box queries
   - Distance calculations

3. **Vector Search (if using pgvector):**
   - Embedding generation pipeline
   - Vector similarity queries
   - Hybrid search (RRF)

4. **Frontend Integration:**
   - Custom InstantSearch adapter
   - Or build custom search UI

## Performance Tips

### Indexes

```sql
-- Full-text search
CREATE INDEX houses_search_vector_idx 
ON houses 
USING gin(search_vector);

-- Geo search
CREATE INDEX houses_geom_idx 
ON houses 
USING gist(geom);

-- Vector search
CREATE INDEX houses_embedding_idx 
ON houses 
USING hnsw (embedding vector_cosine_ops);

-- Facet fields
CREATE INDEX houses_city_idx ON houses(city);
CREATE INDEX houses_property_type_idx ON houses(property_type);
CREATE INDEX houses_price_idx ON houses(price);
```

### Materialized Views

For expensive facet queries:

```sql
CREATE MATERIALIZED VIEW city_facet_counts AS
SELECT 
  city,
  count(*) as house_count
FROM houses
WHERE deleted_at IS NULL
  AND listing_status = 'active'
GROUP BY city;

CREATE UNIQUE INDEX city_facet_counts_city_idx 
ON city_facet_counts(city);

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY city_facet_counts;
```

## Next Steps

- See `overview.md` for query patterns and examples
- See `../shared/domain-modeling.md` for schema design
- See `../shared/comparison.md` to compare with other options
