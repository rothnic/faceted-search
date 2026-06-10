# Deployment Overview

General Docker Compose conventions and environment setup for all search stack options.

## Architecture Options

### PostgreSQL-Only
```
PostgreSQL is both database and search layer
No external services
```

**See:** `../postgresql-native/deployment.md`

### PostgreSQL with pg_search Extension
```
PostgreSQL + pg_search extension
Search indexes live INSIDE Postgres
No external sync needed
```

**Key distinction:** pg_search is a Postgres extension, NOT an external service. The search index lives inside your PostgreSQL database.

**See:** `../pg-search/deployment.md`

###PostgreSQL + Meilisearch
```
PostgreSQL = source of truth (normalized)
Meilisearch = external search index (denormalized)
Sync worker = transforms and syncs
```

**Key distinction:** Meilisearch is an external service that requires a sync pipeline.

**See:** `../meilisearch/deployment.md`

### PostgreSQL + Typesense
```
PostgreSQL = source of truth (normalized)
Typesense = external search index (denormalized)
Sync worker = transforms and syncs
```

**Key distinction:** Typesense is an external service that requires a sync pipeline.

**See:** `../typesense/deployment.md`

## General Conventions

### Directory Structure

```
project/
├── .env
├── docker-compose.yml
├── docker/
│   └── postgres/
│       └── init/
│           └── 001_extensions.sql
└── search-worker/          # Only for Meilisearch/Typesense
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── worker.ts
        ├── db.ts
        └── search/
```

### Environment Variables

`.env`:

```env
# PostgreSQL
POSTGRES_USER=app
POSTGRES_PASSWORD=app_password
POSTGRES_DB=house_search

DATABASE_URL=postgresql://app:app_password@postgres:5432/house_search

# Meilisearch (if used)
MEILI_MASTER_KEY=dev_meili_master_key_change_me
MEILI_HOST=http://meilisearch:7700

# Typesense (if used)
TYPESENSE_API_KEY=dev_typesense_api_key_change_me
TYPESENSE_HOST=http://typesense:8108
```

**Security warning:** Do not use weak keys in production. For local dev, readable keys are acceptable. For shared environments, use proper secrets management.

### Common Initialization Scripts

`docker/postgres/init/001_extensions.sql`:

**For PostgreSQL-only:**

```sql
-- Full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Geospatial
CREATE EXTENSION IF NOT EXISTS postgis;

-- Vector search (if image includes pgvector)
-- CREATE EXTENSION IF NOT EXISTS vector;
```

**For pg_search extension:**

```sql
-- ParadeDB pg_search extension (open source, AGPL-3.0)
CREATE EXTENSION IF NOT EXISTS pg_search;

-- Optional if available in image:
-- CREATE EXTENSION IF NOT EXISTS vector;
-- CREATE EXTENSION IF NOT EXISTS postgis;
```

**For Meilisearch/Typesense:**

Same as PostgreSQL-only (pg_search not needed since search is external).

## Version Pinning

Always pin versions in production:

```yaml
# Bad
image: postgres:latest

# Good
image: postgis/postgis:17-3.5
```

Check official sources:
- [PostgreSQL Docker Hub](https://hub.docker.com/_/postgres)
- [PostGIS Docker Hub](https://hub.docker.com/r/postgis/postgis)
- [ParadeDB Releases](https://github.com/paradedb/paradedb/releases)
- [Meilisearch Releases](https://github.com/meilisearch/meilisearch/releases)
- [Typesense Releases](https://github.com/typesense/typesense/releases)

## Security Best Practices

### Don't Expose Admin Keys to Frontend

For frontend search, create restricted/search-only keys:

**Meilisearch:**
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

**Typesense:**
Generate scoped API keys in your application.

### Use Secrets Management

```yaml
# Use secrets for production
environment:
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # From secrets manager
  MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}    # From secrets manager
  TYPESENSE_API_KEY: ${TYPESENSE_API_KEY}  # From secrets manager
```

Never commit secrets to version control.

## Resource Limits

Add resource limits for production:

```yaml
services:
  postgres:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

## Monitoring

Set up monitoring for:
- Database health
- Search engine health (if external)
- Sync worker health (if using Meilisearch/Typesense)
- Query latency
- Index size growth
- Failed operations

## Backup Strategy

**PostgreSQL:**
```bash
# Automated backups
docker compose exec postgres pg_dump -U app house_search > backup.sql
```

**External search engines (Meilisearch/Typesense):**
- Not required (rebuildable from PostgreSQL)
- Optional: Snapshot for faster disaster recovery

**pg_search indexes:**
- Backed up with PostgreSQL (part of database)
- No separate backup strategy needed

## Which Stack to Choose

See `comparison.md` for detailed comparison.

**Quick decision guide:**

- **PostgreSQL-only**: Smallest stack, simplest search
- **pg_search extension**: Postgres-native search, no external services
- **Meilisearch**: Fastest external search setup, good defaults
- **Typesense**: Best external search for faceting + geo + semantic

## Next Steps

Choose your stack and see the specific deployment guide:

- `../postgresql-native/deployment.md`
- `../pg-search/deployment.md`
- `../meilisearch/deployment.md`
- `../typesense/deployment.md`
