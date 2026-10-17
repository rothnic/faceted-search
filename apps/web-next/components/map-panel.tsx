'use client';

import 'leaflet/dist/leaflet.css';
import './map-panel.css';
import { useEffect, useRef } from 'react';
import type { SearchResponse } from '@/lib/search';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format;

type MapHit = SearchResponse['mapHits'][number];

export default function MapPanel({ hits, selectedId, onSelect }: { hits: MapHit[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layersRef = useRef<import('leaflet').LayerGroup | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const markersRef = useRef(new Map<string, import('leaflet').CircleMarker>());
  const selectRef = useRef(onSelect);

  useEffect(() => {
    selectedRef.current = selectedId;
    for (const [id, marker] of markersRef.current) {
      marker.setRadius(id === selectedId ? 8 : 6);
      marker.getElement()?.setAttribute('aria-pressed', String(id === selectedId));
    }
  }, [selectedId]);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    let disposed = false;
    let map: import('leaflet').Map | null = null;
    let resize: ResizeObserver | null = null;
    void import('leaflet').then((leaflet) => {
      if (disposed || !container.current) return;
      map = leaflet.map(container.current, { zoomControl: false, attributionControl: true, zoomAnimation: false, fadeAnimation: false }).setView([34.7304, -86.5861], 10);
      leaflet.control.zoom({ position: 'topright' }).addTo(map);
      leaflet.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      const layer = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
      layersRef.current = layer;
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
        }).addTo(layer).bindTooltip(tooltip).on('click', () => selectRef.current(hit.id));
        const element = marker.getElement();
        if (element) {
          element.setAttribute('tabindex', '0');
          element.setAttribute('role', 'button');
          element.setAttribute('aria-label', `Select home: ${hit.title}, ${hit.city}, ${money(hit.price)}`);
          element.setAttribute('aria-pressed', String(hit.id === selectedRef.current));
          element.addEventListener('keydown', (event) => {
            if (!(event instanceof KeyboardEvent)) return;
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
  }, [hits]);

  return <div ref={container} data-testid="map-container" className="map-canvas" aria-label={`Map showing ${hits.length} matching listing locations`} role="group" />;
}
