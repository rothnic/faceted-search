# Provider Comparison Guide

The demo keeps the frontend search contract stable while switching among four provider modes.

| Provider | Source of truth | Search index | Sync required | Direct InstantSearch route |
| --- | --- | --- | --- | --- |
| Native PostgreSQL | PostgreSQL | PostgreSQL `tsvector`, PostGIS, pgvector | No | No |
| PostgreSQL + `pg_search` | PostgreSQL | Postgres extension index plus PostGIS/pgvector | No | No |
| PostgreSQL + Meilisearch | PostgreSQL | Meilisearch flattened documents | Yes | `/search/instant/meilisearch` |
| PostgreSQL + Typesense | PostgreSQL | Typesense collection documents | Yes | `/search/instant/typesense` |

The table above describes production provider strategies. In this runnable POC, all semantic/hybrid requests use real [local CPU embeddings](cpu-embeddings.md), without querying provider-native vector indexes. Native PostgreSQL and pg_search keyword ranking is still application-side, with illustrative SQL. Meilisearch and Typesense keyword requests use real services when configured, otherwise an explicitly labeled local fallback.
