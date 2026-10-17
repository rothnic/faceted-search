# CPU model verification

The former application in-memory search mode has been removed. There is no demo runtime or local-scoring substitute for a selected backend. For connected PostgreSQL/pgvector and appliance-native search, follow [automatic embeddings](automatic-embeddings.md) and the [root setup instructions](../README.md).

The CPU runtime uses Xenova/all-MiniLM-L6-v2, pinned revision 751bff37182d3f1213fa05d7196b954e230abad9, through Transformers.js 3.8.1. It generates query/document vectors for PostgreSQL; ranking and filtering remain in PostgreSQL. Meilisearch and Typesense generate vectors in their configured native runtimes.

Run `npm run verify:embeddings` for explicit model inference, cache/offline, and failure-recovery tests. Its API mechanics use the guarded test-only fixture entry under tests/support; passing that suite does not verify a connected search appliance. EMBEDDING_OFFLINE=1 uses an already populated pinned model cache and fails if the required files are absent.

GET /api/embeddings reports CPU model state and cache measurements. A ready model or a cache hit is not evidence of search-index freshness. Connected search provenance reports the actual selected execution path and source dataset separately.
