# Automatic embeddings: PostgreSQL and native search engines

The default runnable comparison uses real PostgreSQL and real search appliances for every search mode. In-memory execution exists only as an explicitly selected internal fixture mode.

| Selection | Document generation | Durable storage / ranking | Query generation |
| --- | --- | --- | --- |
| Native PostgreSQL | PGMQ → bounded Node CPU worker | GIN/tsvector FTS and `vector(384)` cosine SQL | Node CPU MiniLM |
| PostgreSQL + pg_search 0.26.1 | Same durable PG worker | Native ParadeDB BM25 index + pgvector SQL | Node CPU MiniLM |
| Meilisearch 1.11.3 | Native `huggingFace` embedder over `semanticText` | Meilisearch vector index / native hybrid search | Meilisearch itself |
| Typesense 28.0 | Native custom ONNX `embed.from: [semanticText]` | Typesense vector index / native hybrid search | Typesense itself |

**No vectors are sent to either appliance.** The API sends source documents only. Source synchronization is queued, and appliance indexing completion is confirmed before a source version is marked synchronized. PostgreSQL vectors remain usable if an appliance is down. External semantic failures do not silently fall back to another engine.

PostgreSQL filters, ranking, geo radius, facet counts, totals, pagination, map records and saved-scope matching execute in SQL. Native FTS uses a transactional source-text projection with a generated tsvector/GIN index; pg_search uses an actual ParadeDB BM25 scan. Geo uses SQL spherical haversine distance, with no PostGIS claim. Appliances perform their own filtering/ranking/faceting/counting/pagination; complete native result IDs populate maps and saved scopes. All engines index the same nondeleted records, including sold listings. Debug exposes actual SQL or engine requests/responses, never illustrative SQL on the connected path.

## Run

Node ≥22.12, npm and Docker Compose:

```bash
npm ci
npm run native-models:prepare
npm run stack:full:detached
# Wait for app dependency installation and API readiness.
for attempt in $(seq 1 60); do
  curl -fsS http://127.0.0.1:5173/api/providers >/dev/null && break
  sleep 2
done
curl -fsS http://127.0.0.1:5173/api/providers >/dev/null && npm run seed
# Seed commits immediately; generation/indexing proceeds automatically.
curl http://127.0.0.1:5173/api/embedding-jobs
TEST_DISPOSABLE_STACK=1 DEMO_URL=http://127.0.0.1:5173 npm run verify:full-stack
```

Both `seed` and `verify:full-stack` reset demo data; the latter also edits a listing and requires explicit target/disposable-stack opt-in. Use only a disposable stack. If the API does not start, inspect `docker compose -f compose/docker-compose.full.yml logs app` after the bounded readiness wait fails.

`compose/Dockerfile.postgres` builds pinned pgvector **0.8.7** and PGMQ **1.13.0** plus official ParadeDB **pg_search 0.26.1** into PostgreSQL **15.19**. The pg_search package is AGPL-3.0-or-later and adds a 266.5 MiB native library; see [verified installation and license details](pg-search-installation.md). Source commit/archive hashes and the base image digest are pinned. No Redis, queue container, Supabase project, `pg_cron`, `pg_net`, Edge Function or paid API is needed. PGMQ uses ordinary logged queues, so `pg_partman` is not needed either.

For PostgreSQL only, use that image and set `DATABASE_URL`; leave `SEARCH_SYNC_PROVIDERS` empty. To enable appliances, set `SEARCH_SYNC_PROVIDERS=meilisearch,typesense` and the existing host/key variables. The full Compose file does this. The API automatically starts the bounded consumer; `EMBEDDING_WORKER_ENABLED=0` intentionally pauses consumption for maintenance/testing. An app role needs extension/schema creation rights on first setup; production deployments should separate migrations and runtime privileges.

`native-models:prepare` verifies SHA256 for every downloaded model artifact and writes the Rust Hugging Face cache plus Typesense's documented custom-model directory under ignored `data/native-models`. Run it before starting containers. Cached preparation works with `EMBEDDING_OFFLINE=1`; missing/invalid artifacts fail rather than bypass checks. Model traffic downloads public weights only. Listing and query text stays in the configured local services.

## Same model, native artifacts

All paths use the trained **all-MiniLM-L6-v2**, 384 dimensions, Apache-2.0. They intentionally use each engine's supported native runtime, not a new inference service.

- PostgreSQL worker: Transformers.js 3.8.1; pinned `Xenova/all-MiniLM-L6-v2` revision `751bff37182d3f1213fa05d7196b954e230abad9`, q8 ONNX, **22,972,370 bytes**, SHA256 `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`. Normalized masked mean pooling, 256-token cap, one ONNX thread
- Typesense: the **same exact q8 ONNX file**, plus the vocabulary reconstructed and validated from that pinned tokenizer. Native BERT tokenization/mean pooling supports up to 512 tokens; native output need not be unit-normalized because cosine handles its norm
- Meilisearch: `sentence-transformers/all-MiniLM-L6-v2` revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`, native Candle BERT float32 safetensors, **90,868,376 bytes**, SHA256 `53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db`. Version 1.11 uses native mean pooling and a 512-token cap; its native runtime cannot load the q8 ONNX artifact

These are the same base model, not a promise of numerically identical vectors across engines. Precision, tokenizer, truncation and pooling differ. Vectors are never mixed across engines. Native files total about 114 MB on disk, in addition to the Node model cache; process memory is larger than weight size. See [model provenance](cpu-embeddings.md).

Typesense **27.1 is deliberately rejected**: its native update path accumulated new embeddings into the previous vector. The fix landed in 28.0.rc34; **28.0 is the first subsequent stable release**. The committed regression compares a text-edited native vector against a fresh document with identical content. [Issue and maintainer confirmation](https://github.com/typesense/typesense/issues/2139), [fix](https://github.com/typesense/typesense/commit/7490fb4aef06c6728dfd4d710760283346fe2765)

Meili 1.11 requires its `vectorStore` experimental feature. The adapter enables this and configures a revision-pinned native embedder. Existing indexes are changed additively; incompatible native model/schema settings fail with a migration error instead of destroying an index. Configurations that could invoke unrelated paid embedding APIs are rejected.

## Change capture, queue and recovery

The canonical semantic fields are title, description, city/neighborhood names, school district, property type, amenities and tags. Set-valued arrays are sorted. Normalized semantic text and the full model/preprocessing identity are hashed. Price/status-only edits still synchronize source metadata but reuse the PostgreSQL vector.

Database triggers capture inserts, updates, deletes and relevant relationship changes **inside the source transaction**, including direct SQL writes. They only invalidate a durable per-house version; they never run inference or network requests. Rollback rolls back invalidation too. Initial data, restart with missing/model-stale vectors and manual backfill all enter the same path. The persisted projection identity includes enabled providers, engine hosts and native model configuration. A changed identity automatically invalidates existing projections, and SQL fences older differently configured consumers. Use one consistent pipeline configuration per database. Missing native indexes/configuration detected on a write or query trigger bounded source backfill; searches return 503 until it completes. Native configuration is revalidated on every write/query, including remote-embedder safety checks. A durable, idempotent repair marker invalidates source generations before any external setup mutation, so a lost response or restart cannot lose backfill intent or endlessly reset retry budgets.

- One durable invalidation row per house coalesces changes; a monotonic sequence fences old generations
- Admission: at most **100 PGMQ messages**, at most **20 per dispatch pass**, polled every second; additional source changes remain durably pending
- A dedicated PostgreSQL session advisory lock enforces **one live lock-owning document consumer across API processes**, without holding a transaction during inference or HTTP calls
- PGMQ visibility is **90s**, renewed every **30s**, with a **900s attempt cap**. A crashed worker's message becomes visible again. Visibility is not an exactly-once side-effect guarantee
- Every store, heartbeat and acknowledgement checks message delivery count, live visibility and source version under row locks. An expired/older attempt cannot acknowledge or overwrite its replacement
- At most **four delivery attempts**; failures back off 5/10/20 seconds (capped at 60 seconds). Exhausted work is archived with its error and is not silently re-admitted forever. A new source version or explicit backfill can retry it
- Successful/stale/failed archives are retained for seven days with bounded cleanup. Hard and soft deletes invalidate/remove PG vectors and queue appliance deletion
- Node query and document inference share one CPU lane, bounded pending batches and the existing 1024-entry text cache

Appliances are separate transactional systems: an already accepted HTTP write cannot be rolled back with PostgreSQL. An intervening edit leaves the latest desired version pending, so it is reconciled afterward. Native appliance queries wait for their source projection to be current rather than claiming stale results are complete.

A lost PostgreSQL consumer session releases its advisory lock immediately. Native ONNX inference already in flight is not cancellable, so a replacement consumer can briefly overlap abandoned computation until it returns. The concurrency setting describes one live lock-owning consumer, not a hard OS CPU cap across disconnected processes. Generation/lease checks still prevent abandoned output from being stored or acknowledged. Queue active counts reflect visible leases and can temporarily include an abandoned attempt.

## Status, backfill and search semantics

`GET /api/embedding-jobs` reports observed PGMQ states, current/missing PostgreSQL vector coverage, projection backlog, bounded retry details and errors. Historical completed-job counts are not a completion percentage. In-memory mode explicitly returns `durable:false`, `enabled:false`, and null queue/coverage data.

`POST /api/embedding-jobs/backfill` returns 202 with accepted/invalidated counts, **not completion**. It retries failed or missing/stale work. Existing `/api/sync/backfill` requests force source re-synchronization using cached current PG vectors; `/api/sync/worker/run` only requests admission because consumption is already automatic.

PostgreSQL uses an exact cosine scan through pgvector for this small corpus, not an ANN index. Semantic threshold is 0.35; hybrid retains the existing 55% lexical/45% cosine policy. Each appliance uses its own native semantic/hybrid policy, so identical hit counts/scores across engines are not promised. Native engine pagination and facets are used directly; a second bounded native query retrieves the complete map/saved-scope result set, with a deliberate **1,000-document appliance demo cap**. Native debug includes the actual requests/responses. Native scores retain engine-specific meaning and are not comparable percentages. Missing services fail visibly; no connected request falls back to local fixtures.

## Verification and measured costs

- `npm run verify:appliance-readiness`: deterministic fetch-contract regressions for index loss, schema drift, remote embedder safety and complete native pagination
- `npm run verify:embeddings`: actual Node inference and in-memory API, caching, offline reload and failure recovery
- `TEST_DATABASE_URL=... npm run verify:embedding-queue`: real PostgreSQL/PGMQ/pgvector, deterministic inference barriers for race tests; eleven groups cover rollback, admission/coalescing, expired/crashed leases, stale writes/acks, retry cap, manual retry, deletion, outage, multiple consumers, restart and projection configuration fencing and durable ambiguous-repair intent
- `TEST_DATABASE_URL=... TEST_DISPOSABLE_ENGINES=1 npm run verify:native-embeddings`: owned disposable API and **real model/engines**. Initial load, native query paths, field edits, update-versus-fresh equivalence, direct SQL/reference changes, restart, deletes, pagination, facets/maps/saved scopes. Only explicit disposable database names are accepted; the explicit engine opt-in confirms the configured engine instances are also disposable, because their houses index/collection is replaced
- `TEST_DATABASE_URL=... TEST_PG_SEARCH=1 npm run verify:postgres-search`: real GIN FTS, ParadeDB BM25, pgvector, SQL filters/geo/maps/facets/counts, full fixture inference and snapshot-consistent hit metadata
- Dedicated `Real search comparison` CI builds the pinned PG image and runs official Meili/Typesense containers. Its PORT=0/IPC-owned API wrapper seeds only its validated disposable database, runs real browser acceptance across all four providers, then captures genuine map-ready screenshots. An unrelated fixed-port responder is never seeded. Internal fixture UI regressions are a separately labeled job, not acceptance screenshots

Measured 2026-10-13 on dot's Linux x64 AMD EPYC 9V74, Node 24.19, one Node/Meili inference thread, small demo fixtures:

| Measurement | Observed |
| --- | --- |
| Node cached-file cold load + first text |299ms |
|16 genuinely new short query embeddings (all cache misses) |median 1.77ms; range 1.40–2.67ms |
|Repeated in-process embedding cache hit |median 0.003ms; no inference |
|46 unique document texts from 126 fixture rows, warm batches |315ms, about 146 unique texts/s |
|Node process RSS after that run |222MiB |
|Meili native fresh short text queries, two-document proof |15–24ms |
|Meili native process RSS, same proof |272MiB |
|Full 126-row automatic PG + BM25 + Meili generation/source sync |112s, serial job processing including native indexing/task confirmation |
|Full real application fresh query HTTP, 126 rows |PG 18–39 ms; Meili 196–201 ms, including native page/facet and complete map queries |

The first [official-container CI run](https://github.com/rothnic/faceted-search/actions/runs/38460316586) also passed all native integration checks and all 12 real-browser cases. Its 126-row automatic pipeline took 132.7s. Three fresh full-API semantic queries per provider measured PostgreSQL 16.5–18.9ms, pg_search selection 22.1–24.1ms (semantic uses pgvector), Meili 96.1–237.3ms and Typesense 25.0–33.3ms. These include API/filter/map work, not isolated inference. The post-test Docker memory snapshot was PostgreSQL 75.66MiB, Meili 300MiB and Typesense 176.3MiB; it is neither peak usage nor total application memory. The [diagnostic artifact](https://github.com/rothnic/faceted-search/actions/runs/38460316586/artifacts/11846251051) preserves the snapshot. That run failed afterward in screenshot automation, so its backend/browser results do not establish visual acceptance.

The earlier PR1 ~1.6ms **repeat API query was cached**, not a fresh model benchmark. Weight download time, model initialization, fresh inference, result scanning and cache hits are different costs. These small-fixture observations are not production capacity guarantees. Clean Typesense native acceptance is performed in the official container: this cloud host has an unrelated ONNX shared-provider library that triggers the standalone binary's CUDA autodetection. No host libraries/security settings are changed.

### Primary implementation references

- [Supabase automatic embeddings pattern](https://supabase.com/docs/guides/ai/automatic-embeddings), [Supabase Queues / PGMQ](https://supabase.com/docs/guides/queues)
- [PGMQ1.13 installation](https://github.com/pgmq/pgmq/blob/v1.13.0/INSTALLATION.md), [SQL implementation](https://github.com/pgmq/pgmq/blob/v1.13.0/pgmq-extension/sql/pgmq.sql)
- [pgvector0.8.7](https://github.com/pgvector/pgvector/blob/v0.8.7/README.md)
- [Meili 1.11 native BERT implementation](https://github.com/meilisearch/meilisearch/blob/v1.11.0/milli/src/vector/hf.rs)
- [Typesense28 native/custom embedding schema and queries](https://typesense.org/docs/28.0/api/vector-search.html#using-your-own-models)
