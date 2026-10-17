'use client';

import 'leaflet/dist/leaflet.css';
import './map-panel.css';
import { useEffect, useRef, useState } from 'react';
import type { SearchResponse } from '@/lib/search';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;

type MapHit = SearchResponse['mapHits'][number];
type MapProps = { hits: MapHit[]; selectedId: string | null; onSelect: (id: string) => void };

function MapCanvas({ hits, selectedId, onSelect, interactive }: MapProps & { interactive: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layersRef = useRef<import('leaflet').LayerGroup | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const markersRef = useRef(new Map<string, import('leaflet').CircleMarker>());
  const selectRef = useRef(onSelect);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  useEffect(() => {
    selectedRef.current = selectedId;
    for (const [id, marker] of markersRef.current) {
      marker.setRadius(id === selectedId ? 8 : 6);
      marker.getElement()?.setAttribute('aria-pressed', String(id === selectedId));
    }
  }, [selectedId]);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const handler of [map.dragging, map.scrollWheelZoom, map.touchZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
      if (interactive) handler.enable(); else handler.disable();
    }
    container.current?.querySelectorAll<HTMLElement>('.leaflet-control a').forEach((control) => { control.tabIndex = interactive ? 0 : -1; });
  }, [interactive]);

  useEffect(() => {
    let disposed = false;
    let map: import('leaflet').Map | null = null;
    let resize: ResizeObserver | null = null;
    void import('leaflet').then((leaflet) => {
      if (disposed || !container.current) return;
      const enabled = interactiveRef.current;
      map = leaflet.map(container.current, {
        zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false,
        dragging: enabled, scrollWheelZoom: enabled, touchZoom: enabled,
        doubleClickZoom: enabled, boxZoom: enabled, keyboard: enabled
      }).setView([34.7304, -86.5861], 10);
      leaflet.control.zoom({ position: 'topright' }).addTo(map);
      leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      const layer = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      layersRef.current = layer;
      container.current.querySelectorAll<HTMLElement>('.leaflet-control a').forEach((control) => { control.tabIndex = enabled ? 0 : -1; });
      resize = new ResizeObserver(() => { if (!disposed) map?.invalidateSize({ pan: false, animate: false }); });
      resize.observe(container.current);
    });
    return () => {
      disposed = true;
      resize?.disconnect();
      map?.stop();
      map?.remove();
      map = null;
      markersRef.current.clear();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((leaflet) => {
      if (cancelled || !mapRef.current || !layersRef.current) return;
      const layer = layersRef.current;
      layer.clearLayers();
      markersRef.current.clear();
      const positions: Array<[number, number]> = [];
      for (const hit of hits) {
        if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng)) continue;
        const point: [number, number] = [hit.lat, hit.lng];
        positions.push(point);
        const tooltip = document.createElement('span');
        tooltip.textContent = `${hit.title} · ${money(hit.price)}`;
        const marker = leaflet.circleMarker(point, {
          radius: hit.id === selectedRef.current ? 8 : 6,
          color: '#ffffff',
          weight: 2,
          fillColor: '#087c6c',
          fillOpacity: 1
        }).addTo(layer).bindTooltip(tooltip).on('click', () => { if (interactiveRef.current) selectRef.current(hit.id); });
        const element = marker.getElement();
        if (element) {
          element.setAttribute('tabindex', interactive ? '0' : '-1');
          element.setAttribute('role', 'button');
          element.setAttribute('aria-label', `Select home: ${hit.title}, ${hit.city}, ${money(hit.price)}`);
          element.setAttribute('aria-pressed', String(hit.id === selectedRef.current));
          element.setAttribute('aria-disabled', String(!interactive));
          element.addEventListener('keydown', (event) => {
            if (!(event instanceof KeyboardEvent) || !interactiveRef.current) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); event.stopPropagation(); selectRef.current(hit.id);
            }
          });
        }
        markersRef.current.set(hit.id, marker);
      }
      if (positions.length) {
        mapRef.current.fitBounds(leaflet.latLngBounds(positions), { padding: [24, 24], maxZoom: 12, animate: false });
      }
    });
    return () => { cancelled = true; };
  }, [hits, interactive]);

  return <div ref={container} data-testid="map-container" className="map-canvas" tabIndex={interactive ? 0 : -1} aria-label={`Map showing ${hits.length} matching listing locations`} role={interactive ? 'group' : 'img'} />;
}

function ExpandIcon({ collapse = false }: { collapse?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={collapse ? 'M4 9h5V4m11 5h-5V4M4 15h5v5m11-5h-5v5' : 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5'} />
  </svg>;
}

function ExpandedMap({ hits, selectedId, onSelect, onClose, trigger }: MapProps & { onClose: () => void; trigger: HTMLButtonElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const selected = hits.find((hit) => hit.id === selectedId);
  useEffect(() => {
    const element = dialog.current!;
    const windowY = window.scrollY;
    const list = document.querySelector('.result-list');
    const listY = list?.scrollTop ?? 0;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      // View changes own their feed restoration; do not overwrite it on unmount.
      if (!trigger?.isConnected) return;
      const target = trigger.getClientRects().length ? trigger : trigger.closest<HTMLElement>('.map-column');
      target?.focus({ preventScroll: true });
      list?.scrollTo(0, listY);
      window.scrollTo(0, windowY);
    };
  }, [trigger]);
  return <dialog ref={dialog} className="expanded-map" aria-label="Expanded map" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className="expanded-map-header"><h2>Map</h2><button type="button" autoFocus className="map-icon-button" aria-label="Close expanded map" title="Close expanded map" onClick={onClose}><ExpandIcon collapse /></button></header>
    <div className="expanded-map-stage">
      <MapCanvas hits={hits} selectedId={selectedId} onSelect={onSelect} interactive />
      {selected && <aside className="expanded-map-selection" role="status"><strong>{money(selected.price)}</strong><span>{selected.title}</span><small>{selected.city}</small></aside>}
    </div>
  </dialog>;
}

export default function MapPanel(props: MapProps) {
  const [mobile, setMobile] = useState(() => typeof window === 'undefined' || window.matchMedia('(max-width: 900px)').matches);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => { setMobile(media.matches); if (!media.matches) setExpanded(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <div className={`map-panel${mobile ? ' embedded-map-static' : ''}`}>
    <MapCanvas {...props} interactive={!mobile} />
    <button ref={trigger} type="button" className="map-icon-button map-expand" aria-label="Expand map" title="Expand map" aria-haspopup="dialog" aria-expanded={expanded} onClick={() => setExpanded(true)}><ExpandIcon /></button>
    {mobile && expanded && <ExpandedMap {...props} trigger={trigger.current} onClose={() => setExpanded(false)} />}
  </div>;
}
