# Implementation Notes

- The API uses `HouseSearchRequest` and `HouseSearchResponse` for every provider.
- Native PostgreSQL and `pg_search` providers return SQL-oriented debug output.
- Meilisearch and Typesense providers return engine request-oriented debug output.
- External providers use the same canonical `HouseSearchDocument` transform before converting to Meilisearch `_geo` or Typesense `location` fields.
- Saved searches are persisted in `data/saved-searches.json` for the runnable local demo. In a production version, this maps directly to the required Postgres `saved_searches` table.
- Semantic and hybrid ranking are simulated locally with deterministic intent expansions so the UI can demonstrate unsupported/simulated behavior without external embedding services.
