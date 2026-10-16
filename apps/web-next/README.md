# Searchlab Next.js foundation

This is a parallel App Router implementation for the original faceted-search app. The existing Vite/vanilla implementation remains the fallback and is not changed by this app. The Next server uses port `3001`; the existing API stays on its current origin and is proxied through `/api/*` using `SEARCH_API_ORIGIN` (default `http://127.0.0.1:5173`).

## Run

```sh
cd apps/web-next
bun install
bun run dev
```

Open `http://127.0.0.1:3001`. For a production-mode run:

```sh
SEARCH_API_ORIGIN=http://127.0.0.1:5173 bun run build
SEARCH_API_ORIGIN=http://127.0.0.1:5173 bun run start
```

Run focused state/controller tests with `bun run test`. The plain `bun test` command also discovers Playwright specs and should not be used. After a production build and with Chromium installed, run browser checks with `bun run test:e2e`.

## Foundation boundaries

- App Router server components own the page shell; one client island owns the search/filter/view state.
- Search, sort, facet evaluation, ranking, and counts are sent to the existing backend. Browser code only composes request criteria.
- List is the initial view on desktop and mobile; select Map or Split to load map work.
- Search updates wait 180ms, abort the previous fetch, and ignore stale responses. Result rows arrive in bounded 18-item pages.
- The same facet panel instance becomes a desktop sidebar or a mobile drawer. Query clearing leaves filters intact; filter clearing leaves the query intact.
- Leaflet and its CSS load with the map view; a separate map-only request starts only while Map or Split is visible.
- Save-search persistence and the Saved Searches page are not migrated in this first foundation, so the visible Save button is intentionally disabled.
- DATA-03 viewport clustering/payload acceptance and RESULTS-02 inventory-total acceptance remain open. The foundation does not claim those API contracts are complete.

## Current UX reference

The responsive target remains `searchlab-review-pack/reference.png`; requirements remain `searchlab-review-pack/spec.md`. Counts and content are live API values. Listing photos, favorites, and mobile bottom navigation remain out of scope because the requirements mark them as illustrative.

Distance sorting and geographic controls require a supported origin and are deferred with the remaining geospatial work. Bedroom facets are exact counts. All facet options are available through Show all.

The Next search route forwards criteria to the real API and strips unused map records from list responses (and unused listing records from map-only responses). This supports older backends that ignore the optional includeMap/mapOnly flags; it does not reduce their database work or satisfy DATA-03 clustering/payload acceptance. SEARCH_API_ORIGIN must also be set when starting the server.
