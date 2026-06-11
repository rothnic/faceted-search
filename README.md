# Search Options Demo

Runnable TypeScript demo for comparing faceted, geo-aware, semantic, and saved-search behavior across search provider strategies for location-based housing data.

The app is intentionally small enough to inspect end to end: a Node API/static server, a Vite-bundled frontend, shared search contracts, deterministic fixtures, sync/backfill scripts, and Playwright coverage.

## What It Demonstrates

- Faceted search with bounded filter groups, selected-value preservation, and live facet counts.
- Debounced search updates that keep the search box focused while results and filters refresh.
- Search suggestions from listing titles, saved searches, cities, neighborhoods, amenities, and property types.
- Saved searches that can be applied from the filter panel; multiple saved searches are ORed together, then active filters narrow that scoped set.
- Result chips that can be clicked to apply filters, such as applying the `garage` amenity from a listing card.
- Basic map visualization for the currently visible result page.
- Provider comparison across native PostgreSQL, PostgreSQL plus `pg_search`, Meilisearch, and Typesense.
- External-index sync modeling with backfill and worker controls.

## Screenshots

### Search Results

![Search results with filters, map, and provider debug panel](docs/screenshots/search-results.png)

### Search Suggestions

![Search suggestions dropdown from the main search box](docs/screenshots/search-suggestions.png)

### Saved Search Scope

![Saved search applied from the filter rail with scoped hits and facets](docs/screenshots/saved-search-scope.png)

### Provider Comparison

![Provider capability comparison page](docs/screenshots/provider-comparison.png)

## Provider Modes

- Native PostgreSQL
- PostgreSQL with `pg_search`
- PostgreSQL plus Meilisearch
- PostgreSQL plus Typesense

Provider debug output shows the SQL or search-engine request shape each mode would use in a production-backed stack. If Meilisearch or Typesense is unavailable, provider searches fall back to the local Postgres-backed scorer and include an explicit warning in the debug panel.

## Run Locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:5173/search>.

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
npm test
npm run verify:full-stack
```

The Playwright suite covers live debounced search, search suggestions, facet limiting, removable refinement chips, clickable result chips, saved-search scoping, provider switching, direct InstantSearch routes, and external sync controls.

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

