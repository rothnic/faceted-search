'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import FilterPanel from '@/components/search-filters';
import ResultCard from '@/components/result-card';
import FilterChip from '@/components/filter-chip';
import { ServiceSelects, SearchSettingsMenu, SortSelect } from '@/components/search-settings';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetClose } from '@/components/ui/sheet';

import { useCallback, useEffect, useRef, useState } from 'react';
import SearchQuery, { type PlaceSuggestion } from '@/components/search-query';
import {
  activeFilterCount,
  buildSearchUrl,
  buildSearchRequest,
  createLatestSearch,
  emptySearchState,
  postSearch,
  readSearchState,
  type SearchFilters,
  type SearchHit,
  type SearchResponse,
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

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const title = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());

function readUrlState(): SearchState {
  return readSearchState(new URLSearchParams(window.location.search));
}

function syncUrl(state: SearchState, mode: 'push' | 'replace', routePage: number) {
  const params = new URLSearchParams();
  params.set('provider', state.provider);
  params.set('mode', state.mode);
  params.set('sort', state.sort);
  if (state.q) params.set('q', state.q);
  if (routePage > 1) params.set('page', String(routePage));
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

function ResultsPagination({ state, page, totalHits, pageSize }: { state: SearchState; page: number; totalHits: number; pageSize: number }) {
  const pageCount = Math.ceil(totalHits / pageSize);
  if (pageCount < 2) return null;
  const currentPage = Math.min(page, pageCount);
  const pageNumbers = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter(value => value >= 1 && value <= pageCount)
    .sort((a, b) => a - b);
  let previousNumber = 0;

  return <nav className="results-pagination" aria-label="Search results pages" data-testid="results-pagination">
    <p className="pagination-summary">Page {currentPage} of {pageCount}</p>
    <div className="pagination-links">
      {currentPage > 1 && <Button variant="outline" size="sm" asChild><Link href={buildSearchUrl(state, currentPage - 1)} prefetch={false} aria-label={`Previous page, page ${currentPage - 1}`}>Previous</Link></Button>}
      {pageNumbers.map(number => {
        const gap = previousNumber > 0 && number - previousNumber > 1;
        previousNumber = number;
        return <span className="pagination-number-wrap" key={number}>
          {gap && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
          {number === currentPage
            ? <span className="pagination-current" aria-current="page" aria-label={`Page ${number}, current page`}>{number}</span>
            : <Button variant="outline" size="sm" asChild><Link href={buildSearchUrl(state, number)} prefetch={false} aria-label={`Page ${number}`}>{number}</Link></Button>}
        </span>;
      })}
      {currentPage < pageCount && <Button variant="outline" size="sm" asChild><Link href={buildSearchUrl(state, currentPage + 1)} prefetch={false} aria-label={`Next page, page ${currentPage + 1}`}>Next</Link></Button>}
    </div>
  </nav>;
}

function Refinements({ filters, onRemove, onClear, ready }: { ready: boolean; filters: SearchFilters; onRemove: (key: string, value?: string | number) => void; onClear: () => void }) {
  const values = Object.entries(filters).flatMap(([key, value]) =>
    Array.isArray(value) ? value.map((item) => ({ key, value: item, label: key === 'bedrooms' ? `${item} beds` : title(String(item)) })) :
      value !== undefined ? [{ key, value, label: key === 'maxPrice' ? `Under ${money(value)}` : key === 'minPrice' ? `Over ${money(value)}` : `${title(key)} ${value}` }] : []
  );
  if (!values.length) return null;
  return <div className="refinements-wrap" aria-label="Applied filters">
    <div className="refinements" data-testid="active-filter-chips">{values.map((item) => <FilterChip key={`${item.key}:${item.value}`} label={item.label} active disabled={!ready} ariaLabel={`Remove ${title(item.key)}: ${item.label}`} onClick={() => onRemove(item.key, item.value)} />)}<Button variant="ghost" size="sm" className="clear-refinements" type="button" disabled={!ready} onClick={onClear}>Clear all</Button></div>
  </div>;
}

type InitialSearch = { request: SearchState; response: SearchResponse | null; error: string | null };

export default function SearchPage({ initial }: { initial?: InitialSearch }) {
  const [request, setRequest] = useState<SearchState>(() => initial?.request ?? emptySearchState());
  const [routePage, setRoutePage] = useState(() => initial?.request.page ?? 1);
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
  const routePageRef = useRef(routePage);
  routePageRef.current = routePage;
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
  const searchController = useRef<ReturnType<typeof createLatestSearch<SearchResponse>> | null>(null);
  const mapController = useRef<ReturnType<typeof createLatestSearch<SearchResponse>> | null>(null);
  const historyMode = useRef<'push' | 'replace'>('replace');
  const appendNext = useRef(false);
  const nextPagePending = useRef(false);
  const paginationSentinel = useRef<HTMLDivElement>(null);
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
    const closePending = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.diagnostics-dialog[data-state="open"]')) setShowDiagnostics(false); };
    document.addEventListener('keydown', closePending);
    return () => document.removeEventListener('keydown', closePending);
  }, [showDiagnostics]);
  useEffect(() => {
    if (!detailId) return;
    const cancelPending = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('.home-details[data-state="open"]')) { event.preventDefault(); closeDetails(); }
    };
    document.addEventListener('keydown', cancelPending);
    return () => document.removeEventListener('keydown', cancelPending);
  }, [detailId, closeDetails]);

  useEffect(() => {
    performance.mark('searchlab-hydrated');
    const urlRequest = readUrlState();
    if (!initial || criteriaKey(initial.request) !== criteriaKey(urlRequest)) setRequest(urlRequest);
    routePageRef.current = urlRequest.page;
    setRoutePage(urlRequest.page);
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
      const sameRoutePage = next.page === routePageRef.current;
      routePageRef.current = next.page;
      setRoutePage(next.page);
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
      if (sameCriteria && sameRoutePage) return;
      historyMode.current = 'replace';
      setLoading(true);
      appendNext.current = false;
      nextPagePending.current = false;
      setLoadMore(false);
      setSelectedId(null);
      setRequest(next);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  useEffect(() => {
    if (!ready || !searchController.current) return;
    syncUrl(request, historyMode.current, routePageRef.current);
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
        nextPagePending.current = false;
        setLoading(false);
        setLoadMore(false);
      },
      onError: (reason) => {
        if (reason instanceof Error && reason.name === 'AbortError') return;
        setError(reason instanceof Error ? reason.message : 'Search failed.');
        appendNext.current = false;
        nextPagePending.current = false;
        if (request.page === 1) { setResponse(null); setHits([]); }
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

  const update = useCallback((change: (current: SearchState) => SearchState, mode: 'push' | 'replace' = 'push') => {
    historyMode.current = mode;
    setLoading(true);
    setLoadMore(false);
    appendNext.current = false;
    nextPagePending.current = false;
    routePageRef.current = 1;
    setRoutePage(1);
    setRequest((current) => ({ ...change(current), page: 1 }));
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
  const openDetailsById = (id: string) => {
    restoreFeedFocus.current = false;
    detailTrigger.current = document.activeElement as HTMLElement;
    rememberFeed();
    setSelectedId(id);
    setDetailId(id);
    writeUiUrl(view, id);
  };
  const openDetails = (hit: SearchHit) => openDetailsById(hit.id);
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

  const loadNextPage = useCallback(() => {
    if (!response || hits.length >= response.totalHits || loading || error || nextPagePending.current) return;
    nextPagePending.current = true;
    appendNext.current = true;
    setLoading(true);
    setLoadMore(true);
    setRequest((current) => ({ ...current, page: response.page + 1 }));
  }, [response, hits.length, loading, error]);

  useEffect(() => {
    const sentinel = paginationSentinel.current;
    if (!ready || !sentinel || !response || view === 'map' || error || loadMore || hits.length >= response.totalHits || !('IntersectionObserver' in window)) return;
    const list = document.querySelector<HTMLElement>('.result-list');
    const root = window.matchMedia('(min-width: 901px)').matches ? list : null;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNextPage();
    }, { root, rootMargin: root ? '650px 0px' : '900px 0px', threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [ready, view, response, error, loadMore, hits.length, loadNextPage]);

  const progressiveReturnTo = buildSearchUrl(request, routePage);
  const summary = response ? response.totalInventory == null ? `${response.totalHits.toLocaleString()} matches` : `${response.totalHits.toLocaleString()} of ${response.totalInventory.toLocaleString()}` : error ? 'Unavailable' : 'Loading results';

  return <main className="searchlab-shell">
    {!ready && <span className="controls-pending" role="status">Preparing filters and map… Search and home links are ready.</span>}
    <section className="search-controls" data-testid="search-toolbar" aria-label="Search settings">
      <SearchQuery ready={ready} request={request} response={response} settled={!loading && !error} focused={searchFocused} onOpen={openFocusedSearch} onCancel={cancelFocusedSearch} onCommit={commitSearch} onDesktopChange={(query) => update((current) => ({ ...current, q: query }), 'replace')} />
      <ServiceSelects provider={request.provider} mode={request.mode} ready={ready} onProvider={provider => update(current => ({ ...current, provider }))} onMode={mode => update(current => ({ ...current, mode }))} />
      <SearchSettingsMenu className="more-settings" provider={request.provider} mode={request.mode} ready={ready} onProvider={provider => update(current => ({ ...current, provider }))} onMode={mode => update(current => ({ ...current, mode }))}>More settings</SearchSettingsMenu>
    </section>

    <section className="mobile-toolbar" aria-label="Search controls">
      <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
        <SheetTrigger asChild><Button ref={drawerTrigger} className="filters-trigger min-h-11" variant="outline" type="button" disabled={!ready}>Filters ({filterCount})</Button></SheetTrigger>
        <SheetContent side="left" showCloseButton={false} className="w-[min(380px,100vw)] overflow-y-auto p-0">
          <SheetHeader className="flex-row items-center justify-end pb-0"><div className="sr-only"><SheetTitle>Refine results</SheetTitle><SheetDescription>Select any options within a group; combine groups to narrow the results.</SheetDescription></div><SheetClose asChild><Button type="button" variant="ghost" className="min-h-11" aria-label="Close filters">Done</Button></SheetClose></SheetHeader>
          <FilterPanel ready={ready} filters={request.filters} facets={facetData} definitions={response?.facetDefinitions} onToggle={toggleFilter} onRange={setRange} onClear={clearFilters} />
        </SheetContent>
      </Sheet>
      <SortSelect className="sort-control min-w-0 flex-1" ready={ready} value={request.sort} onChange={sort => update(current => ({ ...current, sort }))} />
      <div className="view-tabs mobile-views" role="group" aria-label="Results view"><Button size="sm" variant={view === 'map' ? 'default' : 'ghost'} type="button" disabled={!ready} aria-pressed={view === 'map'} onClick={() => changeView('map')}>Map</Button><Button size="sm" variant={view === 'list' ? 'default' : 'ghost'} type="button" disabled={!ready} aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</Button></div>
      <SearchSettingsMenu className="mobile-settings" provider={request.provider} mode={request.mode} ready={ready} onProvider={provider => update(current => ({ ...current, provider }))} onMode={mode => update(current => ({ ...current, mode }))}><span className="sr-only">More settings</span></SearchSettingsMenu>
    </section>

    <div className="page-layout">
      <aside className="desktop-filter-panel" aria-label="Refine results"><FilterPanel ready={ready} filters={request.filters} facets={facetData} definitions={response?.facetDefinitions} onToggle={toggleFilter} onRange={setRange} onClear={clearFilters} /></aside>
      <section className="results-column" aria-label="Search results">
        <header className="results-header">
          <div className="results-heading"><h1 data-testid="results-heading" tabIndex={-1} onBlur={(event) => event.currentTarget.removeAttribute('data-pointer-focus')}>Homes</h1><span className="result-count" data-testid="results-count" role="status" aria-live="polite">{loading && response ? 'Searching…' : summary}</span>{response?.provenance && <button className="request-timing" type="button" disabled={!ready} aria-label={`Show backend details. Last ${response.browserFetchMs !== undefined ? 'browser fetch and parsing' : 'gateway request'} ${response.browserFetchMs ?? response.gatewayTimingMs ?? response.provenance.timing.apiMs} milliseconds`} title="Last completed request; show backend details" onClick={(event) => { diagnosticsTrigger.current = event.currentTarget; setShowDiagnostics(true); }}><svg aria-hidden="true" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="7.5" /><path d="M10 5v5l3 2" /></svg><span>{Math.round(response.browserFetchMs ?? response.gatewayTimingMs ?? response.provenance.timing.apiMs)} ms {response.browserFetchMs !== undefined ? 'fetch' : 'server'}</span></button>}</div>
          <div className="results-actions">
            <div className="view-tabs desktop-views" role="group" aria-label="Results view">{(['split', 'map', 'list'] as const).map(option => <Button key={option} size="sm" variant={view === option ? 'default' : 'ghost'} type="button" disabled={!ready} aria-pressed={view === option} onClick={() => changeView(option)}>{title(option)}</Button>)}</div>
            <SortSelect className="sort-control desktop-sort" ready={ready} value={request.sort} onChange={sort => update(current => ({ ...current, sort }))} />
            <Button type="button" data-testid="save-search" className="save-search" disabled title="Saved-search actions will be migrated in a follow-up slice">Save search</Button>
          </div>
        </header>

        <Refinements ready={ready} filters={request.filters} onRemove={removeFilter} onClear={clearFilters} />
        {error && <div className="search-error" role="alert"><strong>Search unavailable</strong><span>{error}</span><button type="button" disabled={!ready} onClick={() => { if (response && request.page > response.page) { appendNext.current = true; nextPagePending.current = true; setLoading(true); setLoadMore(true); } setError(null); setRequest((current) => ({ ...current, page: response && current.page > response.page ? response.page + 1 : current.page })); }}>Retry</button></div>}
        {response?.debug?.warnings?.map((warning) => <p className="backend-warning" key={warning}>{warning}</p>)}
        {!response && !error && <div className="result-skeletons" aria-label="Loading results" aria-busy="true"><div /><div /><div /></div>}
        {response && hits.length === 0 && !error && <div className="empty-results"><h2>No homes match this search</h2><p>Try fewer filters or a broader search.</p><button type="button" disabled={!ready} onClick={clearFilters}>Clear filters</button></div>}
        {response && hits.length > 0 && <div className={`results-workspace view-${viewLabel.toLowerCase()}`} data-view={view} aria-busy={loading}>
          {<div className="result-list" aria-label="Homes"><div className="result-list-inner">
            {hits.map((hit) => <ResultCard key={hit.id} ready={ready} returnTo={progressiveReturnTo} hit={hit} selected={view !== 'list' && hit.id === selectedId} activeAmenities={Array.isArray(request.filters.amenities) ? request.filters.amenities.map(String) : []} onSelect={() => openDetails(hit)} onMap={() => showOnMap(hit.id)} onAmenity={(value, active) => toggleFilter('amenities', value, active)} />)}
            {hits.length < response.totalHits && <>
              <Button variant="outline" className="load-more" onClick={loadNextPage} disabled={!ready || loading || Boolean(error)}>{loadMore ? 'Loading more homes…' : 'Load more homes'}</Button>
              <div ref={paginationSentinel} className="results-infinite-sentinel" aria-hidden="true" />
            </>}
          </div></div>}
          {view !== 'list' && <section className="map-column" tabIndex={-1} aria-label="Map of matching homes">
            {!mapResponse && !mapError && <div className="map-loading" role="status">Loading map results…</div>}
            {mapResponse && <MapPanel hits={markers} selectedId={selectedId} onSelect={setSelectedId} onActivate={openDetailsById} feedback={mapFeedback} />}
            {mapError && !mapResponse && <div className="map-unavailable" role="alert"><div><span>Map data is unavailable. The list and filters are still ready.</span><button className="map-retry" type="button" onClick={(event) => { event.currentTarget.closest<HTMLElement>('.map-column')?.focus({ preventScroll: true }); retryMap(); }}>Retry map</button></div></div>}
            {activeHit && <aside className="map-preview" aria-live="polite"><button type="button" aria-label="Close selected home" onClick={() => setSelectedId(null)}>×</button><strong>{money(activeHit.price)}</strong><h2>{activeHit.title}</h2><p>{activeHit.city}{activeHit.neighborhood ? ` · ${activeHit.neighborhood}` : ''}</p>{activeListHit && <span>{activeListHit.bedrooms} bd · {activeListHit.bathrooms} ba · {activeListHit.squareFeet.toLocaleString()} sqft</span>}</aside>}
          </section>}
        </div>}
        {response && <p className="result-footnote">{hits.length < response.totalHits ? `Showing ${hits.length} of ${response.totalHits.toLocaleString()} matches` : `Showing all ${response.totalHits.toLocaleString()} matches`}{response.totalInventory == null ? ' · total inventory unavailable' : ` · ${response.totalInventory.toLocaleString()} homes in inventory`}</p>}
        {response && <ResultsPagination state={request} page={routePage} totalHits={response.totalHits} pageSize={response.pageSize} />}
      </section>
    </div>
    {detailId && <DetailsDialog id={detailId} hit={hits.find((hit) => hit.id === detailId) ?? null} onClose={closeDetails} onMap={() => showOnMap(detailId)} returnFocus={detailTrigger.current} />}
    {showDiagnostics && response && <DiagnosticsDialog response={response} onClose={() => setShowDiagnostics(false)} returnFocus={diagnosticsTrigger.current} />}
  </main>;
}
