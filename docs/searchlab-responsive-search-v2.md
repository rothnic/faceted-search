# Searchlab Search Page — Responsive UX Requirements

**Status:** Implementation-ready design and quality requirements (v2)  
**Scope:** Existing Searchlab search/results page on desktop, tablet, and mobile  
**Design direction:** Compact Option B organization, existing desktop split view, shared responsive components

> **Implementation guidance:** The accompanying mockups illustrate layout direction, not an exact functional specification. When a mockup conflicts with a requirement below, follow this document. Preserve existing application behavior unless a change is explicitly specified. Counts, locations, property photos, and listing details in mockups are illustrative.

## 1. Objectives

1. **Minimize vertical space before results**, particularly on mobile. Avoid unnecessary heading rows, tall cards, redundant controls, and duplicated information.
2. **Use a common responsive component system**, rather than separately maintained desktop and mobile experiences. Reflow, resize, collapse, and overlay shared controls based on available space.
3. **Preserve existing functionality**, including the text search, detailed facet filters, saved searches, sorting, search mode, provider selection, results list, and map.
4. **Make applied filters immediately visible and removable in one click/tap.**
5. **Show result count and total inventory, with Save search visible and aligned alongside the results heading.**
6. **Provide meaningful Map, List, and Split presentations** as appropriate for the available width.
7. **Enforce stable alignment, low layout shift, and lean view-specific loading** with measurable automated quality gates (Section 14).

## 2. Required page organization

### 2.1 Wide desktop

Retain the existing overall layout: **faceted-filter sidebar | results list | map**.

- **Global header:** Keep existing Searchlab navigation and page destinations.
- **Top search area:** Prominent search input; existing **Mode** and **Provider** selectors on desktop; a compact, visually secondary **More settings** control if advanced settings are needed.
- **Left sidebar:** Detailed facet groups followed by saved-search access. **Do not put an Active filters summary in the sidebar.**
- **Results header:** Keep **Homes**, **matching count of total count**, **Split / Map / List**, compact **Sort**, and **Save search** logically grouped and aligned. Use available horizontal space; do not create extra rows unnecessarily.
- **Applied-filter strip:** Place directly above the result content, below/adjacent to the results header. This is the **single location** for the active-filter summary on desktop.
- **Content:** Existing result cards alongside a map in Split mode. Map-only and List-only views use the same components.

Do not add a redundant **Filters** button when the sidebar is already visible, unless that button explicitly toggles the sidebar and is clearly presented as such.

### 2.2 Narrow mobile

Organize content in this compact order:

1. **Search bar:** One visible full-width query input with a clear (`×`) action.
2. **Compact toolbar:** **Filters (N)** | compact **Sort** (e.g., `Relevance ▾`) | **Map/List** toggle. Each control should occupy only the width it requires.
3. **Applied-filter chips:** Compact, removable chips and **Clear all** when facet filters are active. Hide this row entirely when there are no facet filters.
4. **Results header:** **Homes** + **35 of 1,240**-style count + **Save** on **one horizontally aligned row**. Do **not** stack the count below Homes. Keep Save visible even in Map mode.
5. **Selected content view:** Either a map or list, not a large map followed by the full results list.

The mobile navigation may remain as currently implemented. A new persistent bottom navigation bar shown in illustrative mockups is **not a requirement**.

### 2.3 Mid-size / tablet

Adapt the same components to the available width. Prefer collapsing the inline facets into a drawer before squeezing the list or map to unusable widths. Split view is available only when it can provide usable minimum widths; otherwise offer Map/List.

Use **CSS Grid/Flexbox and container queries** where appropriate. Breakpoints are implementation details, not separate page implementations. Validate at approximately **320, 375, 768, 1024, and 1440 CSS pixels** as well as intermediate widths.

## 3. Search and settings

| ID | Requirement | Expected behavior |
|---|---|---|
| SEARCH-01 | Persistent visible search input | The query field is visible on mobile and desktop without opening a drawer or dialog. |
| SEARCH-02 | Clear query independently | Clicking the search input's `×` removes **only the free-text query**; facet filters remain selected. |
| SEARCH-03 | No redundant query chip | Do not display a `q: garage` chip when `garage` is already represented by the search input. An independent **Garage** feature facet may still have its own chip. |
| SEARCH-04 | Preserve search mode | Retain existing modes and their semantics (e.g., keyword/hybrid/semantic where supported). |
| SEARCH-05 | Preserve provider selection | Retain the existing provider/backend selector (e.g., PostgreSQL). Desktop: available with the top search settings. Mobile: accessible from compact secondary settings, drawer, or overflow—not a permanent full-width row. |
| SEARCH-06 | Compact More settings | Desktop button is visually secondary, about **32–36px** tall, centered alongside the main inputs; not a tall, primary-looking dropdown. Mobile settings are available without occupying a permanent row. |
| SEARCH-07 | URL/state consistency | Existing deep links, browser Back/Forward, and query state must remain functional. Prefer serializing shareable search criteria to URL parameters where compatible with the current app. |

## 4. Facet filters, chips, and drawer

### 4.1 Preserve existing facets

Retain the existing detailed facet categories and their behavior—such as **price, bedrooms, bathrooms, home type, property features, schools, location, status**, and any additional existing facets. The screenshots show facets lower in the current desktop sidebar; **do not replace them with only saved searches or a simplified mock filter set**.

- **Desktop:** Display the same facet controls inline in the left sidebar; make facet groups collapsible where already supported.
- **Mobile:** Open the **same `FilterPanel` content** in a full-height, accessible slide-over drawer/sheet. Do not build an independent mobile filter form.
- Keep saved-search access in the sidebar/drawer as a separate, clearly labeled section, preferably following the facets; the existing Saved Searches page stays available.
- Avoid putting a long saved-search list before the primary facets, where it would push actual filters out of view.

### 4.2 Applied-filter chips

| ID | Requirement | Expected behavior |
|---|---|---|
| FILTER-01 | One active-filter location | Show chips **above results only**, not duplicated in the desktop sidebar. Mobile uses the same chip component beneath its toolbar. |
| FILTER-02 | One-click removal | Every applied facet chip includes `×`; activating it **immediately removes that specific filter selection** and updates results/map without reopening the drawer or clicking Apply. |
| FILTER-03 | Distinct styling | Chips should look like lightweight **tags**, not dropdowns: **26–30px visual height**, **4–6px corner radius**, light green/gray fill, minimal/no border, compact type. |
| FILTER-04 | Clear all semantics | The chip-strip **Clear all** and sidebar **Clear filters** remove active **facet filters**, but preserve the free-text query. If a broader “Reset search” exists, name it distinctly. |
| FILTER-05 | No empty row | Hide the applied-filter strip when no facet filters are selected. |
| FILTER-06 | Overflow handling | Handle many/long chips without broken labels, clipped remove icons, or excessive vertical expansion. Prefer a horizontally scrollable mobile strip with discoverable overflow; wrapping complete chips is acceptable where space allows. |
| FILTER-07 | Accurate filter count | `Filters (N)` reflects active facet selections using one consistent counting rule; it does not count the free-text search query. |
| FILTER-08 | State synchronization | Removing a chip updates the corresponding facet control in the sidebar/drawer, and changing a facet updates chips, result counts, listings, and map. |

**Accessibility:** Chip remove actions require clear accessible names, e.g., **“Remove Bedrooms: 3+”**, keyboard operability, visible focus, and a usable touch target without making the visual chip unnecessarily tall or causing overlapping hit areas.

## 5. Results header, counts, and sorting

| ID | Requirement | Expected behavior |
|---|---|---|
| RESULTS-01 | Compact header alignment | On mobile, **Homes**, count, and **Save** share **one row** and are vertically centered/baseline-aligned. Do not place the count on a second line by default. |
| RESULTS-02 | Count semantics | Show `N of T` or equivalent, where **N = number of records matching current query + filters + active search configuration**, and **T = total searchable records in the current relevant collection/provider**. These are real values, not example placeholders. |
| RESULTS-03 | Optional pagination count | If only part of the matching set is loaded, represent that separately, e.g., `Showing 20 of 35 matches`; do not mislabel loaded items as total results. |
| RESULTS-04 | Compact sort | A narrow content-sized dropdown that displays the current sort selection, e.g., `Relevance ▾`; no unnecessary flex-grow/full-width sizing. The sort choice remains accessible on mobile and desktop. |
| RESULTS-05 | Sort semantics | Sort updates listing order; it **does not physically reorder map pins**. The map/list relationship remains coherent. |
| RESULTS-06 | Stable layout | Updating filters or sort should not cause unnecessary header shifts. Accommodate loading and empty states without large jumps. |

When a map viewport differs from the complete result set, any label such as **“27 in this map”** or **“7 homes in view”** must be explicitly identified as a **viewport count**, separate from the global matching/total count.

## 6. Saved searches

| ID | Requirement | Expected behavior |
|---|---|---|
| SAVE-01 | Always accessible | **Save search** appears in the desktop results header and compact **Save** remains visible in the mobile results header in **both Map and List modes**. |
| SAVE-02 | Save full search definition | Save the free-text query, applied facets, search mode, and provider/search backend as applicable to the current data model. Do not save only the visible keyword. |
| SAVE-03 | Saved vs. unsaved state | Differentiate **Save**, **Saved**, and **Modified/Save changes** when supported by the existing data model. Avoid misleading “saved” feedback for unsaved changes. |
| SAVE-04 | Existing discovery | Preserve the **Saved Searches** navigation destination and an accessible saved-search section within the sidebar/drawer. |
| SAVE-05 | Preserve existing semantics | The original UI uses checkboxes beside saved searches. **Verify whether these combine/search across multiple saved searches before changing them into one-click presets.** Do not silently remove multi-selection behavior if it exists. |
| SAVE-06 | Restore criteria | Applying a saved search restores its persisted query/filters/mode/provider consistently across the input, facet controls, chips, counts, and result views. |

Whether sort/view preferences belong in a saved-search record should follow existing semantics; **do not silently redefine the saved-search schema** solely to match a mockup.

## 7. Map, List, and Split behavior

### Desktop / wide layouts

- Offer **Split**, **Map**, and **List** when there is enough room. Default to the existing split layout if that is the current expected behavior.
- **Split:** Results list and map are simultaneously visible, with both sharing the same filtered dataset.
- **Map:** Map receives the available content space; no full duplicate listings pane.
- **List:** Results list receives the available content space; no large empty map column.
- Make the map sticky within the viewport on longer desktop results pages **if this does not create awkward nested scrolling**.
- Selecting a card highlights/focuses the corresponding map marker; selecting a marker reveals/highlights the corresponding card or compact property preview.

### Mobile / narrow layouts

- Offer **Map** and **List** only. **Do not show a large map with the entire list of cards below it.**
- **Map mode:** Map occupies the remaining usable viewport below the compact controls; tapping a marker opens **one compact selected-property preview** over the bottom of the map, with a direct route to details and a close/dismiss action. No permanent large results list below.
- **List mode:** Display the regular result cards immediately below the header/chip area; do not reserve vertical space for the map.
- Keep the **Homes count and Save** visible above the map in Map mode, even though a generated mockup omitted them.
- Preserve search criteria and selected-item identity (when practical) while switching between views.
- Any mobile preview/sheet must respect viewport/safe areas and avoid competing with map pinch/pan gestures.

### Map data behavior

- Markers and cards derive from the same matching result set; viewport markers may be a subset.
- If a **Search this area** action already exists or is implemented, make its effect explicit: panning/zooming alone should not unexpectedly rewrite the user's search filters. Keep global and viewport counts distinguishable.
- Reuse existing Leaflet/map implementation and existing listing cards wherever possible. Do not require new listing photos, favorites, or bottom navigation features merely because they appear in an illustrative mockup.

## 8. Visual density and responsive styling

| Element | Guideline |
|---|---|
| Primary input / dropdowns / buttons | About **40–44px** high when appropriate; consistent alignment. |
| Secondary More settings | About **32–36px** high, subtle/ghost styling, vertically centered with nearby controls. |
| Applied chips | About **26–30px** visibly; relatively square **4–6px** radius, subtle fill, clear `×`. |
| Regular controls | About **8px** corner radius, slightly stronger outline than chips. |
| Vertical rhythm | Aim for roughly **8px** between compact rows; remove unnecessary container padding and labels that repeat visible meaning. |
| Sort | Width dictated by label/content; no large empty area. |
| Long text | Prevent control-label wrapping; truncate long saved-search labels with a way to access full text. |
| Touch/accessibility | Meet WCAG 2.2 AA where applicable: readable contrast, logical focus order, keyboard support, and adequately sized/non-overlapping touch targets. |

Do not make the whole page header permanently sticky on mobile if it consumes significant space. If sticky search controls are needed, prefer a compact state that does not permanently obscure results.

## 9. Shared component architecture

The implementation should prefer **one state model and one set of reusable components** over separate mobile/desktop implementations:

```text
SearchPage
├── SearchBar                  (desktop + mobile)
├── SearchSettings             (desktop inline; mobile secondary settings)
├── ResultsToolbar             (count, sort, Save, view switching; responsive arrangement)
├── ActiveFilterChips           (one shared rendering; only above results)
├── FilterPanel                 (desktop sidebar; same content in mobile drawer)
│   ├── FacetGroups
│   └── SavedSearchSection
└── ResultsViewport
    ├── ResultsList / ResultCard
    ├── MapView / Marker / PropertyPreview
    └── ViewSwitcher             (Map/List; Split when width permits)
```

Suggested shared state (adapt to existing architecture rather than rewriting it unnecessarily):

```ts
interface SearchPageState {
  query: string;
  mode: string;
  provider: string;
  facets: Record<string, unknown>;
  sort: string;
  view: 'list' | 'map' | 'split';
  selectedListingId?: string;
  // mapViewport and drawerOpen are presentation state, not search filters by default.
}
```

- Keep query, filters, mode, and provider synchronized with the existing search backend and URL/navigation behavior.
- Avoid mounting independent copies of the filter logic. Presentation wrappers may differ (sidebar vs. drawer), but the actual facet controls, validation, state, and update handlers are shared.
- Avoid full data refetches simply because a user switches Map/List presentation, unless the current architecture requires it.
- Do not replace existing provider-specific or advanced capabilities with simplified mock values.

## 10. States, edge cases, and accessibility

Support and verify:

- Empty query; no selected facets (no chips row); many selected facets; very long chip and saved-search labels.
- Zero results; loading; backend error; saved-search save error; saved-search state changed after editing.
- Filter drawer opening, scrolling, closing, keyboard Escape, focus trapping/restoration, and scroll-lock behavior.
- Chips removed by mouse, touch, or keyboard, with focus maintained sensibly after removal.
- 320px-wide mobile screens, large text/zoom, reduced-motion settings, safe-area insets, landscape orientation, and browser navigation.
- Cross-highlighting cards and map pins without unexpectedly clearing selected filters.
- No accidental overlays over map zoom, recenter, or selected-preview controls.

## 11. Acceptance checklist (must pass)

- [ ] Desktop still has a faceted-filter sidebar, listings, and map in Split view; core existing search capabilities are intact.
- [ ] Desktop has **no duplicated Active filters section in the sidebar**; applied chips appear **only above results**.
- [ ] Search input is visible on both mobile and desktop; clearing it leaves facets untouched.
- [ ] Search Mode and Provider are still available (visible on desktop, accessible via secondary controls on mobile).
- [ ] Mobile uses **one compact search row, one controls row, an optional chips row, and one aligned Homes/count/Save row** before content.
- [ ] **Save** and **`N of T` counts** remain visible in both mobile Map and List modes.
- [ ] Every facet chip can be removed with **one tap/click** without reopening Filters; result cards, map, count, and facet controls update accordingly.
- [ ] Chips are visually smaller and squarer than dropdown/filter controls; no empty chips row.
- [ ] Sort is compact, labeled by its current selection, and functional on both desktop and mobile.
- [ ] Mobile Filters opens a drawer containing the **same** detailed facets as desktop; saved searches remain accessible.
- [ ] Mobile Map is a viewport-filling map with at most a compact selected-property preview—**not** a stacked full map and full list.
- [ ] Mobile List displays listings without a reserved map region.
- [ ] Desktop Split/Map/List work and preserve the search criteria when changing view.
- [ ] Counts correctly distinguish global matches, total inventory, and optional map-viewport count.
- [ ] Saved searches persist and restore the complete search criteria; existing saved-search selection behavior is not broken.
- [ ] `More settings` is visibly secondary and shorter than the primary inputs; there is no redundant Filter action beside a permanently visible sidebar.
- [ ] Key interactions work with keyboard, screen reader, and touch; layouts work at representative narrow/medium/wide widths.

## 12. Implementation sequence

1. **Preserve and unify state:** Identify existing search/facet/saved-search/map behavior and its data contracts; build/confirm shared state and regression tests before visual refactoring.
2. **Refactor layout and toolbar:** Implement compact SearchBar, ResultsToolbar, unified counts/Save, and one applied-chip strip. Remove duplicate applied-filter summaries.
3. **Responsive filter presentation:** Reuse the existing facet groups in desktop sidebar and mobile drawer; make mode/provider accessible without clutter.
4. **View behavior:** Adapt existing list/map to Split/Map/List desktop and Map/List mobile; add compact mobile selected-property preview and marker/card coordination.
5. **Polish and regression test:** Tighten spacing, overflow, sticky behavior, loading states, accessibility, and cross-viewport consistency.

## 13. Non-goals / do not infer from mockups

- **No full redesign** of listing card data, search backend, facet taxonomy, or Saved Searches navigation.
- **No requirement** to add property photos, favoriting/hearts, alert features, persistent mobile bottom navigation, or new saved-search semantics.
- **No duplicate mobile-only filtering implementation.**
- **No forced independent nested scroll containers** for sidebar/results/map.
- **Do not hardcode** illustrative values such as `35 of 1,240`, `27 homes in map`, or example listings.

**Decision summary:** Keep the proven three-column desktop experience, reorganized as compact Option B; use the same components in a density-optimized mobile interface with a filter drawer, a true Map/List switch, one applied-filter strip, inline counts, and a permanently accessible Save search action.

---

## 14. UI stability, rendering, and data efficiency — mandatory quality contract

**Intent:** The search page must look structurally complete before asynchronous data arrives. Loading, refetching, map initialization, image decoding, font loading, and changing data counts must not cause unexpected jumps. The client must not fetch or render more data than the active presentation requires.

This section is **normative** and extends all prior responsive/search requirements. It distinguishes **hard functional/layout gates** from **initial quantitative budgets** (which must be calibrated against the current application's measured baseline, then enforced).

### 14.1 Priority and measurement conventions

| Class | Meaning | CI handling |
|---|---|---|
| **P0 invariant** | Deterministic behavior or layout contract; should be consistently testable | Fail PR on regression |
| **P1 measured budget** | Timing, bytes, and real-user metrics with hardware/network variability | Establish production-build baseline; warn initially, then gate using repeatable fixtures and agreed thresholds |
| **P2 optimization** | Opportunity beyond minimum quality (for example proactive prefetching) | Track without blocking unrelated work |

Use production builds, fixed test data, predictable fonts, and consistent browser/device profiles for comparisons. Do not mistake a Lighthouse synthetic score for a complete measure of interactive search quality; measure **initial navigation and later user interactions** separately.

### 14.2 Alignment and responsive geometry

| ID | Class | Requirement / measurable check |
|---|---|---|
| **ALIGN-01** | P0 | Mobile **Homes / `N of T` / Save** share one unwrapped row at widths where the compact design is supported (minimum test: 320 CSS px); vertical centers within **4 CSS px**. Keep count inline, never below Homes in the standard mobile layout. |
| **ALIGN-02** | P0 | Search, Filters, Sort, Map/List, and Save use shared spacing/height/radius tokens. Peer controls in a toolbar align vertically within **4 CSS px**; labels do not wrap inside controls. |
| **ALIGN-03** | P0 | Desktop facets, results, and map follow stable grid tracks. Search/filter/result controls do not shift horizontally when a sidebar section or count resolves asynchronously. |
| **ALIGN-04** | P0 | At each tested width, no accidental page-level horizontal overflow, clipped text or close icons, overlapping touch targets, or controls extending beyond the viewport. The chip strip may scroll **internally**. |
| **ALIGN-05** | P0 | The applied-chip row uses one line on mobile with horizontal overflow when necessary, not uncontrolled multi-row growth during data loading. Its presence and labels are derived synchronously from selected criteria (including restored URLs/saved searches), not delayed facet API responses. |
| **ALIGN-06** | P0 | Label/value changes (`35` → `1,240`; `Save` → `Saved`; `Relevance` → another sort) do not reflow adjacent controls. Use stable button widths, tabular numeric glyphs, and an appropriate reserved count width. |
| **ALIGN-07** | P0 | Drawer, menus, loading indicators, map previews, and transient errors overlay or use explicitly reserved regions; they do not push the search/results toolbar down when mounted. Compensate for scrollbar removal when opening a drawer. |
| **ALIGN-08** | P0 | Map and results-area dimensions are established by CSS before Leaflet/map JS, tile images, markers, or listing data are ready. Switching to Map does not initially render a small box that later expands. |
| **ALIGN-09** | P0 | The first viewport of results starts as high as practical. Provisional mobile density target at **375 px width**: **≤230 CSS px from the top of the search input to the first content pixel**, with three short applied chips, excluding global site navigation and browser chrome. Measure after implementation and maintain a no-regression budget. |

**Implementation preferences:** CSS Grid/Flexbox for geometry, container queries for control variants, `min-width: 0` for truncatable grid children, `font-variant-numeric: tabular-nums`, shared spacing tokens, and consistent line heights. Avoid JavaScript measuring/repositioning for ordinary responsive layout.

### 14.3 Eliminate visual jumps across loading states

| ID | Class | Requirement / measurable check |
|---|---|---|
| **STABLE-01** | P0 | The global header, search input, search settings, toolbar, results header, chips, and main content tracks render in the **first shell**, without depending on a search API response. |
| **STABLE-02** | P0 | Loading placeholders reserve the **same outer width, height, padding, and image aspect ratio** as the loaded components at the current breakpoint. For first-viewport result cards, the measured placeholder-to-content outer-height difference should be **≤4 px** under canonical fixtures. |
| **STABLE-03** | P0 | Images, map tiles, embedded content, and optional listing thumbnails have intrinsic dimensions or CSS `aspect-ratio`; loading them must not reposition the surrounding cards or toolbar. |
| **STABLE-04** | P0 | Counts and state indicators retain a reserved slot; loading indicators replace text **within that slot**, not insert a new row. Do not show `0 results` temporarily while the actual count is loading. |
| **STABLE-05** | P0 | On filter/sort refetch, keep the existing result region mounted at a stable size. Prefer retaining previously loaded records with a subtle **Updating…** state where semantically safe, or use equal-sized placeholders for a genuine search-context change; never blank/collapse the whole panel. |
| **STABLE-06** | P0 | A complete result set (cards, global count, facet count context) is committed for a **single canonical request key**. Responses arriving out of order must not overwrite newer queries. A stale set may remain visible only if clearly marked as updating; do not display new counts with old results as if they matched. |
| **STABLE-07** | P0 | Map viewport changes preserve the map container and existing tiles/markers until replacement data is ready. The active selected-property preview overlays the map rather than reducing its height. |
| **STABLE-08** | P0 | Empty/error/unauthorized states have stable placement and sensible minimum size; they must not unexpectedly collapse the whole results region or cause the search toolbar to move. Retry controls work without losing filters. |
| **STABLE-09** | P0 | Fonts load with a fallback whose metrics closely match the final font, avoiding significant text reflow. Prefer system fonts or metric-adjusted/self-hosted fonts when relevant; test under delayed fonts. |
| **STABLE-10** | P0 | When removing the last filter chip, intentional immediate removal of the now-empty chip row is allowed; **delayed** collapse after a network response is not. Preserve keyboard focus and make scroll anchoring predictable. |
| **STABLE-11** | P0 | Map/List/Split and sidebar/drawer transitions do not animate layout-defining height/width in ways that cause visible jumps. Prefer short opacity/transform transitions where appropriate; respect reduced motion. |

**Test every component through:** initial shell → loading → populated → refreshing → empty → error → recovered. A visually stable completed screenshot is not enough; verify the **intermediate frames**.

### 14.4 Static-first rendering and hydration

| ID | Class | Requirement |
|---|---|---|
| **RENDER-01** | P0 | Provide a static/prerendered or server-rendered **structural shell**: header, search, controls, selected URL criteria/chips, sidebar/drawer anchor, result header, and reserved content columns. The shell appears without waiting for client-side queries or map initialization. |
| **RENDER-02** | P1 | Where current framework supports it economically, **SSR/cache the initial query's first result page and counts** so users do not see an avoidable empty-shell-to-results delay. If SSR is not practical, render the same stable shell, then fetch only the active view. Do not migrate frameworks solely for this requirement without measuring the tradeoff. |
| **RENDER-03** | P0 | Reuse server-supplied initial data during hydration; do **not** immediately fetch the exact same query again just because the client mounted. Hydrated criteria must match server-rendered controls (no flash of default values). |
| **RENDER-04** | P0 | Do not make initial search control availability depend on loading the map implementation. Lazy-load Leaflet/map-specific JS and assets when Map/Split is first needed; keep the map container reserved during that load. |
| **RENDER-05** | P0 | Search criteria restored from URL/saved-search state are available before render whenever possible. Render chosen chips and correct selected filter states immediately rather than default controls that flip after hydration. |
| **RENDER-06** | P1 | Keep nonessential content outside the critical rendering path: below-fold thumbnails, large listing details, expanded saved-search history, closed facet groups, and optional map details. Avoid delaying the first visible list item for these. |

**Do not overstaticize live search:** Static HTML/layout and cached results are useful; filtered counts, facet values, and provider-specific queries still require accurate server data and explicit freshness/error handling. User-specific saved searches must be cached with proper authorization and isolation.

### 14.5 View-specific data contracts; no over-fetching

| ID | Class | Requirement |
|---|---|---|
| **DATA-01** | P0 | Use canonical query keys comprising normalized query, active facets, mode, provider, and sort. Map-viewport/zoom is a separate cache-key dimension; selected-property details and saved searches have their own keys. |
| **DATA-02** | P0 | **List view:** request only a bounded page of **summary records** required for cards (ID, displayed fields, optional thumbnail URL, necessary map linking coordinates). Target **20–30 rows per page** initially; use cursor pagination or existing paging behavior. Do not transmit every matching property's full description or details. |
| **DATA-03** | P0 | **Map view:** request lightweight coordinate/marker or cluster data restricted to the current bounding box and zoom level; do not fetch/render every property's full card payload just to place markers. Use backend clustering/aggregation at dense zoom levels. |
| **DATA-04** | P0 | **Split view:** share the same list summaries/identity cache with map markers; reuse any details already loaded. Map and list can have separate tailored endpoints but must share canonical filter semantics and not duplicate full-record fetches. |
| **DATA-05** | P0 | **Selected pin/property preview:** use fields already in cached summaries when available; otherwise fetch a single minimal preview by ID. Fetch extended description/media only on opening Details. |
| **DATA-06** | P0 | **Facet drawer:** selected values and chip labels are available immediately. Heavy facet option/count data may be loaded when the drawer is opened on mobile; on desktop load visible facets efficiently, preferably batched. Do not issue one serial request per facet group if an aggregation endpoint is available. |
| **DATA-07** | P0 | **Saved searches:** render a compact recent set in the sidebar; do not download a long saved-search history or full saved result sets until the user opens/uses them. Preserve any existing multi-select semantics. |
| **DATA-08** | P0 | Changing only Map/List/Split must reuse cached results. Fetch only the **missing view-specific representation** on first use, not repeat an unchanged global search/count request. |
| **DATA-09** | P0 | Cancel/ignore superseded searches and viewport requests. Debounce free-text input appropriately (starting point **200–350ms**) and map panning/zooming; facet removals apply to UI immediately. Prevent response races and duplicate requests. |
| **DATA-10** | P0 | Preserve distinction between **total searchable inventory**, **global matching count**, **currently loaded page count**, and **viewport count**. A zoom/pan must not silently redefine the global matching count or filters. |
| **DATA-11** | P1 | Cache appropriate search summaries, image assets, provider metadata, and map tiles with suitable freshness/invalidation; scope private saved-search data by user. Prefer stale-while-revalidate when correct for the data, with visible update semantics. |
| **DATA-12** | P0 | Avoid hidden N+1 fetches from each result card, marker, selected facet, or saved-search row. Batch or prejoin the fields needed for the current view. |

**Minimal response shapes** (conceptual only; adapt to the existing API instead of forcing a rewrite):

```ts
interface SearchSummaryResponse {
  queryKey: string;               // all search dimensions except viewport
  totalMatches: number;
  totalInventory: number;
  listings: ListingSummary[];    // bounded page, no full details
  nextCursor?: string;
  facetCounts?: Record<string, unknown>; // only if efficiently available
}

interface MapViewportResponse {
  queryKey: string;               // same base search context
  viewportKey: string;            // bbox + zoom
  countInViewport: number;
  clusters: Array<{ lat: number; lng: number; count: number }>;
  points: Array<{ id: string; lat: number; lng: number }>;
}
```

**Provisional payload budgets (compressed transfer sizes; not immutable requirements):** first List summary response **≤75 KiB**, a single map viewport/cluster response **≤50 KiB**, and detailed facet counts **≤30 KiB**. Measure actual baseline and adjust before making these CI-failing; retain strict **no unneeded fields / no entire collection download** gates regardless of payload sizes. Asset/image and initial-JS budgets should be established separately by active view; map bundle cost must **not** penalize List-only navigation.

### 14.6 Core Web Vitals, responsiveness, and telemetry

| ID | Class | Budget / requirement |
|---|---|---|
| **PERF-01** | P1 | **Field LCP ≤2.5 seconds at p75** across relevant real-user page loads. Analyze mobile and desktop separately. |
| **PERF-02** | P1 | **Field INP ≤200ms at p75**. Particularly monitor chip removal, sort changes, opening facets, and map selection. |
| **PERF-03** | P1 | **Field CLS ≤0.1 at p75**; aim for **≤0.05** as an internal quality target. |
| **PERF-04** | P0 | In controlled E2E delayed-loading scenarios, target **zero unexpected shifts** from a data response; use `PerformanceObserver` and coordinate checks. A pragmatic initial unexpected-shift signal is **≤0.01 total non-input layout-shift values per scenario** (diagnostic sum, **not** the official session-window CLS metric). |
| **PERF-05** | P1 | Time from API response completion to visible commit should be measured; propose **≤100ms p75 on representative hardware** as an initial rendering goal, subject to baseline. Report network/server time separately. |
| **PERF-06** | P1 | Track initial **JS/CSS transfer and execution**, map chunk bytes, image bytes, query counts, endpoint response sizes, and unnecessary repeat queries **by view**; set and enforce budgets after baseline. |
| **PERF-07** | P0 | No major input lag from map markers, huge facet lists, or thousands of rendered cards. Paginate or virtualize long lists and cluster dense map markers. When virtualizing, provide stable measured/estimated heights and preserve scrolling. |
| **PERF-08** | P1 | Add real-user measurement (e.g., `web-vitals`) for LCP/CLS/INP and custom timings for `search-submit → results-visible`, `filter-change → results-visible`, `map-view-open → markers-ready`, and `view-switch → usable-view`. Segment by device and provider/mode. |

**Note:** Official Core Web Vitals thresholds apply to field p75 and do not guarantee no jump during SPA refetches. Pair them with transition-specific assertions. See [Core Web Vitals thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds/), [CLS guidance](https://web.dev/articles/optimize-cls/), and [LCP guidance](https://web.dev/articles/optimize-lcp/).

### 14.7 Required test matrix and CI gates

Run deterministic UI tests against at least **320, 375, 390, 768, 1024, 1280, and 1440 CSS px**, with representative desktop/mobile DPR and typography settings. Include dark mode if supported.

| Test group | Required scenarios | Gate |
|---|---|---|
| **Alignment/geometry** | Homes/count/Save one row; control centers; chip/remove-icon alignment; sidebar/map grid bounds; no clipped menus | P0 — fail PR |
| **Visual regression** | Screenshots of skeleton and populated states at mobile/tablet/desktop; 0/3/12 chips; short/long listings; Map/List/Split | P0 — baseline review required |
| **Delayed content** | Simulate fast response, **600ms**, **2s**, late images/fonts/map tiles; verify anchor positions before/after | P0 — fail PR |
| **Response races** | Type fast; remove chips; change provider; switch views; deliberately return old response last | P0 — latest query wins; counts/cards/pins consistent |
| **Loading/empty/error** | Initial, refreshing, 0 results, failed request, retry, empty map viewport, save failure | P0 — reserved geometry, no disappearing toolbar |
| **Network economy** | Initial List, Map, Split; view switch twice; drawer open; map pan; open single details | P0 — only required endpoints/fields fetched |
| **Scroll/focus** | Drawer open/close; last chip removal; list pagination; map preview; Back/Forward; mobile keyboard | P0 — no surprising scroll or focus jumps |
| **Budget reporting** | Lighthouse CI 3–5 runs on production build plus payload/JS sizes | P1 — warn/gate after baselines |
| **Field monitoring** | p75 LCP, CLS, INP, and search-interaction timings | P1 — ongoing monitor and regression alerts |

**Recommended CI layers:**

1. **Fast PR checks:** component tests; geometry assertions using element `getBoundingClientRect()`; Playwright screenshots; mocked slow/out-of-order responses; request-count checks. Fail on P0 invariants.
2. **Production-build checks:** Lighthouse CI and compressed asset/API transfer budgets; run stable repeated measurements and compare against baseline. Begin as warnings if the project has no trustworthy historical budget, then graduate to gates.
3. **Deployed smoke tests:** representative real browser/device checks, including low-bandwidth mobile, viewport resize/rotation, and user interaction sequences.
4. **Production real-user monitoring:** Core Web Vitals, endpoint transfer/query totals, and search interaction timings; inspect regressions by mobile/desktop, provider, and view.

Use [Playwright screenshot assertions](https://playwright.dev/docs/test-snapshots) for visual stability, [Lighthouse CI assertions](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/configuration.md) for repeatable budgets, and a **separate transition/geometry harness** for layout jumps that Lighthouse can miss.

### 14.8 Core automated assertions (reference implementation)

The following checks describe the required behavior; selectors/API routing should be adapted to the existing Searchlab code. Add stable `data-testid` attributes **only where accessible role-based selectors are insufficient**.

```ts
// Layout contract examples for Playwright
// 1) Header alignment: bounding rect centers must agree within 4 CSS px.
// 2) No document overflow: documentElement.scrollWidth <= innerWidth + 1.
// 3) Before/after async load: toolbar, map, and reserved card box boundaries
//    must remain within 2–4 CSS px under the same viewport.
// 4) Layout-shift observer: no meaningful non-input layout-shift entries
//    during each scripted delayed data/image/font load scenario.
// 5) First entry in List mode does not request marker-heavy map responses.
// 6) First entry in Map mode does not request full listing details.
// 7) Map -> List -> Map does not repeat a global search for unchanged criteria.
// 8) Out-of-order API responses must not overwrite latest-query results.
// 9) Network payload snapshots reject unexpectedly added expensive fields.
// 10) Screenshots must pass for both skeleton and fully populated states.
```

### 14.9 Definition of done for stability and loading

The UI refactor is **not complete** until:

- [ ] Search shell and layout geometry are present before API data, without hydration/default-state flashes.
- [ ] All P0 alignment/geometry checks pass on representative responsive widths.
- [ ] Skeleton → result, refetch, error, and map load show no unexpected reflow of the header/toolbar/map.
- [ ] Counts, filters, cards, and pins cannot represent mixed query versions after response races.
- [ ] List mode does not load an unnecessary map dataset/bundle; Map mode does not download full listing/card details.
- [ ] Split view reuses shared data and does not repeatedly fetch the same records.
- [ ] Paging/viewport clustering prevents loading/rendering an unbounded full result set.
- [ ] A recorded production-build baseline exists for Web Vitals, rendered JS, initial API payloads, and request counts.
- [ ] Lighthouse CI, Playwright visual/regression suites, and transition-specific checks run automatically in the delivery pipeline.
- [ ] All exceptions have an explicit owner, measured impact, and follow-up; do not silently weaken budgets to make CI green.

**Product decision:** Visual stability, predictable alignment, and view-specific loading are functional requirements—not optional post-launch polish.
