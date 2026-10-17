# Next.js Searchlab foundation

Run this App Router app with Bun. It requires the actual Searchlab API; it has no default origin, mock provider, browser search implementation, or fallback dataset.

```sh
bun install --frozen-lockfile
bun run build
SEARCH_API_ORIGIN=http://127.0.0.1:5173 SEARCH_EXPECTED_DATASET_ID=searchlab-dev bun run start
```

Open <http://localhost:3001/search>. The API must run with `DATABASE_URL`, matching `DATASET_ID`, and explicit appliance configuration for selected external providers. Development uses the same two required connection variables with `bun run dev`.

`SEARCH_EXPECTED_DATABASE_FINGERPRINT` optionally pins the observed PostgreSQL database identity returned by `GET /api/providers`. The gateway requires verified provider/storage/dataset/count/timing provenance on every successful search. Missing, mismatched or unhealthy backends return errors; older APIs without provenance are rejected.

The static document/header surround one shared responsive search state. The first search starts when the component is ready; subsequent input changes debounce by 180 ms, cancel replaced fetches, and ignore stale responses. Results append real 18-item API pages. Bedroom facets are exact values; all facet options are accessible. Distance sorting waits for a supported geographic origin.

Selecting a card opens a deferred native details dialog and preserves the mounted feed, query, filters and loaded pages. Close, Escape and browser history restore its invoking card; resizing across the page/nested-scroll breakpoint restores that card into view. `home` and `view` URL parameters support selection and view history. A direct detail URL uses the existing backend house lookup through the same dataset-pinned gateway. Missing or unavailable records have an explicit error and retry.

Map/Split is selected explicitly. Map code/data and detail code/styles load on demand. Markers support pointer, Enter and Space selection with visible keyboard focus. Mobile filters trap focus, release their scroll lock on close or desktop resize, and render facet options when visible/disclosed. Ranking, filtering, facet counts and pagination remain backend responsibilities.

The page labels selected/responding backend, dataset label and observed database fingerprint/revision, PostgreSQL source rows, API/search-operation timing, gateway timing and browser fetch timing. These measurements have different scopes; API time is not a claim of pure database time.

The gateway removes unused map/list records only. Source row counts do not complete RESULTS-02 inventory semantics; browser record trimming does not complete DATA-03 database/viewport/clustering/payload acceptance.

Run `bun run test`, then `bun run build` and `bun run test:e2e`. Fixture responses exist only in explicit tests. Saved-search actions/restoration, geographic controls and other application pages remain outside this bounded foundation.

## Actual-app UX and loading checks

`scripts/verify-ux.cjs` exercises the real private preview backend without intercepting responses. It expects the existing 126-row dataset with fingerprint `881e3b5660242affee21832c`; update those explicit expectations when accepting a different dataset. It runs 24 journeys at each of 390 px and 1440 px, including actual pagination, filters, details, keyboard controls, history, resize and map transitions. It writes screenshots, Playwright traces and a case matrix outside the repository.

```sh
SEARCHLAB_UX_ORIGIN=http://127.0.0.1:15176 \
SEARCHLAB_UX_ARTIFACTS=/tmp/searchlab-ux-journeys \
node scripts/verify-ux.cjs
```

`scripts/measure-loading.cjs` requires a separately installed Lighthouse 13.5.0 and `chrome-launcher` in `PERF_TOOLS/node_modules`. It writes raw JSON/HTML reports, Chrome traces, screenshots, resource waterfalls and scripted query timings. Run it against a production build, sequentially and without competing builds/browser work. It does three cold/warm browser-cache pairs for each fixed mobile/desktop profile, plus three scripted pairs per profile. Backend services stay warm; this does not measure cold indexes. The default Chrome path is `/opt/google/chrome/chrome`; override with `SEARCHLAB_CHROME` for either script.

```sh
PERF_TOOLS=/tmp/searchlab-perf-tools \
PERF_ORIGIN=http://127.0.0.1:15176 \
PERF_LABEL=reviewed-candidate \
node scripts/measure-loading.cjs
```

The `searchlab-hydrated` mark records this component's first effect, not completion of all framework hydration. First-results timing records DOM readiness, not exact paint. Scripted query latency and Lighthouse TBT are lab measurements, not field INP. Keep those distinctions when comparing reports. These scripts do not authorize or perform deployment, TLS proxy activation, data loading, or service replacement.
