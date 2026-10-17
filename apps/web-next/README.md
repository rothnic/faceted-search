# Next.js Searchlab foundation

Run this App Router app with Bun. It requires the actual Searchlab API; it has no default origin, mock provider, browser search implementation, or fallback dataset.

```sh
bun install --frozen-lockfile
bun run build
SEARCH_API_ORIGIN=http://127.0.0.1:5173 SEARCH_EXPECTED_DATASET_ID=searchlab-dev bun run start
```

Open <http://localhost:3001/search>. The API must run with `DATABASE_URL`, matching `DATASET_ID`, and explicit appliance configuration for selected external providers. Development uses the same two required connection variables with `bun run dev`.

`SEARCH_EXPECTED_DATABASE_FINGERPRINT` optionally pins the observed PostgreSQL database identity returned by `GET /api/providers`. The gateway requires verified provider/storage/dataset/count/timing provenance on every successful search. Missing, mismatched or unhealthy backends return errors; older APIs without provenance are rejected.

The static document/header surround one shared responsive search state. List and map requests debounce by 180 ms, cancel replaced fetches, and ignore stale responses. Results use real 18-item API pages. Map/Split is selected explicitly. Bedroom facets are exact values; all facet options are accessible. Distance sorting waits for a supported geographic origin.

The page labels selected/responding backend, dataset label and observed database fingerprint/revision, PostgreSQL source rows, API/search-operation timing, gateway timing and browser fetch timing. These measurements have different scopes; API time is not a claim of pure database time.

The gateway removes unused map/list records only. Ranking, filters, facets and counts remain in the actual backend. Source row counts do not complete RESULTS-02 inventory semantics; browser record trimming does not complete DATA-03 database/viewport/clustering/payload acceptance.

Run `bun run test`, then `bun run build` and `bun run test:e2e`. Fixture responses exist only in explicit tests. Prior live evidence covered PostgreSQL keyword, not every exposed provider/mode. Saved-search actions/restoration, geographic controls, rich details and the other application pages remain outside this bounded foundation.
