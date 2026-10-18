'use client';

import dynamic from 'next/dynamic';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import SearchQuery, { type PlaceSuggestion } from '@/components/search-query';
import {
  activeFilterCount,
  buildSearchRequest,
  createLatestSearch,
  emptySearchState,
  postSearch,
  readSearchState,
  type SearchFilters,
  type SearchHit,
  type SearchMode,
  type SearchProvider,
  type SearchResponse,
  type SearchSort,
  type SearchState
} from '@/lib/search';

const MapPanel = dynamic(() => import('@/components/map-panel'), {
  ssr: false,
  loading: () => <div className="map-loading" role="status">Loading map…</div>
});

type ViewMode = 'split' | 'map' | 'list';
const DetailsDialog = dynamic(() => import('@/components/details-dialog'), {
  ssr: false,
  loading: () => <div className="detail-loading" role="status">Opening home details…</div>
});
const DiagnosticsDialog = dynamic(() => import('@/components/diagnostics-dialog'), {
  ssr: false,
  loading: () => <div className="detail-loading" role="status">Opening request details…</div>
});
function readView(): ViewMode {
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'map' ? 'map' : value === 'split' && window.matchMedia('(min-width: 901px)').matches ? 'split' : 'list';
}
function criteriaKey(state: SearchState) {
  const filters = Object.fromEntries(Object.entries(state.filters).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value]));
  return JSON.stringify({ provider: state.provider, mode: state.mode, q: state.q, sort: state.sort, filters, savedSearchIds: [...state.savedSearchIds].sort() });
}
type FeedPosition = { windowY: number; listY: number; width: number; height: number; anchor: HTMLElement | null; focus: HTMLElement | null };
function readFeedPosition(): FeedPosition {
  const list = document.querySelector<HTMLElement>('.result-list');
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeCard = active?.closest<HTMLElement>('.result-card') ?? null;
  const bounds = list?.getBoundingClientRect();
  const top = Math.max(0, bounds?.top ?? 0), bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
  const anchor = activeCard ?? [...document.querySelectorAll<HTMLElement>('.result-card')].find((card) => { const r = card.getBoundingClientRect(); return r.bottom > top && r.top < bottom; }) ?? null;
  return { windowY: window.scrollY, listY: list?.scrollTop ?? 0, width: window.innerWidth, height: window.innerHeight, anchor, focus: activeCard ? active : anchor?.querySelector<HTMLElement>('.result-select') ?? null };
}
function restoreFeedPosition(position: FeedPosition, focus: boolean) {
  if ((position.width !== window.innerWidth || position.height !== window.innerHeight) && position.anchor?.isConnected) {
    position.anchor.scrollIntoView({ block: 'center', inline: 'nearest' });
  } else {
    document.querySelector('.result-list')?.scrollTo(0, position.listY);
    window.scrollTo(0, position.windowY);
  }
  if (focus && position.focus?.isConnected) position.focus.focus({ preventScroll: true });
}
function writeUiUrl(view: ViewMode, home: string | null, push = true) {
  const url = new URL(window.location.href);
  if (view === 'list') url.searchParams.delete('view'); else url.searchParams.set('view', view);
  if (home) url.searchParams.set('home', home); else url.searchParams.delete('home');
  const ownsDetailEntry = Boolean(home) && (push || window.history.state?.searchlabDetail === true);
  window.history[push ? 'pushState' : 'replaceState']({ ...window.history.state, searchlabDetail: ownsDetailEntry }, '', url);
}

const facetGroups = [
  { key: 'city', label: 'City' },
  { key: 'neighborhood', label: 'Neighborhood' },
  { key: 'schoolDistrict', label: 'School district' },
  { key: 'propertyType', label: 'Home type' },
  { key: 'bedrooms', label: 'Bedrooms', numeric: true },
  { key: 'amenities', label: 'Property features' },
  { key: 'listingStatus', label: 'Status' }
] as const;

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const title = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

function readUrlState(): SearchState {
  return readSearchState(new URLSearchParams(window.location.search));
}

function syncUrl(state: SearchState, mode: 'push' | 'replace') {
  const params = new URLSearchParams();
  params.set('provider', state.provider);
  params.set('mode', state.mode);
  params.set('sort', state.sort);
  if (state.q) params.set('q', state.q);
  for (const [key, value] of Object.entries(state.filters)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
    else if (value !== undefined) params.set(key, String(value));
  }
  state.savedSearchIds.forEach((id) => params.append('savedSearchId', id));
  const current = new URLSearchParams(window.location.search);
  for (const key of ['view', 'home']) { const value = current.get(key); if (value) params.set(key, value); }
  const url = `${window.location.pathname}?${params.toString()}`;
  if (url !== window.location.pathname + window.location.search) {
    window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', url);
  }
}

function FilterPanel({
  filters,
  facets,
  onToggle,
  onRange,
  onClear,
  open,
  panelRef,
  onClose,
  visible,
  ready
}: {
  filters: SearchFilters;
  facets: SearchResponse['facets'];
  onToggle: (key: string, value: string | number, checked: boolean) => void;
  onRange: (key: string, value: number | undefined) => void;
  onClear: () => void;
  open: boolean;
  panelRef: React.Ref<HTMLElement>;
  onClose: () => void;
  visible: boolean;
  ready: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [disclosed, setDisclosed] = useState<Record<string, boolean>>({ bedrooms: true, amenities: true });
  const keys = Object.keys(filters).filter((key) => {
    const value = filters[key];
    return value !== undefined && (!Array.isArray(value) || value.length > 0);
  });
  return (
    <aside ref={panelRef} className="filter-panel" data-open={open} aria-label="Refine results" aria-modal={open ? true : undefined} role={open ? 'dialog' : 'complementary'}>
      <fieldset className="pending-controls" disabled={!ready}>
      <header className="filter-heading"><strong>Refine results</strong><button type="button" className="filter-close" onClick={onClose} aria-label="Close filters">Close</button><button type="button" className="text-button" onClick={onClear}>Clear all</button></header>
      <section className="range-group" aria-labelledby="price-filter-title">
        <h3 id="price-filter-title">Price range</h3>
        <div className="range-inputs">
          <label><span className="sr-only">Minimum price</span><input inputMode="numeric" type="number" min="0" placeholder="$0" value={typeof filters.minPrice === 'number' ? filters.minPrice : ''} onChange={(event) => onRange('minPrice', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
          <label><span className="sr-only">Maximum price</span><input inputMode="numeric" type="number" min="0" placeholder="No maximum" value={typeof filters.maxPrice === 'number' ? filters.maxPrice : ''} onChange={(event) => onRange('maxPrice', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
        </div>
      </section>
      {facetGroups.map((group) => {
        const buckets = facets[group.key] ?? [];
        if (!visible || !buckets.length) return null;
        return <details className="facet-group" key={group.key} open={Boolean(disclosed[group.key])} onToggle={(event) => { const next = event.currentTarget.open; setDisclosed((current) => current[group.key] === next ? current : { ...current, [group.key]: next }); }}>
          <summary>{group.label}</summary>
          {disclosed[group.key] && <><div className="facet-options">
            {(expanded[group.key] ? buckets : buckets.slice(0, 8)).map((bucket) => {
              const value = 'numeric' in group && group.numeric ? Number(bucket.value) : bucket.value;
              const selected = (filters[group.key] ?? []) as Array<string | number>;
              return <label className="facet-option" key={bucket.value}>
                <input type="checkbox" checked={selected.some((item) => String(item) === String(value))} onChange={(event) => onToggle(group.key, value, event.target.checked)} />
                <span>{group.key === 'bedrooms' ? `${value} beds` : title(bucket.value)}</span><span className="facet-count">{bucket.count}</span>
              </label>;
            })}
          </div>
          {buckets.length > 8 && <button type="button" className="text-button" onClick={() => setExpanded((current) => ({ ...current, [group.key]: !current[group.key] }))}>{expanded[group.key] ? 'Show fewer' : `Show all ${buckets.length}`}</button>}</>}
        </details>;
      })}
      {keys.length > 0 && <p className="filter-summary">{activeFilterCount(filters)} active {activeFilterCount(filters) === 1 ? 'filter' : 'filters'}</p>}
      </fieldset>
    </aside>
  );
}

function Refinements({ filters, onRemove, onClear, ready }: { ready: boolean; filters: SearchFilters; onRemove: (key: string, value?: string | number) => void; onClear: () => void }) {
  const values = Object.entries(filters).flatMap(([key, value]) =>
    Array.isArray(value) ? value.map((item) => ({ key, value: item, label: key === 'bedrooms' ? `${item} beds` : title(String(item)) })) :
      value !== undefined ? [{ key, value, label: key === 'maxPrice' ? `Under ${money(value)}` : key === 'minPrice' ? `Over ${money(value)}` : `${title(key)} ${value}` }] : []
  );
  if (!values.length) return null;
  return <div className="refinements-wrap" aria-label="Applied filters">
    <div className="refinements" data-testid="active-filter-chips">{values.map((item) => <button className="chip" type="button" disabled={!ready} key={`${item.key}:${item.value}`} aria-label={`Remove ${title(item.key)}: ${item.label}`} onClick={() => onRemove(item.key, item.value)}><span>{item.label}</span><span aria-hidden="true">×</span></button>)}<button className="text-button clear-refinements" type="button" disabled={!ready} onClick={onClear}>Clear all</button></div>
  </div>;
}

// The hit is replaced by each backend response. Readiness, selection and UI-only
// state can update the link/controls without recomputing unchanged display fields.
const ResultSummary = memo(function ResultSummary({ hit }: { hit: SearchHit }) {
  return <>
      <div className="result-topline"><strong>{money(hit.price)}</strong><span className="status-badge">{title(hit.listingStatus)}</span></div>
      <h3>{hit.title}</h3>
      <p className="result-location">{hit.city}{hit.neighborhood ? ` · ${hit.neighborhood}` : ''}</p>
      <div className="property-facts"><span>{hit.bedrooms} bd</span><span>{hit.bathrooms} ba</span><span>{hit.squareFeet.toLocaleString()} sqft</span>{hit.distanceMiles !== undefined && <span>{hit.distanceMiles.toFixed(1)} mi</span>}</div>
      <p className="result-description">{hit.description}</p>
  </>;
});

function ResultCard({ hit, selected, onSelect, onMap, onAmenity, ready, returnTo }: { hit: SearchHit; selected: boolean; ready: boolean; returnTo: string; onSelect: () => void; onMap: () => void; onAmenity: (value: string) => void }) {
  return <article className={`result-card${selected ? ' is-selected' : ''}`} data-house-id={hit.id}>
    <a className="result-select" href={`/homes/${encodeURIComponent(hit.id)}?returnTo=${encodeURIComponent(returnTo)}`} onClick={(event) => { if (!ready || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onSelect(); }} aria-haspopup={ready ? "dialog" : undefined} aria-label={`View details: ${hit.title}`}>
      <ResultSummary hit={hit} />
    </a>
    <footer className="result-actions"><div className="amenity-tags">{hit.amenities.slice(0, 4).map((item) => <button type="button" className="amenity-tag" disabled={!ready} key={item} onClick={() => onAmenity(item)}>{title(item)}</button>)}</div><button type="button" className="text-button details-action" disabled={!ready} onClick={onMap}>Show on map</button></footer>
  </article>;
}

type InitialSearch = { request: SearchState; response: SearchResponse | null; error: string | null };

export default function SearchPage({ initial }: { initial?: InitialSearch }) {
  const [request, setRequest] = useState<SearchState>(() => initial?.request ?? emptySearchState());
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [filterOpen, setFilterOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(initial?.response ?? null);
  const [hits, setHits] = useState<SearchHit[]>(initial?.response?.hits ?? []);
  const [mapResult, setMapResult] = useState<{ response: SearchResponse; criteria: string } | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapRetry, setMapRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const searchFocusedRef = useRef(searchFocused);
  searchFocusedRef.current = searchFocused;
  const searchPosition = useRef<FeedPosition | null>(null);
  const restoreSearchPosition = useRef(false);
  const closingSearch = useRef(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const diagnosticsTrigger = useRef<HTMLElement | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const requestRef = useRef(request);
  requestRef.current = request;
  const feedScroll = useRef<FeedPosition>({ windowY: 0, listY: 0, width: 0, height: 0, anchor: null, focus: null });
  const restoreFeedFocus = useRef(false);
  const skipFeedRestore = useRef(false);
  const detailIdRef = useRef(detailId);
  detailIdRef.current = detailId;
  const closingDetails = useRef(false);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial?.error ?? null);
  const [loadMore, setLoadMore] = useState(false);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const filterPanel = useRef<HTMLElement>(null);
  const searchController = useRef<ReturnType<typeof createLatestSearch<SearchResponse>> | null>(null);
  const mapController = useRef<ReturnType<typeof createLatestSearch<SearchResponse>> | null>(null);
  const historyMode = useRef<'push' | 'replace'>('replace');
  const appendNext = useRef(false);
  const firstSearch = useRef(!initial);
  const skipInitialSearch = useRef(Boolean(initial));
  const searchImmediately = useRef(false);
  const filterCount = activeFilterCount(request.filters);

  if (!searchController.current) searchController.current = createLatestSearch(postSearch, 180);
  if (!mapController.current) mapController.current = createLatestSearch(postSearch, 180);

  const closeDetails = useCallback(() => {
    if (closingDetails.current) return;
    restoreFeedFocus.current = true;
    if (window.history.state?.searchlabDetail) { closingDetails.current = true; window.history.back(); }
    else { writeUiUrl(view, null, false); setDetailId(null); }
  }, [view]);
  const cancelFocusedSearch = useCallback(() => {
    if (closingSearch.current) return;
    if (window.history.state?.searchlabSearch) { closingSearch.current = true; window.history.back(); }
    else { restoreSearchPosition.current = true; setSearchFocused(false); }
  }, []);
  useEffect(() => {
    if (!showDiagnostics) return;
    const closePending = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.diagnostics-dialog[open]')) setShowDiagnostics(false); };
    document.addEventListener('keydown', closePending);
    return () => document.removeEventListener('keydown', closePending);
  }, [showDiagnostics]);
  useEffect(() => {
    if (!detailId) return;
    const cancelPending = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.home-details[open]')) { event.preventDefault(); closeDetails(); }
    };
    document.addEventListener('keydown', cancelPending);
    return () => document.removeEventListener('keydown', cancelPending);
  }, [detailId, closeDetails]);

  useEffect(() => {
    performance.mark('searchlab-hydrated');
    const urlRequest = readUrlState();
    if (!initial || criteriaKey(initial.request) !== criteriaKey(urlRequest)) setRequest(urlRequest);
    setView(readView());
    if (readView() === 'list' && new URLSearchParams(window.location.search).get('view') === 'split') writeUiUrl('list', new URLSearchParams(window.location.search).get('home'), false);
    setDetailId(new URLSearchParams(window.location.search).get('home'));
    setReady(true);
    const restore = () => {
      closingDetails.current = false;
      closingSearch.current = false;
      const next = readUrlState();
      const nextHome = new URLSearchParams(window.location.search).get('home');
      const previousDetail = detailIdRef.current;
      const previousView = viewRef.current;
      const sameCriteria = criteriaKey(next) === criteriaKey(requestRef.current);
      const nextView = readView();
      const nextSearch = window.history.state?.searchlabSearch === true && !window.matchMedia('(min-width: 901px)').matches;
      restoreSearchPosition.current = searchFocusedRef.current && !nextSearch && sameCriteria;
      setSearchFocused(nextSearch);
      if (nextView === 'list' && new URLSearchParams(window.location.search).get('view') === 'split') writeUiUrl('list', new URLSearchParams(window.location.search).get('home'), false);
      if (nextView !== previousView && previousView !== 'map' && !previousDetail) feedScroll.current = readFeedPosition();
      setView(nextView);
      setDetailId(nextHome);
      restoreFeedFocus.current = sameCriteria && Boolean((previousDetail && !nextHome) || (previousView === 'map' && nextView !== 'map'));
      skipFeedRestore.current = !sameCriteria;
      // UI-only history must retain loaded pages and avoid another search.
      if (sameCriteria) return;
      historyMode.current = 'replace';
      setLoading(true);
      appendNext.current = false;
      setLoadMore(false);
      setSelectedId(null);
      setRequest(next);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!ready || !searchController.current) return;
    syncUrl(request, historyMode.current);
    historyMode.current = 'replace';
    if (skipInitialSearch.current) {
      skipInitialSearch.current = false;
      if (initial && criteriaKey(request) === criteriaKey(initial.request)) return;
    }
    const searchRequest = buildSearchRequest(request);
    const cancel = searchController.current.schedule(searchRequest, {
      onStart: () => { setLoading(true); setError(null); },
      onSuccess: (next) => {
        setResponse(next);
        const append = appendNext.current;
        setHits((previous) => append ? [...previous, ...next.hits] : next.hits);
        appendNext.current = false;
        setLoading(false);
        setLoadMore(false);
      },
      onError: (reason) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Search failed.');
        if (request.page === 1) { setResponse(null); setHits([]); appendNext.current = false; }
        setLoading(false);
        setLoadMore(false);
      }
    }, firstSearch.current || searchImmediately.current ? 0 : undefined);
    firstSearch.current = false;
    searchImmediately.current = false;
    return cancel;
  }, [request, ready]);

  useEffect(() => {
    if (!ready || (view !== 'map' && view !== 'split')) {
      mapController.current?.cancel();
      setMapLoading(false);
      return;
    }
    setMapLoading(true);
    setMapError(false);
    return mapController.current!.schedule(buildSearchRequest(request, { mapOnly: true }), {
      onSuccess: (next) => { setMapResult({ response: next, criteria: criteriaKey(request) }); setMapLoading(false); },
      onError: () => { setMapError(true); setMapLoading(false); }
    });
  }, [request.provider, request.mode, request.q, request.filters, request.sort, request.savedSearchIds, ready, view, mapRetry]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 901px)');
    const resize = () => {
      setDesktop(media.matches);
      if (media.matches) { setFilterOpen(false); if (searchFocusedRef.current) cancelFocusedSearch(); }
      else {
        setView((current) => current === 'split' ? 'list' : current);
        if (new URLSearchParams(window.location.search).get('view') === 'split') writeUiUrl('list', new URLSearchParams(window.location.search).get('home'), false);
      }
    };
    resize();
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, [cancelFocusedSearch]);

  useEffect(() => {
    if (searchFocused || !restoreSearchPosition.current) return;
    restoreSearchPosition.current = false;
    const frame = requestAnimationFrame(() => {
      if (searchPosition.current) restoreFeedPosition(searchPosition.current, true);
      if (viewRef.current === 'map') document.querySelector<HTMLElement>('.map-column')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [searchFocused]);

  useEffect(() => {
    if (detailId) return;
    if (view === 'map') {
      const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.map-column')?.focus({ preventScroll: true }));
      return () => cancelAnimationFrame(frame);
    }
    if (skipFeedRestore.current) { skipFeedRestore.current = false; return; }
    // Run after the popstate commit and browser history's own scroll restoration.
    const frame = requestAnimationFrame(() => {
      restoreFeedPosition(feedScroll.current, restoreFeedFocus.current);
      restoreFeedFocus.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, detailId]);

  useEffect(() => {
    if (!filterOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = [...document.querySelectorAll<HTMLElement>('.global-header, .search-controls, .mobile-toolbar, .results-column')];
    const wasInert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    filterPanel.current?.querySelector<HTMLElement>('button, input, summary')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setFilterOpen(false); return; }
      if (event.key !== 'Tab' || !filterPanel.current) return;
      const focusable = [...filterPanel.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary')].filter((element) => element.getClientRects().length > 0 && (!element.closest('details:not([open])') || element.tagName === 'SUMMARY'));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      background.forEach((element, index) => { element.inert = wasInert[index]; });
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [filterOpen]);

  const update = useCallback((change: (current: SearchState) => SearchState, mode: 'push' | 'replace' = 'push') => {
    historyMode.current = mode;
    setLoading(true);
    setLoadMore(false);
    setRequest((current) => ({ ...change(current), page: 1 }));
    appendNext.current = false;
    setSelectedId(null);
    setDetailId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('home');
    window.history.replaceState({ ...window.history.state, searchlabDetail: false }, '', url);
  }, []);

  const openFocusedSearch = () => {
    if (searchFocusedRef.current) return;
    searchFocusedRef.current = true;
    searchPosition.current = readFeedPosition();
    restoreSearchPosition.current = false;
    window.history.pushState({ ...window.history.state, searchlabSearch: true }, '', window.location.href);
    setSearchFocused(true);
  };
  const commitSearch = (query: string, place?: PlaceSuggestion, pointerFocus = false) => {
    if (!searchFocused) {
      searchImmediately.current = true;
      update((current) => ({ ...current, q: query }), 'replace');
      return;
    }
    const next = { ...request, q: place ? '' : query, filters: place ? { ...request.filters, [place.field]: [place.value] } : request.filters };
    if (criteriaKey(next) === criteriaKey(request)) { cancelFocusedSearch(); return; }
    restoreSearchPosition.current = false;
    window.history.replaceState({ ...window.history.state, searchlabSearch: false }, '', window.location.href);
    setSearchFocused(false);
    searchImmediately.current = true;
    update(() => next, 'replace');
    requestAnimationFrame(() => {
      document.querySelector('.result-list')?.scrollTo(0, 0);
      window.scrollTo(0, 0);
      const heading = document.querySelector<HTMLElement>('[data-testid=results-heading]');
      if (pointerFocus) heading?.setAttribute('data-pointer-focus', 'true');
      else heading?.removeAttribute('data-pointer-focus');
      heading?.focus({ preventScroll: true });
    });
  };

  const toggleFilter = useCallback((key: string, value: string | number, checked: boolean) => {
    update((current) => {
      const existing = Array.isArray(current.filters[key]) ? current.filters[key] as Array<string | number> : [];
      const values = new Map(existing.map((item) => [String(item), item]));
      if (checked) values.set(String(value), value); else values.delete(String(value));
      const filters = { ...current.filters };
      if (values.size) filters[key] = [...values.values()]; else delete filters[key];
      return { ...current, filters };
    });
  }, [update]);

  const setRange = useCallback((key: string, value: number | undefined) => {
    update((current) => {
      const filters = { ...current.filters };
      if (value === undefined || !Number.isFinite(value)) delete filters[key]; else filters[key] = value;
      return { ...current, filters };
    }, 'replace');
  }, [update]);

  const clearFilters = useCallback(() => update((current) => ({ ...current, filters: {} })), [update]);

  const removeFilter = useCallback((key: string, value?: string | number) => {
    update((current) => {
      const filters = { ...current.filters };
      const existing = filters[key];
      if (Array.isArray(existing) && value !== undefined) {
        const next = existing.filter((item) => String(item) !== String(value));
        if (next.length) filters[key] = next; else delete filters[key];
      } else delete filters[key];
      return { ...current, filters };
    });
  }, [update]);

  const rememberFeed = () => {
    if (view !== 'map') feedScroll.current = readFeedPosition();
  };
  const changeView = (next: ViewMode) => {
    if (next === view) return;
    restoreFeedFocus.current = false;
    rememberFeed();
    writeUiUrl(next, null);
    setDetailId(null);
    setView(next);
  };
  const openDetails = (hit: SearchHit) => {
    restoreFeedFocus.current = false;
    detailTrigger.current = document.activeElement as HTMLElement;
    rememberFeed();
    setSelectedId(hit.id);
    setDetailId(hit.id);
    writeUiUrl(view, hit.id);
  };
  const showOnMap = (id: string) => {
    if (!detailId) rememberFeed();
    writeUiUrl('map', null, !detailId);
    setDetailId(null);
    setSelectedId(id);
    setView('map');
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.map-column')?.focus({ preventScroll: true }));
  };
  const mapResponse = mapResult?.response ?? null;
  const markers = mapResponse?.mapHits ?? [];
  const retryMap = () => { setMapLoading(true); setMapError(false); setMapRetry((attempt) => attempt + 1); };
  const previousMap = Boolean(mapResult && (mapLoading || mapError || mapResult.criteria !== criteriaKey(request)));
  const mapFeedback = previousMap ? {
    failed: mapError,
    message: mapError
      ? 'Map update failed. Showing previous results; they may not match the current search.'
      : 'Showing previous map results while updating for the current search.',
    retry: retryMap
  } : undefined;
  const activeListHit = hits.find((hit) => hit.id === selectedId) ?? null;
  const activeHit = activeListHit ?? markers.find((hit) => hit.id === selectedId) ?? null;
  const facetData = response?.facets ?? {};
  const viewLabel = view === 'map' ? 'Map' : view === 'list' ? 'List' : 'Split';

  const loadNextPage = () => {
    if (!response || hits.length >= response.totalHits || loading || error) return;
    appendNext.current = true;
    setLoading(true);
    setLoadMore(true);
    setRequest((current) => ({ ...current, page: response.page + 1 }));
  };

  const returnParams = new URLSearchParams({ provider: request.provider, mode: request.mode, sort: request.sort });
  if (request.q) returnParams.set('q', request.q);
  for (const [key, value] of Object.entries(request.filters)) {
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value]) returnParams.append(key, String(item));
  }
  request.savedSearchIds.forEach(id => returnParams.append('savedSearchId', id));
  const progressiveReturnTo = '/search?' + returnParams.toString();
  const summary = response ? response.totalInventory == null ? `${response.totalHits.toLocaleString()} matches` : `${response.totalHits.toLocaleString()} of ${response.totalInventory.toLocaleString()}` : error ? 'Unavailable' : 'Loading results';

  return <main className="searchlab-shell">
    {!ready && <span className="controls-pending" role="status">Preparing filters and map… Search and home links are ready.</span>}
    <section className="search-controls" data-testid="search-toolbar" aria-label="Search settings">
      <SearchQuery ready={ready} request={request} response={response} settled={!loading && !error} focused={searchFocused} onOpen={openFocusedSearch} onCancel={cancelFocusedSearch} onCommit={commitSearch} onDesktopChange={(query) => update((current) => ({ ...current, q: query }), 'replace')} />
      <label className="desktop-setting">Mode<select disabled={!ready} value={request.mode} onChange={(event) => update((current) => ({ ...current, mode: event.target.value as SearchMode }))}><option value="keyword">Keyword</option><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option></select></label>
      <label className="desktop-setting">Provider<select disabled={!ready} value={request.provider} onChange={(event) => update((current) => ({ ...current, provider: event.target.value as SearchProvider }))}><option value="postgres_native">PostgreSQL</option><option value="pg_search">PostgreSQL · BM25</option><option value="meilisearch">Meilisearch</option><option value="typesense">Typesense</option></select></label>
      <details className="more-settings"><summary>More settings</summary><div className="settings-popover"><label>Mode<select disabled={!ready} value={request.mode} onChange={(event) => update((current) => ({ ...current, mode: event.target.value as SearchMode }))}><option value="keyword">Keyword</option><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option></select></label><label>Provider<select disabled={!ready} value={request.provider} onChange={(event) => update((current) => ({ ...current, provider: event.target.value as SearchProvider }))}><option value="postgres_native">PostgreSQL</option><option value="pg_search">PostgreSQL · BM25</option><option value="meilisearch">Meilisearch</option><option value="typesense">Typesense</option></select></label></div></details>
    </section>

    <section className="mobile-toolbar" aria-label="Search controls">
      <button ref={drawerTrigger} className="toolbar-button filters-trigger" type="button" disabled={!ready} onClick={() => setFilterOpen(true)}>Filters ({filterCount})</button>
      <label className="sort-control"><span className="sr-only">Sort results</span><select disabled={!ready} value={request.sort} onChange={(event) => update((current) => ({ ...current, sort: event.target.value as SearchSort }))}><option value="relevance">Relevance</option><option value="price_asc">Price ↑</option><option value="price_desc">Price ↓</option><option value="newest">Newest</option></select></label>
      <div className="view-tabs mobile-views" role="group" aria-label="Results view"><button type="button" disabled={!ready} aria-pressed={view === 'map'} onClick={() => changeView('map')}>Map</button><button type="button" disabled={!ready} aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</button></div>
      <details className="mobile-settings"><summary>More</summary><div className="settings-popover"><label>Mode<select disabled={!ready} value={request.mode} onChange={(event) => update((current) => ({ ...current, mode: event.target.value as SearchMode }))}><option value="keyword">Keyword</option><option value="hybrid">Hybrid</option><option value="semantic">Semantic</option></select></label><label>Provider<select disabled={!ready} value={request.provider} onChange={(event) => update((current) => ({ ...current, provider: event.target.value as SearchProvider }))}><option value="postgres_native">PostgreSQL</option><option value="pg_search">PostgreSQL · BM25</option><option value="meilisearch">Meilisearch</option><option value="typesense">Typesense</option></select></label></div></details>
    </section>

    <div className="page-layout">
      {filterOpen && <button type="button" className="drawer-backdrop" tabIndex={-1} aria-label="Close filters" onClick={() => setFilterOpen(false)} />}
      <FilterPanel ready={ready} panelRef={filterPanel} visible={desktop || filterOpen} onClose={() => setFilterOpen(false)} filters={request.filters} facets={facetData} onToggle={toggleFilter} onRange={setRange} onClear={() => { clearFilters(); setFilterOpen(false); }} open={filterOpen} />
      <section className="results-column" aria-label="Search results">
        <header className="results-header">
          <div className="results-heading"><h1 data-testid="results-heading" tabIndex={-1} onBlur={(event) => event.currentTarget.removeAttribute('data-pointer-focus')}>Homes</h1><span className="result-count" data-testid="results-count" role="status" aria-live="polite">{loading && response ? 'Searching…' : summary}</span>{response?.provenance && <button className="request-timing" type="button" disabled={!ready} aria-label={`Show backend details. Last ${response.browserFetchMs !== undefined ? 'browser fetch and parsing' : 'gateway request'} ${response.browserFetchMs ?? response.gatewayTimingMs ?? response.provenance.timing.apiMs} milliseconds`} title="Last completed request; show backend details" onClick={(event) => { diagnosticsTrigger.current = event.currentTarget; setShowDiagnostics(true); }}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="7.5" /><path d="M10 5v5l3 2" /></svg><span>{Math.round(response.browserFetchMs ?? response.gatewayTimingMs ?? response.provenance.timing.apiMs)} ms {response.browserFetchMs !== undefined ? 'fetch' : 'server'}</span></button>}</div>
          <div className="results-actions">
            <div className="view-tabs desktop-views" role="group" aria-label="Results view"><button type="button" disabled={!ready} aria-pressed={view === 'split'} onClick={() => changeView('split')}>Split</button><button type="button" disabled={!ready} aria-pressed={view === 'map'} onClick={() => changeView('map')}>Map</button><button type="button" disabled={!ready} aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</button></div>
            <label className="sort-control desktop-sort"><span className="sr-only">Sort results</span><select disabled={!ready} value={request.sort} onChange={(event) => update((current) => ({ ...current, sort: event.target.value as SearchSort }))}><option value="relevance">Sort: Relevance</option><option value="price_asc">Sort: Price ↑</option><option value="price_desc">Sort: Price ↓</option><option value="newest">Sort: Newest</option></select></label>
            <button type="button" data-testid="save-search" className="save-search" disabled title="Saved-search actions will be migrated in a follow-up slice">Save search</button>
          </div>
        </header>

        <Refinements ready={ready} filters={request.filters} onRemove={removeFilter} onClear={clearFilters} />
        {error && <div className="search-error" role="alert"><strong>Search unavailable</strong><span>{error}</span><button type="button" disabled={!ready} onClick={() => setRequest((current) => ({ ...current }))}>Retry</button></div>}
        {response?.debug?.warnings?.map((warning) => <p className="backend-warning" key={warning}>{warning}</p>)}
        {!response && !error && <div className="result-skeletons" aria-label="Loading results" aria-busy="true"><div /><div /><div /></div>}
        {response && hits.length === 0 && !error && <div className="empty-results"><h2>No homes match this search</h2><p>Try fewer filters or a broader search.</p><button type="button" disabled={!ready} onClick={clearFilters}>Clear filters</button></div>}
        {response && hits.length > 0 && <div className={`results-workspace view-${viewLabel.toLowerCase()}`} data-view={view} aria-busy={loading}>
          {<div className="result-list" aria-label="Homes"><div className="result-list-inner">
            {hits.map((hit) => <ResultCard key={hit.id} ready={ready} returnTo={progressiveReturnTo} hit={hit} selected={hit.id === selectedId} onSelect={() => openDetails(hit)} onMap={() => showOnMap(hit.id)} onAmenity={(value) => toggleFilter('amenities', value, true)} />)}
            {hits.length < response.totalHits && <button type="button" className="load-more" onClick={loadNextPage} disabled={!ready || loading || Boolean(error)}>{loadMore ? 'Loading more…' : 'Show more homes'}</button>}
          </div></div>}
          {view !== 'list' && <section className="map-column" tabIndex={-1} aria-label="Map of matching homes">
            {!mapResponse && !mapError && <div className="map-loading" role="status">Loading map results…</div>}
            {mapResponse && <MapPanel hits={markers} selectedId={selectedId} onSelect={setSelectedId} feedback={mapFeedback} />}
            {mapError && !mapResponse && <div className="map-unavailable" role="alert"><div><span>Map data is unavailable. The list and filters are still ready.</span><button className="map-retry" type="button" onClick={(event) => { event.currentTarget.closest<HTMLElement>('.map-column')?.focus({ preventScroll: true }); retryMap(); }}>Retry map</button></div></div>}
            {activeHit && <aside className="map-preview" aria-live="polite"><button type="button" aria-label="Close selected home" onClick={() => setSelectedId(null)}>×</button><strong>{money(activeHit.price)}</strong><h2>{activeHit.title}</h2><p>{activeHit.city}{activeHit.neighborhood ? ` · ${activeHit.neighborhood}` : ''}</p>{activeListHit && <span>{activeListHit.bedrooms} bd · {activeListHit.bathrooms} ba · {activeListHit.squareFeet.toLocaleString()} sqft</span>}</aside>}
          </section>}
        </div>}
        {response && <p className="result-footnote">{hits.length < response.totalHits ? `Showing ${hits.length} of ${response.totalHits.toLocaleString()} matches` : `Showing all ${response.totalHits.toLocaleString()} matches`}{response.totalInventory == null ? ' · total inventory unavailable' : ` · ${response.totalInventory.toLocaleString()} homes in inventory`}</p>}
      </section>
    </div>
    {detailId && <DetailsDialog id={detailId} hit={hits.find((hit) => hit.id === detailId) ?? null} onClose={closeDetails} onMap={() => showOnMap(detailId)} returnFocus={detailTrigger.current} />}
    {showDiagnostics && response && <DiagnosticsDialog response={response} onClose={() => setShowDiagnostics(false)} returnFocus={diagnosticsTrigger.current} />}
  </main>;
}
