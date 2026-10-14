# Provider Behavior Matrix

This table describes production provider capabilities. The runnable POC uses [real local CPU embeddings](cpu-embeddings.md) for semantic/hybrid mode across all four selections; it does not configure these provider-native vector indexes.

| Feature | Native PostgreSQL | `pg_search` | Meilisearch | Typesense |
| --- | --- | --- | --- | --- |
| Keyword search | `tsvector` | BM25 extension | Built in | Built in |
| Facets | Manual SQL | Extension facets | Built in | Built in |
| Geo radius | PostGIS | PostGIS | `_geoRadius` filters | Geopoint filters |
| Semantic | pgvector | pgvector | Embedders | Vector field or auto embedding |
| Hybrid | Custom rank | BM25 plus vector rank | Hybrid search | Hybrid search |
| Saved searches | Postgres table | Postgres table | Postgres table, evaluated through engine | Postgres table, evaluated through engine |
| Sync | None | None | Outbox and worker | Outbox and worker |
