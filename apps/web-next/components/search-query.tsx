'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { buildSearchRequest, createLatestSearch, postSearch, type SearchResponse, type SearchState } from '@/lib/search';

export type PlaceSuggestion = { field: 'city' | 'neighborhood'; value: string; count: number };

export default function SearchQuery({ request, response, settled, focused, ready, onOpen, onCancel, onCommit, onDesktopChange }: {
  request: SearchState;
  response: SearchResponse | null;
  settled: boolean;
  focused: boolean;
  ready: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onCommit: (query: string, place?: PlaceSuggestion) => void;
  onDesktopChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState(request.q);
  const [composing, setComposing] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const entry = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<ReturnType<typeof createLatestSearch<SearchResponse>> | null>(null);
  const listId = useId();
  if (!controller.current) controller.current = createLatestSearch(postSearch, 180);

  const adoptedInput = useRef(false);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    if (!adoptedInput.current) {
      adoptedInput.current = true;
      if (node.value !== request.q || document.activeElement === node) {
        setDraft(node.value);
        if (window.matchMedia('(max-width: 900px)').matches) onOpen();
        else if (node.value !== request.q) onDesktopChange(node.value);
        return;
      }
    }
    if (!focused && !composing && node.value !== request.q) node.value = request.q;
  }, [focused, composing, request.q]);
  useEffect(() => {
    if (!focused || composing) { controller.current?.cancel(); return; }
    setActive(-1);
    setFailed(false);
    if (draft === request.q && settled && response) {
      controller.current?.cancel(); setSuggestions(response); setPending(false); return;
    }
    setSuggestions(null); setPending(true);
    return controller.current!.schedule(buildSearchRequest({ ...request, q: draft, page: 1 }), {
      onSuccess: (next) => { setSuggestions(next); setPending(false); },
      onError: () => { setSuggestions(null); setPending(false); setFailed(true); }
    });
  }, [focused, composing, draft, request, response, settled]);

  useEffect(() => {
    if (!focused) return;
    const node = entry.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = [...document.querySelectorAll<HTMLElement>('.global-header, .mobile-toolbar, .page-layout, .search-controls > .desktop-setting, .search-controls > .more-settings')];
    const inert = background.map((element) => element.inert);
    background.forEach((element) => { element.inert = true; });
    const viewport = window.visualViewport;
    const size = () => {
      node.style.setProperty('--query-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      node.style.setProperty('--query-viewport-top', `${viewport?.offsetTop ?? 0}px`);
      node.style.setProperty('--query-viewport-left', `${viewport?.offsetLeft ?? 0}px`);
      node.style.setProperty('--query-viewport-width', `${viewport?.width ?? window.innerWidth}px`);
    };
    size(); viewport?.addEventListener('resize', size); viewport?.addEventListener('scroll', size); window.addEventListener('resize', size);
    input.current?.focus({ preventScroll: true });
    return () => {
      viewport?.removeEventListener('resize', size); viewport?.removeEventListener('scroll', size); window.removeEventListener('resize', size);
      document.body.style.overflow = overflow;
      background.forEach((element, index) => { element.inert = inert[index]; });
      input.current?.blur();
    };
  }, [focused]);

  const value = focused || composing ? draft : request.q;
  const needle = draft.trim().toLocaleLowerCase();
  const places: PlaceSuggestion[] = suggestions ? (['city', 'neighborhood'] as const).flatMap((field) =>
    (suggestions.facets[field] ?? []).filter((bucket) => !needle || bucket.value.toLocaleLowerCase().includes(needle)).map((bucket) => ({ field, ...bucket }))
  ).slice(0, 6) : [];
  const expanded = focused && !dismissed;
  const commit = (place?: PlaceSuggestion) => { input.current?.blur(); onCommit(input.current?.value ?? draft, place); };
  const cancel = () => { input.current?.blur(); onCancel(); };

  return <div ref={entry} className="query-entry" data-focused={focused} role={focused ? 'dialog' : undefined} aria-modal={focused ? true : undefined} aria-label={focused ? 'Search homes' : undefined} onKeyDown={(event) => {
    if (!focused || composing || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (expanded) { setDismissed(true); setActive(-1); } else cancel();
    }
    if (event.key === 'Tab') {
      const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"]):not(:disabled)')].filter((element) => element.getClientRects().length > 0);
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  }}>
    <form className="query-form" action="/search" method="get" onSubmit={(event) => { if (!ready) return; event.preventDefault(); if (!composing) commit(); }}>
      <input type="hidden" name="provider" value={request.provider} />
      <input type="hidden" name="mode" value={request.mode} />
      <input type="hidden" name="sort" value={request.sort} />
      {Object.entries(request.filters).flatMap(([key, value]) => value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(item => <input key={`${key}:${item}`} type="hidden" name={key} value={String(item)} />))}
      {request.savedSearchIds.map(id => <input key={id} type="hidden" name="savedSearchId" value={id} />)}
      <div className="query-topline">
        <label className="query-control"><span className="sr-only">Search listings</span><span aria-hidden="true" className="search-glyph">⌕</span>
          <input ref={input} type="search" name="q" data-testid="search-input" aria-label="Search listings" defaultValue={request.q} placeholder="Search homes, places, features…" autoComplete="off" enterKeyHint="search"
            role={focused ? 'combobox' : undefined} aria-autocomplete={focused ? 'list' : undefined} aria-expanded={focused ? expanded : undefined} aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && active >= 0 && places[active] ? `${listId}-${active}` : undefined}
            onFocus={() => { if (window.matchMedia('(max-width: 900px)').matches && !focused) { setDraft(input.current?.value ?? request.q); setDismissed(false); onOpen(); } }}
            onChange={(event) => { if (window.matchMedia('(min-width: 901px)').matches && !composing && !(event.nativeEvent as InputEvent).isComposing) onDesktopChange(event.target.value); else { setDraft(event.target.value); setDismissed(false); setActive(-1); } }}
            onCompositionStart={() => { setDraft(input.current?.value ?? request.q); setComposing(true); }} onCompositionEnd={(event) => { setDraft(event.currentTarget.value); setComposing(false); if (window.matchMedia('(min-width: 901px)').matches) onDesktopChange(event.currentTarget.value); }}
            onKeyDown={(event) => {
              if (!focused || composing || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                if (!places.length) return;
                event.preventDefault(); setDismissed(false);
                setActive((current) => event.key === 'ArrowDown' ? (current + 1) % places.length : (current <= 0 ? places.length - 1 : current - 1));
              } else if (event.key === 'Enter' && expanded && active >= 0 && places[active]) { event.preventDefault(); commit(places[active]); }
            }} />
          <button type="button" className="clear-query" aria-label="Clear search query" disabled={!ready} hidden={!value} onClick={() => { if (input.current) input.current.value = ''; if (focused) { setDraft(''); setDismissed(false); input.current?.focus(); } else onDesktopChange(''); }}>×</button>
        </label>
        {!focused && <button className="query-native-submit" type="submit" aria-label="Search" title="Search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg></button>}
        {focused && <button className="query-cancel" type="button" onClick={cancel}>Cancel</button>}
      </div>
      {focused && <div className="query-feedback">
        <p role="status" aria-live="polite">{composing ? 'Finish typing to see suggestions.' : pending ? 'Finding places…' : failed ? 'Suggestions unavailable. You can still search.' : suggestions ? `${suggestions.totalHits.toLocaleString()} matching homes` : 'Search homes and places'}</p>
        <button className="query-submit" type="submit">Search</button>
      </div>}
    </form>
    {expanded && <section className="query-suggestions" aria-label="Place suggestions">
      {places.length > 0 && <h2>{needle ? 'Matching places' : 'Browse places'}</h2>}
      <div id={listId} role="listbox" aria-label="Places from current search results">
        {places.map((place, index) => <button key={`${place.field}:${place.value}`} id={`${listId}-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="place-option" onMouseDown={(event) => event.preventDefault()} onClick={() => commit(place)}>
          <span>{place.value}<small>{place.field === 'city' ? 'City' : 'Neighborhood'}</small></span><span className="place-count">{place.count.toLocaleString()}</span>
        </button>)}
      </div>
      {!pending && !composing && !failed && places.length === 0 && <p className="query-hint">Search the full text for homes, features or an address.</p>}
    </section>}
  </div>;
}
