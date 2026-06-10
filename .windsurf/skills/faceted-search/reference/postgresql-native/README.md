# PostgreSQL-Only Search

Native PostgreSQL search using tsvector, pg_trgm, PostGIS, and optionally pgvector.

## Architecture

```
PostgreSQL
├─ Source of truth
├─ Search layer (tsvector)
├─ Geo layer (PostGIS)
└─ Vector layer (pgvector, optional)
```

**No external services. No sync pipeline needed.**

## Documentation

- **`overview.md`** - Full-text search, faceting, geo queries, hybrid search patterns
- **`deployment.md`** - Docker Compose setup, indexes, performance tuning

## When to Use

- Small to moderate datasets (<100k records)
- Internal tools
- Simple search requirements
- Minimal infrastructure

## What You Build

- SQL query builder
- Facet aggregation logic
- Custom InstantSearch adapter (if using InstantSearch.js)
- Geo search queries
- Vector search queries (if using pgvector)

## Trade-offs

✅ **Pros:**
- Fewest services
- Immediate consistency
- Full SQL control

❌ **Cons:**
- Most application code
- Limited faceting performance
- No typo tolerance
- No InstantSearch.js integration
