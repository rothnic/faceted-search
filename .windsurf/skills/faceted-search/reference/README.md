# Faceted Search Reference Documentation

Documentation organized by search option for easy navigation.

## Directory Structure

```
reference/
├── postgresql-native/      # PostgreSQL-only search
├── pg-search/              # PostgreSQL + pg_search extension
├── meilisearch/            # PostgreSQL + Meilisearch external service
├── typesense/              # PostgreSQL + Typesense external service
└── shared/                 # Cross-cutting documentation
```

## Quick Start

### 1. Choose Your Stack

**Need help deciding?** Start here:
- Read `shared/comparison.md` for detailed comparison
- Review `shared/deployment-overview.md` for architecture overview

### 2. Explore Your Option

Each search option has its own directory with:
- `README.md` - Quick overview and trade-offs
- `overview.md` - Complete query patterns and examples
- `deployment.md` - Docker Compose setup

### 3. Review Shared Concepts

All options benefit from:
- `shared/example-schema.md` - Complete PostgreSQL schema for house search example
- `shared/domain-modeling.md` - Schema design patterns
- `shared/embeddings.md` - Semantic search strategies
- `shared/saved-searches.md` - Saved search implementation
- `shared/autocomplete.md` - Autocomplete patterns
- `shared/frontend-integration.md` - InstantSearch.js integration

## Architecture Understanding

### PostgreSQL-Native Options (No External Sync)

**Options:** `postgresql-native/`, `pg-search/`

```
PostgreSQL database
├─ Source of truth
└─ Search indexes INSIDE Postgres
```

**Key traits:**
- No external service
- No sync pipeline needed
- Immediate consistency
- More custom backend code

### External Search Services (Require Sync)

**Options:** `meilisearch/`, `typesense/`

```
PostgreSQL (source of truth)
  ↓ triggers → outbox table
  ↓ sync worker
  ↓
External search service
```

**Key traits:**
- External service to manage
- Sync pipeline with outbox + triggers
- Eventually consistent
- Less custom frontend code

## Navigation Guide

### I want PostgreSQL-only search
→ Go to **`postgresql-native/`**
- Smallest stack
- Uses tsvector, PostGIS, optionally pgvector
- No external services

### I want search inside PostgreSQL without external services
→ Go to **`pg-search/`**
- PostgreSQL extension (not external service)
- BM25 search and built-in faceting
- No sync pipeline needed
- Open source (AGPL-3.0)

### I want fastest time-to-market with external search
→ Go to **`meilisearch/`**
- External search service
- Good defaults out-of-box
- Direct InstantSearch.js integration
- Requires sync pipeline

### I want best faceting + geo + semantic control
→ Go to **`typesense/`**
- External search service
- Strong schema and faceting
- Auto-embedding with field control
- Requires sync pipeline

### I'm comparing all options
→ Read **`shared/comparison.md`**

### I need to see the example schema
→ Read **`shared/example-schema.md`**

### I'm designing my schema
→ Read **`shared/domain-modeling.md`**

### I'm implementing semantic search
→ Read **`shared/embeddings.md`**

### I'm building saved searches
→ Read **`shared/saved-searches.md`**

### I'm adding autocomplete
→ Read **`shared/autocomplete.md`**

### I'm integrating the frontend
→ Read **`shared/frontend-integration.md`**

## Key Files by Topic

### Deployment
- `postgresql-native/deployment.md` - Native PostgreSQL Docker setup
- `pg-search/deployment.md` - pg_search extension Docker setup
- `meilisearch/deployment.md` - Meilisearch + sync worker setup
- `typesense/deployment.md` - Typesense + sync worker setup
- `shared/deployment-overview.md` - General Docker conventions

### Search Patterns
- `postgresql-native/overview.md` - tsvector, PostGIS, pgvector queries
- `pg-search/overview.md` - BM25, faceting with pdb.agg()
- `meilisearch/overview.md` - Meilisearch search queries
- `typesense/overview.md` - Typesense search and schema

### Sync Pipeline (External Services Only)
- `meilisearch/sync-pipeline.md` - Complete sync worker for Meilisearch
- `typesense/sync-pipeline.md` - Complete sync worker for Typesense

### Domain & Schema
- `shared/example-schema.md` - Complete PostgreSQL schema with sample data and queries
- `shared/domain-modeling.md` - Document structure and denormalization
- `shared/embeddings.md` - Semantic text and embedding generation
- `shared/comparison.md` - Feature comparison across all options

### Features
- `shared/saved-searches.md` - Saved search and alerting implementation
- `shared/autocomplete.md` - Autocomplete and suggestions
- `shared/frontend-integration.md` - InstantSearch.js patterns

## Decision Summary

| Need | Best Option |
|------|-------------|
| Fewest services | `postgresql-native/` |
| Postgres-native search | `pg-search/` |
| Fastest implementation | `meilisearch/` |
| Best faceting control | `typesense/` |

## Important Distinctions

### pg_search vs ParadeDB

- **pg_search** = Open source PostgreSQL extension (AGPL-3.0)
- **ParadeDB** = Company offering managed service (commercial)
- **paradedb/paradedb** = Docker image with PostgreSQL + pg_search pre-installed

This skill focuses on the open source pg_search extension, not commercial ParadeDB services.

### External Service vs PostgreSQL Extension

**pg_search is NOT an external service like Meilisearch/Typesense.**

It's a PostgreSQL extension where search indexes live INSIDE your Postgres database. You don't need:
- ❌ External search service
- ❌ Sync worker
- ❌ Outbox table
- ❌ Document denormalization pipeline

This is a critical architectural distinction that affects implementation effort and system design.
