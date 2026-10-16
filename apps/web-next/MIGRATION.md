# Searchlab Next.js migration foundation

**Tracking:** `spm-kstb.1.16`
**UX reference source:** accepted checkpoint `6a263d225197d420a277d5831cb379d64032b1ae`, branch `feat/responsive-search-next`
**Stand-alone PR base:** original repository main `4624ff58eca2d8ae036542e31c02aa4e580b5f69`; this matches the live backend used for verification. Prior responsive commits remain on their original branch.
**Migration source:** branch `feat/searchlab-nextjs-foundation`, isolated workspace `/home/ubuntu/workspace/faceted-ui-nextjs-foundation-20261016`
**Reference:** the original 1536 × 1024 user image in `searchlab-review-pack/reference.png` (unchanged SHA-256 `ff3e94b39f05c25619e9901d2a1fb753fb2a19f2810aaa00519823e9af2c52271`); responsive requirements v2 are in `searchlab-review-pack/spec.md`.

## Accepted foundation scope

- Run a parallel Next.js App Router route from `apps/web-next` using the latest stable version identified by the official docs at migration start: Next.js `16.4.2`; dependencies are managed by Bun with the generated lockfile.
- Keep the Vite app and API source untouched; the Next server runs on `3001` and rewrites `/api/*` to the existing API origin.
- Provide one responsive Search page state model for query, provider, mode, sort, filters, view and selection. Desktop uses a filter rail and Split/Map/List; mobile uses the same filter component in a drawer and a Map/List switch.
- Send search criteria to the existing backend. The browser debounces list and map search by 180 ms, aborts replaced requests, and ignores stale responses. Result rows use the existing paged API with 18 records per request.
- Start in List on both desktop and mobile. Load Leaflet code and map CSS only after Map or Split is selected. Map data uses a distinct map-only request after the map becomes visible.
- Keep live backend values truthful. Unknown `totalInventory` is shown as unavailable; no inventory or viewport counts are fabricated.

## Explicitly unfinished

- DATA-03 remains blocked in `spm-kstb.1.13`: accepted-source live viewport bounds/zoom, antimeridian behavior, deterministic clustering, exact viewport counts, stale/debounced viewport request suppression, and measured compressed map payload limits are not implemented or accepted by this migration slice. The Next map uses only the existing map endpoint and does not pass ephemeral map bounds as persistent filters.
- RESULTS-02 inventory acceptance remains held: this route can display the backend inventory field when supplied, but a null field is not replaced with a made-up total.
- Saved-search restoration/persistence and the Save action are not migrated in this foundation; the disabled control is visible to keep the header geometry but does not mutate backend data.
- Other provider/mode controls forward selections to the existing backend; this slice's real-provider verification is restricted to the already-authorized PostgreSQL keyword path.

## Verification evidence expected

1. `bun run test` covers request shape, filter counts, debounce, AbortController cancellation and stale-response suppression.
2. `bun run test:e2e` covers mobile filter-state parity, query/facet clear independence, visible count alignment, and deferred map bundle/map request behavior using deterministic route fixtures.
3. A read-only smoke run uses only `GET /api/providers`, `GET /api/houses/<id>`, and unscoped `POST /api/search` with `provider=postgres_native`, `mode=keyword`, and no saved-search IDs.
4. Production-mode comparison captures the same request and viewport on Vite and Next, recording navigation/LCP, resource bytes, request-to-result latency, and browser errors. These measurements are exploratory observations, not general performance guarantees.

No preview changes, new credentials, expanded network access, paid APIs, merge or deployment are included in this slice.

Criteria are URL-backed: discrete facet/settings actions create history entries; typing replaces the current entry; Back/Forward restores query, facets and settings. The header and document shell are server components.

Live integration found the retained API ignores includeMap/mapOnly and omits totalInventory. The Next POST /api/search adapter forwards all search criteria and preserves upstream results/counts/status, but removes unused mapHits/hits before sending responses to the browser. This does not establish backend payload or viewport acceptance.

Listing selection opens the map preview. Rich listing-detail overlays, geographic origin controls and the Saved Searches/Providers/System pages are not migrated in this bounded foundation. Distance sorting is omitted until an origin is supported.
