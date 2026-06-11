# pg_search Extension

PostgreSQL with ParadeDB's open source pg_search extension for BM25 search and faceting.

## Critical Understanding

**pg_search is a PostgreSQL EXTENSION, not an external service.**

```
PostgreSQL + pg_search extension
├─ Source of truth
├─ BM25 search indexes (INSIDE Postgres)
├─ Built-in faceting
└─ No external sync needed
```

## Architecture Distinction

This is **fundamentally different** from Meilisearch/Typesense:

| Aspect | pg_search | Meilisearch/Typesense |
|--------|-----------|----------------------|
| Location | Inside Postgres | External service |
| Sync needed | No | Yes |
| Consistency | Immediate | Eventually consistent |
| Outbox table | Not needed | Required |
| Sync worker | Not needed | Required |

## Documentation

- **`overview.md`** - BM25 search, faceting with pdb.agg(), hybrid search patterns
- **`deployment.md`** - Docker Compose with ParadeDB image, extension installation

## When to Use

- Postgres-first architecture
- Want to avoid external search services
- Don't need InstantSearch.js out-of-box
- Comfortable building custom API layer

## What You Build

- SQL query builder using `@@@` operator and `pdb.agg()`
- Custom InstantSearch adapter
- Facet response formatting
- Autocomplete endpoint
- Saved search evaluator

## What You DON'T Build

- ❌ Sync worker
- ❌ Outbox table
- ❌ Document denormalization pipeline
- ❌ External index backfill

## Trade-offs

✅ **Pros:**
- No external services
- No sync pipeline
- Immediate consistency
- BM25 ranking better than tsvector

❌ **Cons:**
- More custom backend code
- No off-the-shelf InstantSearch.js
- Need to build API layer
- AGPL-3.0 license (consult legal for SaaS)

## License Note

pg_search is AGPL-3.0:
- ✅ Free to use
- ✅ Can use in commercial applications
- ⚠️ Network service clause may apply to SaaS
- Consult legal counsel for specific guidance
