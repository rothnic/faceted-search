'use client';

import { useEffect, useRef, useState } from 'react';
import './details-dialog.css';
import type { SearchHit } from '@/lib/search';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;
const label = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

export default function DetailsDialog({ hit: loadedHit, id, onClose, onMap, returnFocus }: {
  hit: SearchHit | null;
  id: string;
  onClose: () => void;
  onMap: () => void;
  returnFocus: HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fetchedHit, setFetchedHit] = useState<SearchHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const hit = loadedHit ?? fetchedHit;
  useEffect(() => {
    if (loadedHit) return;
    const controller = new AbortController();
    setError(null);
    setFetchedHit(null);
    void fetch(`/api/houses/${encodeURIComponent(id)}`, { signal: controller.signal }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Home details are unavailable.');
      if (!controller.signal.aborted) setFetchedHit(body.house);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Home details are unavailable.');
    });
    return () => controller.abort();
  }, [id, loadedHit, retry]);
  useEffect(() => {
    const element = dialog.current!;
    const y = window.scrollY;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const list = document.querySelector('.result-list');
    const listY = list?.scrollTop ?? 0;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>('[data-testid=search-input]');
      const map = document.querySelector<HTMLElement>('.results-workspace[data-view="map"] .map-column');
      if (map) { map.focus({ preventScroll: true }); return; }
      target?.focus({ preventScroll: true });
      if (viewport.width !== window.innerWidth || viewport.height !== window.innerHeight) {
        // Re-anchor the same card when the feed changes between page and nested scrolling.
        target?.scrollIntoView({ block: 'center', inline: 'nearest' });
      } else {
        list?.scrollTo(0, listY);
        window.scrollTo(0, y);
      }
    };
  }, [returnFocus]);

  return <dialog ref={dialog} className="home-details" aria-labelledby="home-details-title" onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="detail-header"><h2 id="home-details-title">Home details</h2><button type="button" autoFocus className="detail-close" onClick={onClose} aria-label="Close home details">Back to results <span aria-hidden="true">×</span></button></header>
    <div className="detail-content">
      {hit ? <>
        <p className="detail-price">{money(hit.price)} <span className="status-badge">{label(hit.listingStatus)}</span></p>
        <h3>{hit.title}</h3>
        <p className="detail-location">{hit.city}{hit.neighborhood ? ` · ${hit.neighborhood}` : ''}</p>
        <dl className="detail-facts"><div><dt>Bedrooms</dt><dd>{hit.bedrooms}</dd></div><div><dt>Bathrooms</dt><dd>{hit.bathrooms}</dd></div><div><dt>Living area</dt><dd>{hit.squareFeet.toLocaleString()} sqft</dd></div><div><dt>Home type</dt><dd>{label(hit.propertyType)}</dd></div></dl>
        <h4>About this home</h4><p className="detail-description">{hit.description}</p>
        {hit.amenities.length > 0 && <><h4>Features</h4><ul className="detail-features">{hit.amenities.map((amenity) => <li key={amenity}>{label(amenity)}</li>)}</ul></>}
        <button type="button" className="detail-map" onClick={onMap}>Show on map</button>
      </> : <div role={error ? 'alert' : 'status'}><p>{error ?? 'Loading home…'}</p>{error && <button type="button" className="detail-map" onClick={() => setRetry((value) => value + 1)}>Retry details</button>}</div>}
    </div>
  </dialog>;
}
