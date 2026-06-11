# Search Options Demo Project Spec

## Goal

Create a runnable demo project that compares multiple search implementation options using the same housing-search experience.

The demo should show how the same user-facing search UI can be backed by:

1. Native PostgreSQL search
2. PostgreSQL with ParadeDB `pg_search` extension
3. PostgreSQL + Meilisearch
4. PostgreSQL + Typesense

The primary purpose is to compare implementation effort, frontend complexity, faceting behavior, geo search, semantic/hybrid search, saved searches, and sync requirements.

---

# Core demo concept

The application should model searchable real estate listings.

Users can search houses by:

```text
Text query
Semantic intent
City
Neighborhood
School district
Property type
Price range
Bedrooms
Bathrooms
Square feet
Amenities
Distance from a point
Listing status
```

The frontend experience should remain mostly the same regardless of which backend search option is selected.

---

# What the demo should demonstrate

## Search UX

The app should demonstrate:

```text
Keyword search
Search-as-you-type
Facet filters
Range filters
Selected refinements
Clear filters
Pagination
Sort options
Result cards
Search stats
URL-routed search state
```

## Housing-specific examples

Include seed data that makes these searches meaningful:

```text
"hampton cove garage"
"madison starter home"
"quiet home near good schools"
"mountain view with fenced yard"
"new construction near research park"
```

## Faceting examples

Show facets for:

```text
City
Neighborhood
School district
Property type
Bedrooms
Amenities
Listing status
```

Show range filters for:

```text
Price
Square feet
Year built
Lot size
```

## Geo examples

Show location-based filtering for:

```text
Within 5 miles of Huntsville
Within 10 miles of Madison
Within 15 miles of Redstone Arsenal
Inside map viewport
Sort by distance from selected point
```

Map visualization is optional. The first version only needs a radius selector and visible location fields.

## Semantic and hybrid examples

Show search modes:

```text
Keyword
Semantic
Hybrid
```

Example semantic searches:

```text
quiet home for a growing family
low maintenance home for retirees
starter home near good schools
modern house close to restaurants
```

The UI should explain when semantic search is unsupported or simulated for a provider.

## Saved search examples

Allow users to save a search even when there are zero current hits.

Examples:

```text
4+ bedroom house in Madison under $450k with pool
Waterfront home near Huntsville under $700k
New construction in Madison City Schools
```

Saved searches should be stored in Postgres for every option.

The demo should show:

```text
Saved search name
Saved criteria JSON
Current hit count
Last evaluated time
New matches since last evaluation
Zero-hit saved search support
```

---

# Project structure

Use a TypeScript monorepo.

```text
search-options-demo/
  apps/
    web-angular/
      src/
        app/
          pages/
            search-demo/
            saved-searches/
            provider-comparison/
          components/
            search-layout/
            search-results/
            facet-panel/
            provider-switcher/
            raw-query-viewer/
            saved-search-button/
          services/
            search-client.service.ts
            saved-search.service.ts
          environments/

    api/
      src/
        main.ts
        routes/
          search.routes.ts
          saved-search.routes.ts
          sync.routes.ts
          seed.routes.ts
        providers/
          postgres-native.provider.ts
          postgres-pg-search.provider.ts
          meilisearch.provider.ts
          typesense.provider.ts
        sync/
          search-sync-worker.ts
          outbox.repository.ts
          transform-house.ts
        saved-searches/
          saved-search.service.ts
          saved-search.repository.ts
        db/
          pool.ts
          migrations/
          seeds/

  packages/
    domain/
      src/
        house.types.ts
        city.types.ts
        search.types.ts
        saved-search.types.ts

    search-contracts/
      src/
        search-provider.interface.ts
        search-request.ts
        search-response.ts
        facet.types.ts

    search-transform/
      src/
        house-search-document.ts
        to-meili-document.ts
        to-typesense-document.ts
        semantic-text.ts

    test-fixtures/
      src/
        houses.fixture.ts
        cities.fixture.ts
        saved-searches.fixture.ts

  docker/
    postgres/
      init/
    meilisearch/
    typesense/

  compose/
    docker-compose.postgres-only.yml
    docker-compose.pg-search.yml
    docker-compose.meilisearch.yml
    docker-compose.typesense.yml

  scripts/
    seed.ts
    backfill-search.ts
    reset-search-indexes.ts
    benchmark-search.ts

  docs/
    comparison-guide.md
    implementation-notes.md
    provider-behavior-matrix.md

  package.json
  pnpm-workspace.yaml
  README.md
```

---

# Shared domain model

Define shared domain types once.

```ts
type House = {
  id: string;
  title: string;
  description: string;

  cityId: string;
  neighborhoodId?: string;

  addressLine1: string;
  zipCode: string;
  lat: number;
  lng: number;

  price: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lotSizeAcres?: number;
  yearBuilt?: number;

  propertyType: 'single_family' | 'townhouse' | 'condo' | 'multi_family' | 'land';
  listingStatus: 'active' | 'pending' | 'sold';

  schoolDistrict?: string;
  amenities: string[];
  tags: string[];

  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

```ts
type City = {
  id: string;
  name: string;
  state: string;
  county?: string;
  centerLat: number;
  centerLng: number;
};
```

---

# Shared search contract

Every provider should implement the same interface.

```ts
type SearchMode = 'keyword' | 'semantic' | 'hybrid';

type HouseSearchRequest = {
  provider: 'postgres_native' | 'pg_search' | 'meilisearch' | 'typesense';

  q?: string;
  mode: SearchMode;

  filters: {
    city?: string[];
    neighborhood?: string[];
    schoolDistrict?: string[];
    propertyType?: string[];
    listingStatus?: string[];

    minPrice?: number;
    maxPrice?: number;
    minBedrooms?: number;
    minBathrooms?: number;
    minSquareFeet?: number;

    amenities?: string[];
  };

  geo?: {
    lat: number;
    lng: number;
    radiusMiles: number;
  };

  sort: 'relevance' | 'distance' | 'price_asc' | 'price_desc' | 'newest';

  page: number;
  pageSize: number;

  includeFacets: boolean;
};
```

```ts
type HouseSearchResponse = {
  provider: string;

  hits: HouseSearchHit[];

  totalHits: number;
  page: number;
  pageSize: number;

  facets: Record<string, FacetBucket[]>;

  processingTimeMs: number;

  debug?: {
    rawRequest?: unknown;
    rawResponse?: unknown;
    sql?: string;
    warnings?: string[];
  };
};
```

```ts
type SearchProvider = {
  id: string;
  label: string;

  capabilities: SearchProviderCapabilities;

  search(request: HouseSearchRequest): Promise<HouseSearchResponse>;

  bootstrap?(): Promise<void>;
  backfill?(): Promise<void>;
};
```

---

# Provider capabilities

Each provider should expose capability metadata so the UI can explain differences.

```ts
type SearchProviderCapabilities = {
  keywordSearch: boolean;
  faceting: boolean;
  rangeFacets: boolean;
  geoRadius: boolean;
  geoSort: boolean;
  semanticSearch: boolean;
  hybridSearch: boolean;
  instantSearchDirectAdapter: boolean;
  requiresExternalSync: boolean;
  supportsSavedSearchEvaluation: boolean;
};
```

Expected matrix:

```text
Postgres native:
  keywordSearch: true
  faceting: true, manual SQL
  geoRadius: true, with PostGIS
  semanticSearch: true, with pgvector
  hybridSearch: true, custom SQL
  instantSearchDirectAdapter: false
  requiresExternalSync: false

pg_search extension:
  keywordSearch: true
  faceting: true
  geoRadius: true, with PostGIS
  semanticSearch: true, with pgvector
  hybridSearch: true, pg_search + pgvector
  instantSearchDirectAdapter: false
  requiresExternalSync: false

Meilisearch:
  keywordSearch: true
  faceting: true
  geoRadius: true
  semanticSearch: true, with embedders
  hybridSearch: true
  instantSearchDirectAdapter: true
  requiresExternalSync: true

Typesense:
  keywordSearch: true
  faceting: true
  geoRadius: true
  semanticSearch: true, with vector field / auto-embedding
  hybridSearch: true
  instantSearchDirectAdapter: true
  requiresExternalSync: true
```

---

# Frontend application

## Main pages

### Search demo page

Route:

```text
/search
```

Should include:

```text
Provider switcher
Search box
Search mode selector
Facet sidebar
Range filters
Geo radius filter
Sort selector
Result cards
Pagination
Current refinements
Clear filters
Raw query/response debugger
```

The same layout should be used for all providers.

### Saved searches page

Route:

```text
/saved-searches
```

Should include:

```text
List of saved searches
Saved criteria preview
Current hit count
Last evaluated time
Evaluate now button
Zero-hit saved search example
New matches example
```

### Provider comparison page

Route:

```text
/providers
```

Should include:

```text
Capability matrix
Setup notes
Sync requirements
Schema/index requirements
Known limitations
```

---

# Frontend implementation approach

Use shared Angular components wherever possible.

```text
SearchPageComponent
  ProviderSwitcherComponent
  SearchBoxComponent
  SearchModeToggleComponent
  FacetPanelComponent
  RangeFilterComponent
  GeoFilterComponent
  SearchResultsComponent
  SearchDebugPanelComponent
```

The frontend should call the backend API for all providers at first.

```text
Angular
  |
  v
/api/search
  |
  v
Selected SearchProvider
```

Do not directly connect Angular to Meilisearch or Typesense in the first version.

Reason:

```text
A backend API keeps the demo comparable across all providers.
It allows raw SQL debugging for Postgres providers.
It avoids exposing admin keys.
It makes saved searches and provider switching easier.
```

A later enhancement can add direct InstantSearch.js demos for Meilisearch and Typesense.

---

# Search API

## Search endpoint

```http
POST /api/search
```

Request:

```json
{
  "provider": "typesense",
  "q": "quiet home near good schools",
  "mode": "hybrid",
  "filters": {
    "city": ["Madison"],
    "minPrice": 300000,
    "maxPrice": 600000,
    "minBedrooms": 3,
    "amenities": ["garage", "fenced_yard"]
  },
  "geo": {
    "lat": 34.7304,
    "lng": -86.5861,
    "radiusMiles": 10
  },
  "sort": "relevance",
  "page": 1,
  "pageSize": 20,
  "includeFacets": true
}
```

Response:

```json
{
  "provider": "typesense",
  "hits": [],
  "totalHits": 0,
  "page": 1,
  "pageSize": 20,
  "facets": {
    "city": [],
    "propertyType": [],
    "bedrooms": []
  },
  "processingTimeMs": 12,
  "debug": {
    "warnings": []
  }
}
```

---

# Direct InstantSearch.js demo

Add a secondary route for direct search-engine UI demos:

```text
/search/instant/typesense
/search/instant/meilisearch
```

These routes should demonstrate the lower frontend burden when using engines with InstantSearch adapters.

They should show:

```text
searchBox
refinementList
rangeSlider
currentRefinements
clearRefinements
hits
pagination
```

The `pg_search` and native Postgres options should not have a direct InstantSearch route unless the API implements a compatible search client.

---

# Backend providers

## Native Postgres provider

Demonstrates:

```text
tsvector keyword search
pg_trgm optional fuzzy search
PostGIS radius filtering
pgvector semantic search
Manual SQL facet aggregation
Manual hybrid ranking
```

Should expose SQL in debug output.

## pg_search provider

Demonstrates:

```text
ParadeDB pg_search extension
BM25 search
Faceting inside Postgres
PostGIS radius filtering
pgvector semantic search
Custom SQL hybrid ranking
No external sync layer
```

Should expose SQL in debug output.

## Meilisearch provider

Demonstrates:

```text
Flattened document search
Filterable attributes
Facets
Geo radius
Hybrid search
External sync worker
Async indexing behavior
```

Should expose Meilisearch request parameters in debug output.

## Typesense provider

Demonstrates:

```text
Flattened document search
Schema-based facets
Geo radius
Hybrid search
Auto-embedding from semantic_text
External sync worker
Schema validation
```

Should expose Typesense request parameters in debug output.

---

# Data sync demo

For Meilisearch and Typesense, include a visible sync demo.

## Required sync commands

```bash
pnpm seed
pnpm search:backfill --provider meilisearch
pnpm search:backfill --provider typesense
pnpm search:sync-worker
pnpm search:reset --provider meilisearch
pnpm search:reset --provider typesense
```

## Sync page or debug panel

Show:

```text
Outbox pending count
Last sync time
Last sync error
Documents indexed
Documents deleted
Backfill status
```

## Sync behavior to demonstrate

```text
Create a house in Postgres
Outbox event is created
Worker flattens house document
Worker upserts into Meilisearch or Typesense
Search results update
Delete or mark sold
Worker removes or updates search document
```

---

# Flattened search document

All external search providers should use the same canonical search document first.

```ts
type HouseSearchDocument = {
  id: string;
  objectID: string;

  title: string;
  description: string;
  semanticText: string;

  city: string;
  state: string;
  county?: string;
  neighborhood?: string;
  zipCode: string;

  lat: number;
  lng: number;

  price: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lotSizeAcres?: number;
  yearBuilt?: number;

  propertyType: string;
  listingStatus: string;
  schoolDistrict?: string;

  amenities: string[];
  tags: string[];

  cityFacet: string;
  stateFacet: string;
  countyFacet?: string;
  neighborhoodFacet?: string;
  propertyTypeFacet: string;
  listingStatusFacet: string;
  schoolDistrictFacet?: string;

  updatedAt: string;
};
```

Provider-specific transforms:

```text
Typesense:
  location: [lat, lng]
  snake_case or configured field names
  optional embedding auto-generated from semanticText

Meilisearch:
  _geo: { lat, lng }
  filterable attributes configured upfront
  embedding generated from semanticText template

Postgres:
  no flattened external document needed

pg_search:
  no flattened external document needed
```

---

# Docker stacks

Include Compose files for:

```text
Postgres native
Postgres with pg_search extension
Postgres + Meilisearch + sync worker
Postgres + Typesense + sync worker
```

Each stack should include Postgres.

Meilisearch and Typesense stacks should include the sync worker.

The `pg_search` stack should be clearly named as a Postgres extension stack, not as an external ParadeDB service.

---

# Seed data

Seed enough data to make facets meaningful.

Minimum:

```text
100 houses
5 cities
20 neighborhoods
8 school districts
5 property types
10 amenities
10 tags
Mix of active, pending, and sold listings
```

Recommended:

```text
500-1,000 houses
```

The seed data should intentionally include:

```text
Zero-hit saved search scenarios
High-cardinality neighborhood facets
Similar semantic descriptions with different keywords
Listings near and outside radius filters
Listings that differ only by price/status changes
```

---

# Test scenarios

Include scripted comparison scenarios.

## Scenario 1: Basic keyword search

```text
Query: hampton cove garage
Expected: exact neighborhood/amenity matches rank highly
```

## Scenario 2: Faceted narrowing

```text
Query: home
Filters: Madison, 3+ bedrooms, garage
Expected: facet counts update after filters
```

## Scenario 3: Geo radius

```text
Point: Huntsville
Radius: 10 miles
Expected: only nearby listings appear
```

## Scenario 4: Semantic search

```text
Query: quiet home for a growing family
Expected: fenced yard, cul-de-sac, good schools, family-friendly tags surface
```

## Scenario 5: Hybrid search

```text
Query: hampton cove family home with mountain views
Expected: exact location plus semantic features both matter
```

## Scenario 6: Zero-hit saved search

```text
Filters: Madison, 5 bedrooms, pool, under $400k
Expected: can save even if current hit count is zero
```

## Scenario 7: Sync update

```text
Update listing price in Postgres
Expected: external search index updates after worker runs
```

## Scenario 8: Sold listing

```text
Mark listing as sold
Expected: public active search no longer shows listing
```

---

# Non-goals

Do not build:

```text
Production authentication
Real MLS import
Payments
Full map search UI
Full notification delivery
Complex multi-tenant permissions
Production-grade monitoring
```

The demo should stay focused on search behavior.

---

# Acceptance criteria

The project is complete enough when:

```text
All four provider modes can run locally.
The same frontend search page can query each provider.
Seed data produces meaningful facet counts.
Geo radius filtering works in each applicable provider.
Saved searches are stored in Postgres.
Zero-hit saved searches are supported.
Meilisearch and Typesense indexes can be backfilled from Postgres.
The sync worker can process create/update/delete events.
The provider comparison page explains capability differences.
At least one direct InstantSearch.js demo exists for Typesense.
At least one direct InstantSearch.js demo exists for Meilisearch.
Raw query/debug output is available for every provider.
```

---

# Recommended implementation order

## Phase 1: Shared model and seed data

```text
Create Postgres schema
Create seed script
Create shared domain types
Create frontend shell
```

## Phase 2: Backend search contract

```text
Create SearchProvider interface
Implement native Postgres provider
Implement shared API response shape
Render frontend results
```

## Phase 3: External search sync

```text
Create search_sync_outbox
Create flattened document transformer
Implement Meilisearch adapter
Implement Typesense adapter
Add backfill commands
Add sync worker
```

## Phase 4: UI comparison

```text
Provider switcher
Facet panel
Range filters
Geo filter
Raw query debugger
Provider capability matrix
```

## Phase 5: Semantic and hybrid search

```text
Add semantic_text
Add pgvector support where applicable
Add Meilisearch embedder config
Add Typesense embedding field config
Add search mode selector
```

## Phase 6: Saved searches

```text
Saved searches table
Save current criteria
Allow zero-hit saves
Evaluate saved search
Show new matches
```

## Phase 7: Direct InstantSearch demos

```text
Add /search/instant/typesense
Add /search/instant/meilisearch
Compare direct widget setup against backend API adapter pattern
```

---

# Key point the demo should make

The demo should make the tradeoff obvious:

```text
Postgres native:
  fewer services, more custom search code

pg_search extension:
  still Postgres-native, better search/facets, still custom API/UI adapter

Meilisearch:
  external sync required, easier frontend/search product experience

Typesense:
  external sync required, strongest faceting/geo/schema/semantic control
```

The preferred default for the housing example should be:

```text
Postgres + Typesense + sync worker
```

The best simpler external-search alternative should be:

```text
Postgres + Meilisearch + sync worker
```

The best Postgres-native alternative should be:

```text
Postgres + ParadeDB pg_search extension
```
