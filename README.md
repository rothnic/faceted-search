# Searchlab

Searchlab compares real PostgreSQL FTS/pgvector, PostgreSQL with pg_search, Meilisearch, and Typesense over a connected PostgreSQL source dataset. The new Next.js App Router page lives in `apps/web-next`; the retained Vite UI remains available for comparison.

**The application has no in-memory/demo search mode.** `DATABASE_URL` and a public `DATASET_ID` are required. `DEMO_MEMORY` is rejected. Missing configuration, an unhealthy selected backend, or an unverifiable response produces an error. No other provider or fixture dataset is substituted.

## Connect the actual backends

Use your existing approved connection configuration; do not put credentials in source or browser variables.

- `DATABASE_URL`: the actual PostgreSQL connection, including pgvector/PGMQ and pg_search where that provider is used.
- `DATASET_ID`: an explicit public label identifying the intended source dataset, for example `searchlab-dev`. This is a label, not a secret.
- `SEARCH_SYNC_PROVIDERS`: explicitly enable `meilisearch,typesense` when those appliances are configured.
- `MEILI_HOST`, `MEILI_MASTER_KEY`, `TYPESENSE_HOST`, `TYPESENSE_API_KEY`: the actual appliance configuration. Endpoint and development-key defaults are not supplied by the application.

```sh
npm ci
# Supply DATABASE_URL, DATASET_ID and the actual appliance settings in your environment.
npm run api:dev
```

`npm run dev` starts the real Compose stack described in `compose/docker-compose.full.yml`. It does not seed sample listings. An empty connected database returns zero records. Existing volumes retain their real persisted contents.

## Run the Next.js page

```sh
cd apps/web-next
bun install --frozen-lockfile
bun run build
# Explicit runtime connection and expected dataset; there is no default API destination.
SEARCH_API_ORIGIN=http://127.0.0.1:5173 SEARCH_EXPECTED_DATASET_ID=searchlab-dev bun run start
```

Open <http://localhost:3001/search>. `SEARCH_EXPECTED_DATASET_ID` must match the API's configured public label. Optionally pin `SEARCH_EXPECTED_DATABASE_FINGERPRINT` to the database fingerprint returned by `GET /api/providers`. The Next boundary rejects missing provenance, a different responding provider, a mismatched dataset/fingerprint, invalid counts, and backend failures. Older APIs without provenance are intentionally rejected.

The page sends ranking, filtering, facet evaluation, counts, and saved scopes to the selected real backend. Input is debounced; replaced requests are cancelled and stale results suppressed. Map code and browser map records wait until Map/Split is selected. The API adapter only omits unused records; it does not calculate search results or substitute counts.

## Identify what answered

Every successful API search and the Next.js results page show:

- Selected and responding provider, storage, and actual execution path.
- Public dataset label, a hash of a persisted database UUID, a content revision, and a PostgreSQL count of active source rows.
- API elapsed time and the search-operation portion measured by the API's monotonic clock. These include server orchestration and query embedding where applicable; they are not claimed as pure SQL execution time.
- Next gateway elapsed time and browser fetch time, labeled separately. Browser fetch time excludes the input debounce.

Raw connection strings, host addresses, database names, credentials, and upstream error bodies are not exposed. The source identity/count is observed after search and does not assert an atomic search snapshot or external index freshness. The source-record count is an observed PostgreSQL count, not an invented selected-provider inventory total. RESULTS-02 and DATA-03 acceptance remain separate.

## Tests and test data

Fixtures are isolated in `packages/test-fixtures`, `tests/support`, explicit test files and verification scripts. The production API does not import fixtures and has no `/api/seed` route. The internal fixture server requires `NODE_ENV=test`, refuses database connections, and is not an application mode.

```sh
npm run typecheck
npm test
cd apps/web-next
bun run test
bun run test:e2e
```

Real integration tests use explicitly named disposable databases and appliances. To populate **only** a disposable test database:

```sh
TEST_DISPOSABLE_STACK=1 TEST_DATABASE_URL='<approved disposable faceted_native_test[_suffix] connection>' npm run seed:test
```

Never point destructive integration verifiers at valuable or shared source data. Native integration CI creates its own real PostgreSQL/search engines, seeds through the test-only helper, and tears them down.

## Scope and evidence

The earlier Next.js foundation at `02ddac0` passed production build, focused tests and actual PostgreSQL keyword browser checks at 390/1440px: `garage` returned 35 matches with 18 loaded; `pool` returned 31, narrowed to 18 by a maximum price. Those observations did not establish Next.js live acceptance for the other providers or modes. Later authenticity corrections require their own source-bound evidence.

Saved-search UI actions/restoration, rich detail overlays, geographic-origin controls and remaining pages are not migrated in this foundation. DATA-03 viewport/zoom/clustering/database payload criteria and RESULTS-02 provider inventory semantics remain unaccepted. See [migration boundaries](apps/web-next/MIGRATION.md) and [automatic embeddings](docs/automatic-embeddings.md).

Repository: `apps/api` real API; `apps/web-next` Next.js page; `apps/web-angular` retained Vite UI; `packages/search-contracts` shared contracts; `tests/support` explicit test servers and seeding; `scripts` integration verification and operations.
