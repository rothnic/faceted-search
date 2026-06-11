# Provider Comparison Guide

The demo keeps the frontend search contract stable while switching among four provider modes.

| Provider | Source of truth | Search index | Sync required | Direct InstantSearch route |
| --- | --- | --- | --- | --- |
| Native PostgreSQL | PostgreSQL | PostgreSQL `tsvector`, PostGIS, pgvector | No | No |
| PostgreSQL + `pg_search` | PostgreSQL | Postgres extension index plus PostGIS/pgvector | No | No |
| PostgreSQL + Meilisearch | PostgreSQL | Meilisearch flattened documents | Yes | `/search/instant/meilisearch` |
| PostgreSQL + Typesense | PostgreSQL | Typesense collection documents | Yes | `/search/instant/typesense` |

The local runnable implementation simulates provider ranking and external indexes in-process, but exposes the SQL or request payload shape each production provider would use.
