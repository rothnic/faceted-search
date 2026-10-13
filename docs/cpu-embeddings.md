# Local CPU embeddings

Semantic and hybrid searches now run a real, quantized sentence embedding model in the Node API. No GPU, Python service, API key, paid inference API, or vector database is needed. Listing/query text stays in the API process; the only model-related network traffic downloads public model files from Hugging Face.

## Model and runtime

- [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2), the ONNX export of [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- Both model cards declare Apache-2.0. Weights are downloaded at runtime, not committed to this repository
- Immutable revision: `751bff37182d3f1213fa05d7196b954e230abad9`
- [Quantized ONNX artifact](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/onnx/model_quantized.onnx): 22,972,370 bytes (21.9 MiB), SHA-256 `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`
- Pinned `@huggingface/transformers` 3.8.1 and lockfile; [official Node inference guide](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node)
- Explicit `device: cpu`, `dtype: q8`, mean pooling, normalization and 384 dimensions. One intra-op/inter-op ONNX thread, batches of up to 16 texts, 256-token truncation
- English short-text model. It is not a housing-specific model, a multilingual guarantee, or a factual query interpreter

## Run and inspect

```bash
npm ci
npm run dev
# Open http://127.0.0.1:5173/search?mode=semantic&q=effortless%20upkeep%20condominium%20beside%20eateries
```

The example has zero keyword matches, but ranks the low-maintenance condo close to restaurants first with the pinned model. The first non-empty semantic/hybrid query downloads the model. Live saved-search counts can also trigger initialization. Blank searches, ordinary keyword searches and `GET /api/embeddings` do not load it.

`GET /api/embeddings` reports the exact model, revision, device, precision, dimensions, idle/loading/ready/error state, current download file/bytes when available, load duration, active batches and cache counters. Ready means the runtime is loaded, not that every possible document has been embedded. Search debug includes `execution: local-cpu`, the model identity and the similarity threshold. Each semantic hit also includes `semanticScore` (raw cosine).

The companion UX change presents model loading/errors and unavailable live counts. Without that frontend change, the original UI can wait on saved-search initialization and displays only generic request failures; the API itself returns explicit errors.

### Cache and offline use

```bash
# Populate the model cache and verify real inference/API behavior:
npm run verify:embeddings

# Afterwards, prohibit downloads and use the same pinned cache:
EMBEDDING_OFFLINE=1 npm run dev
```

`EMBEDDING_CACHE_DIR` overrides the default `data/models` directory. Offline mode reads only that directory's exact model/revision subdirectory and fails clearly if files are missing. Copy the complete model/revision directory when transferring a cache. Changing or corrupting files in that cache is unsupported. A failed load returns HTTP 503 for affected semantic queries; keyword and unscoped blank searches remain usable. Failed initialization/cache entries are cleared so a later request can retry. Missing live saved-search counts return `currentHitCount: null` plus `evaluationError`, never an invented zero count.

Document/query vectors are process-local, bounded to 1,024 cached texts, and keyed by the immutable model revision plus normalized content. Concurrent identical requests share work. Changed semantic text gets a new vector; price-only changes reuse it. Deleted listings are removed from candidates even while their old vector awaits LRU eviction. Vectors are recomputed after a process restart; only model artifacts persist on disk.

The `.npmrc` skips optional CUDA downloads. For package managers that do not honor custom npm config, explicitly set `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` while installing. A clean CPU-only install of this whole app was about 560 MiB; the small model download is additional to the JavaScript/native runtime dependencies. ONNX native CPU requires a supported platform; the full-stack Compose app now uses Debian Node 22 and a separate dependency volume instead of Alpine and host-native `node_modules`.

## Ranking and provider boundaries

1. Apply saved-search union, deletion, structured fields, geo and viewport constraints
2. Embed the remaining listings and query using the same model/revision
3. Semantic mode admits cosine similarity at least `0.35`, ordered by cosine unless another sort was requested
4. Hybrid admits a keyword match OR cosine at least `0.35`, then ranks `0.55 × keyword score + 0.45 × nonnegative cosine`

The fixed threshold is a POC relevance choice, not a probability. Calibrate it and hybrid weights against labeled examples before production. Broad questions can still return weak matches. Long text is truncated, and structured filters remain necessary for exact price, bedroom, location and other numeric constraints. Score is not a percentage confidence.

All four provider selections use this same application-side ranker for semantic/hybrid requests, including when listings come from real PostgreSQL. This is not an implementation of pgvector, `pg_search`, Meilisearch embedders, or a Typesense vector index. Real external-engine keyword routes, backfill/sync and direct InstantSearch adapters retain their existing behavior. Local semantic hits, facets, map markers, total counts, saved-search scopes and live counts derive from the same full candidate set. Saved-search tracking includes all local matched IDs rather than just the visible page.

Exact scanning and in-memory caching suit this 126-row demo. This is not a production serving/ANN architecture; large corpora would need persistent model-versioned vectors, an index and operational limits. There is no new scheduler or background indexing service.

## Verification and measurements

```bash
npm run typecheck
npm run web:build
npm run verify:embeddings
```

The verification command starts disposable API processes with temporary saved-search data. It runs actual model inference, validates finite unit-length 384d vectors and truncation, compares lexical and semantic retrieval, checks all provider IDs, pagination/map/facets/geo, saved-search union/counts and full seen-ID tracking, validates concurrent/repeated caches and content/deletion changes, tests missing-model 503 recovery, and reloads a cached model with every network fetch forbidden. It does not require external engines or mutate a configured PostgreSQL instance.

Measured October 13, 2026 on Linux x64, Node 24.19.0, AMD EPYC 9V74 cloud CPU, one ONNX inference thread. These are a single fixture run, not a benchmark guarantee:

| Operation | Observed |
| --- | --- |
| Empty disk cache: download, initialize, embed two texts | 15.4 s |
| Existing disk cache: initialize and embed two texts | 295 ms |
| Fresh API process: first 126-row semantic query with cached weights | 413 ms |
| Repeat identical API query with vectors cached | 1.6 ms |
| Verifier process resident memory after inference | 251 MiB |

The synthetic fixture repeats content across rows, so deduplication reduces actual document inference. Results and timing vary with runtime version, hardware, query, model cache, content length and corpus diversity. Docker/real PostgreSQL/Meilisearch/Typesense integration must be verified separately with `npm run verify:full-stack`; the CPU verifier does not establish those services are running.
