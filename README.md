# Search Options Demo

Runnable TypeScript demo for comparing faceted, geo-aware, semantic, and saved-search behavior across search provider strategies for location-based housing data.

The app is intentionally small enough to inspect end to end: a Node API/static server, a Vite-bundled frontend, shared search contracts, deterministic fixtures, sync/backfill scripts, and Playwright coverage.

## Search Options

| Option | Backend shape | Implemented behavior |
| --- | --- | --- |
| Native PostgreSQL | Source-of-truth database with local geo filtering and real CPU embeddings | Keyword, semantic, and hybrid scoring; manual facets; range filters; geo radius; distance sorting; saved-search evaluation |
| PostgreSQL with `pg_search` | Postgres-hosted search extension strategy | Same frontend contract as native Postgres, with debug output showing the `pg_search`/BM25 request shape |
| PostgreSQL plus Meilisearch | External search index synchronized from Postgres | Facets, range filters, geo filtering/sorting, hybrid search shape, direct InstantSearch demo, backfill, and sync-worker controls |
| PostgreSQL plus Typesense | External search collection synchronized from Postgres | Faceted collection schema, geopoint and vector-query shape, direct InstantSearch demo, backfill, and sync-worker controls |

Semantic and hybrid queries use a real, pinned MiniLM model on the Node CPU for every provider selection. Keyword queries can use real Meilisearch/Typesense; unavailable external engines fall back to the local scorer with an explicit warning. SQL examples remain illustrative, and no external vector index is configured. See [CPU embeddings](docs/cpu-embeddings.md) for the model, offline setup, resource limits and measured latency.

## Features

### Search Experience

- **Debounced updates** - Search text updates results, facets, and debug output without replacing the focused search box.
- **Search suggestions** - Suggestions come from listing titles, saved-search names, cities, neighborhoods, amenities, and property types.
- **Search modes** - Keyword, semantic, and hybrid modes share the same frontend contract. Semantic search uses quantized 384-dimensional MiniLM embeddings; hybrid combines lexical relevance and cosine similarity.
- **Sort modes** - Results can be sorted by relevance, distance, price, or newest update.
- **Virtualized infinite results** - The main result pane uses TanStack Virtual to render only visible cards while appending more API pages as the user scrolls.

### Filtering And Facets

- **Facet rail** - City, neighborhood, school district, property type, bedrooms, amenities, and listing status are exposed as left-rail filters.
- **Bounded facet lists** - Long facet groups are capped by default with a show-more control, while selected values remain visible.
- **Range filters** - Price, square feet, lot size, and year-built filters update the same search contract as categorical facets.
- **Removable chips** - Active query, saved-search, facet, range, geo, and viewport refinements appear above results and can be removed in place.
- **Clickable result chips** - Listing chips such as `garage` can apply matching filters directly from a result card.

### Saved Searches

- **Live counts** - Saved searches display current match counts in the filter rail.
- **OR scoping** - Selecting multiple saved searches ORs their result sets together before manual filters narrow the visible content.
- **Save in place** - Saving the current query and manual filters adds the new saved search to the filter rail, selects it, and keeps the user on `/search`.
- **Zero-hit support** - Searches with no current results can still be saved and reevaluated later.

### Geo And Provider Operations

- **Geo presets** - Radius filters model location-aware search around Huntsville, Madison, and Redstone Arsenal.
- **Viewport filter** - A sample map viewport constraint demonstrates bounding-box filtering.
- **Result map** - Leaflet and OpenStreetMap tiles show all matching listing locations with color-coded property-type markers.
- **Hit details** - Clicking a result opens a structured overlay with listing fields, location data, search metadata, amenities, tags, and JSON.
- **Sync controls** - Backfill and worker buttons demonstrate external-index synchronization for Meilisearch and Typesense.

## Screenshots

### Search Results

![Search results with filters, map, and provider debug panel](docs/screenshots/search-results.png)

### Search Suggestions

![Search suggestions dropdown from the main search box](docs/screenshots/search-suggestions.png)

### Hit Details

![Structured listing detail overlay opened from a search hit](docs/screenshots/hit-details.png)

### Saved Search Scope

![Saved search applied from the filter rail with scoped hits and facets](docs/screenshots/saved-search-scope.png)

### Provider Comparison

![Provider capability comparison page](docs/screenshots/provider-comparison.png)

## Run Locally

```bash
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/search>. The first semantic/hybrid search downloads a ~23 MB public model, then runs locally without API keys or inference charges. Weights are cached in `data/models`; blank/keyword searches do not need them.

`npm run dev` builds the frontend with Vite and starts the API/static server. For API-only work after a frontend build already exists, use:

```bash
npm run api:dev
```

For Vite's standalone dev server with API proxying, use:

```bash
npm run web:dev
```

## Run With Real Services

```bash
npm run stack:full:detached
npm run seed
npm run search:backfill -- --provider meilisearch
npm run search:backfill -- --provider typesense
```

The full stack runs Postgres, Meilisearch, Typesense, and the same web/API app at <http://127.0.0.1:5173/search>. With `DATABASE_URL` present, saved searches and sync outbox state are stored in Postgres, and backfill/sync commands write to the external search engines.

Direct adapter routes are available at:

- <http://127.0.0.1:5173/search/instant/typesense>
- <http://127.0.0.1:5173/search/instant/meilisearch>

Those pages use Vite-bundled `instantsearch.js` with `typesense-instantsearch-adapter` and `@meilisearch/instant-meilisearch`. They point at exposed local search ports and use development keys for inspectable local behavior.

## Verify

```bash
npm run typecheck
npm run verify:embeddings
npm run screenshots:update
npm test
npm run verify:full-stack
```

`npm run verify:embeddings` exercises actual CPU inference and API retrieval, offline loading, cache invalidation, semantic saved searches, and error recovery in disposable local processes. It does not require the external Docker stack.

The Playwright suite covers live debounced search, search suggestions, virtualized infinite results, facet limiting, removable refinement chips, clickable result chips, saved-search scoping, provider switching, direct InstantSearch routes, and external sync controls.

Screenshots are generated by `npm run screenshots:update`. GitHub Actions generates screenshot artifacts on every push and pull request. The committed `githooks/pre-push` hook is fast by default; set `RUN_SCREENSHOT_PRE_PUSH=1` when you want local pushes to regenerate screenshots and block on uncommitted image diffs.

## Demo Commands

```bash
npm run seed
npm run search:backfill -- --provider meilisearch
npm run search:backfill -- --provider typesense
npm run search:sync-worker
npm run search:reset -- --provider meilisearch
npm run search:reset -- --provider typesense
```

These scripts call the same local API used by the web UI when it is running.

## Repository Layout

```text
apps/api                  Local API and static server
apps/web-angular/src      Frontend app and styles
packages/domain           Domain types
packages/search-contracts Shared search and saved-search contracts
packages/search-transform Search document transforms
packages/test-fixtures    Deterministic housing, city, and saved-search data
scripts                   Seed, backfill, reset, sync, and verification scripts
tests                     Playwright browser coverage
docs                      Specification, implementation notes, and screenshots
compose                   Docker Compose stacks for provider experiments
```
