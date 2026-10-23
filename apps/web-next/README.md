# Next.js Searchlab foundation

Run this App Router app with Bun. It requires the actual Searchlab API; it has no default origin, mock provider, browser search implementation, or fallback dataset.

```sh
bun install --frozen-lockfile
bun run build
SEARCH_API_ORIGIN=http://127.0.0.1:5173 SEARCH_EXPECTED_DATASET_ID=searchlab-dev bun run start
```

Open <http://localhost:3001/search>. The API must run with `DATABASE_URL`, matching `DATASET_ID`, and explicit appliance configuration for selected external providers. Development uses the same two required connection variables with `bun run dev`.

`SEARCH_EXPECTED_DATABASE_FINGERPRINT` optionally pins the observed PostgreSQL database identity returned by `GET /api/providers`. The gateway requires verified provider/storage/dataset/count/timing provenance on every successful search. Missing, mismatched or unhealthy backends return errors; older APIs without provenance are rejected.

The document/header surround one shared responsive search state. Initial search results come from a fresh server read through the same verified gateway and are rendered into HTML; hydration does not repeat that request. Search is a working GET form before JavaScript loads, and native typing is adopted into the enhanced editor instead of being discarded. Desktop input debounces by180ms and cancels replaced requests. Mobile focus pins the same input to the visual viewport, shows real city/neighborhood facet suggestions and counts, and keeps a draft until Search; Cancel/Back preserve committed criteria and loaded pages. Secondary controls that require JavaScript are visibly disabled while preparing; search and home links remain active. Results append real 18-item API pages. Bedroom facets are exact values; all facet options are accessible. Distance sorting waits for a supported geographic origin.

Each card is a real link to a server-rendered `/homes/[id]` page. Before hydration or with JavaScript disabled it navigates normally, including modified clicks/open-in-new-tab. Once enhanced, an ordinary click opens the deferred native details dialog and preserves the mounted feed, query, filters and loaded pages. Close, Escape and browser history restore its invoking card; resizing across the page/nested-scroll breakpoint restores that card into view. `home` and `view` URL parameters support selection and view history. A direct detail URL uses the existing backend house lookup through the same dataset-pinned gateway. Missing or unavailable records in the overlay have an explicit error and retry. Native missing-home navigation redirects to a readable recovery page with a safe local search return; the house API retains404. Error recovery does not depend on JavaScript.

Map/Split is selected explicitly. On mobile the embedded map passes incidental touch swipes to the page. Its expand icon opens a separate interactive map with44px close/zoom controls; Escape, collapse, view changes and breakpoints release its modal state and restore position/focus. Map code/data and detail code/styles load on demand. Markers support pointer, Enter and Space selection with visible keyboard focus. Mobile filters trap focus, release their scroll lock on close or desktop resize, and render facet options when visible/disclosed. A successful map stays mounted while replacement data loads or fails. Embedded and expanded maps label those markers as previous results until the current search succeeds; failure offers Retry for the current criteria. Superseded responses cannot replace newer results. A first map request shows loading and offers Retry only after an actual failure. Ranking, filtering, facet counts and pagination remain backend responsibilities.

A small request timing next to the count opens the full diagnostics dialog. It labels selected/responding backend, dataset label and observed database fingerprint/revision, PostgreSQL source rows, API/search-operation timing, gateway timing and browser fetch timing. These measurements have different scopes; API time is not a claim of pure database time.

The gateway removes unused map/list records only. Source row counts do not complete RESULTS-02 inventory semantics; browser record trimming does not complete DATA-03 database/viewport/clustering/payload acceptance.

Run `bun run test` and `bun run build`. The six unit checks contain explicit boundary fixtures; application runtime has no fixture mode. `bun run test:e2e` now invokes the actual-backend suite below. The former browser-intercepted initial-response mechanics suite was removed because it cannot seed a server-rendered read; it remains in Git history. Root repository legacy UI mechanics and disposable real-engine CI remain separate checks. Saved-search actions/restoration, geographic controls and other application pages remain outside this bounded foundation.

## Actual-app UX and loading checks

`scripts/verify-ux.cjs` exercises the real private preview backend without intercepting responses. It expects the existing 126-row dataset with fingerprint `881e3b5660242affee21832c`; update those explicit expectations when accepting a different dataset. It records24 journeys per initial390px/1440px context (47passing records plus one explicitly not-applicable desktop drawer record), including actual pagination, filters, details, keyboard controls, history, resize and map transitions. It writes screenshots, Playwright traces and a case matrix outside the repository.

```sh
# Start the production candidate separately with the existing backend configuration.
# This suite does not create services, seed data, publish or change network policy.
SEARCHLAB_UX_ORIGIN=http://127.0.0.1:15178 \
SEARCHLAB_UX_ARTIFACTS=/tmp/searchlab-reviewed-run-unique \
SEARCHLAB_CHROME=/opt/google/chrome/chrome \
bun run test:e2e
```

The output directory must be new. The suite gives each harness a separate private subdirectory and stops on failure. `verify-focused-search.cjs` covers ten focused editor/IME/diagnostics/geometry cases; `verify-mobile-map.cjs` adds seven real-map CDP gesture/history cases; `verify-progressive-search.cjs` covers twelve native GET, pre-hydration, JavaScript-disabled, modified-click, soft-navigation and safe-return/recovery cases. `verify-history-state-key.cjs` adds four mobile/desktop records: reloaded detail history preserves the same feed/input without a repeated component effect, while changed criteria still reseed and Back restores the query. `verify-map-recovery.cjs` adds ten 390px/1440px viewport records for retained real markers, truthful previous/loading/error labels, current-criteria retry, stable retry focus, details/filter preservation, canceled stale delivery and first-load recovery without a premature error alert. It delays actual backend response delivery or fails browser transport; it never invents search/map data. These counts are logical records with their own specified profiles, not an assertion that every case ran on every device. Primary progressive flows run390px/1440px; the recovery/unsafe-return block uses the recorded desktop viewport. The fixed126historical/fixture-derived rows, fingerprint and query counts are intentional acceptance prerequisites; re-declare them before using a different dataset. This proves integration on the small existing corpus, not market-scale performance.

`scripts/trace-real-interactions.cjs` records real query/facet/pagination/detail/map/Back screenshots and Chrome paint-filmstrip traces. Screenshots verify the painted state at capture time; event/state marks include harness scheduling and are not exact paint onset or field INP.

A broad Cache Components/partial-prerendering experiment was built and evaluated. The shipping search path uses fresh full server HTML so native GET and detail navigation work without JavaScript. It does not enable those flags or cache fresh search responses in a shared entry. Maps, diagnostics and overlays remain deferred. Header navigation uses Next Link; result links deliberately keep their native fallback and enhance only ordinary clicks.


`scripts/measure-loading.cjs` requires a separately installed Lighthouse 13.5.0 and `chrome-launcher` in `PERF_TOOLS/node_modules`. It writes raw JSON/HTML reports, Chrome traces, screenshots, resource waterfalls and scripted query timings. Run it against a production build, sequentially and without competing builds/browser work. It does three cold/warm browser-cache pairs for each fixed mobile/desktop profile, plus three scripted pairs per profile. Backend services stay warm; this does not measure cold indexes. The default Chrome path is `/opt/google/chrome/chrome`; override with `SEARCHLAB_CHROME` for either script.

```sh
PERF_TOOLS=/tmp/searchlab-perf-tools \
PERF_ORIGIN=http://127.0.0.1:15176 \
PERF_LABEL=reviewed-candidate \
node scripts/measure-loading.cjs
```

The current single-origin collector waits for enhanced controls before its query action; mobile timing includes explicit Search submission and is not directly comparable to the historical live-typing protocol. Its custom `layoutShiftSum` is a sum, not standard max-session-window CLS; use Lighthouse CLS for that metric.

The `searchlab-hydrated` mark records this component's first effect, not completion of all framework hydration. First-results timing records DOM readiness, not exact paint. Scripted query latency and Lighthouse TBT are lab measurements, not field INP. Keep those distinctions when comparing reports. These scripts do not authorize or perform deployment, TLS proxy activation, data loading, or service replacement.
