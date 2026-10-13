import L from 'leaflet';
import {
  currency,
  escapeHtml,
  propertyTypeStyle,
  state
} from '../core.js';

let readinessTimer;

export function renderResultMap() {
  const hitsForMap = state.response?.mapHits || [];
  if (!hitsForMap.length) return '';
  const legendTypes = [...new Set(hitsForMap.map((hit) => hit.propertyType))];
  return `
    <section class="result-map" aria-label="Map of visible results">
      <details class="map-key"><summary>Map key</summary><div class="map-legend" aria-label="Map marker legend">${legendTypes.map((type) => { const style = propertyTypeStyle(type); return `<span><i style="background:${style.color}"></i>${escapeHtml(style.label)}</span>`; }).join('')}</div></details>
      <div id="result-map" data-map-state="loading" class="leaflet-result-map" role="img" aria-label="Interactive map of matching search results"></div>
      <p class="map-feedback" role="status" data-state="loading">Loading map tiles…</p>
    </section>
  `;
}

export function renderLeafletMap() {
  clearTimeout(readinessTimer);
  const mapElement = document.querySelector('#result-map');
  if (state.resultMap) {
    state.resultMap.remove();
    state.resultMap = null;
  }
  if (!mapElement || !state.response?.mapHits?.length || !mapElement.getClientRects().length) return;

  const map = L.map(mapElement, {
    scrollWheelZoom: false,
    fadeAnimation: false,
    zoomControl: true
  });
  state.resultMap = map;

  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  const feedback = mapElement.parentElement.querySelector('.map-feedback');
  const updateReadiness = (timedOut = false) => {
    if (state.resultMap !== map) return;
    const images = [...mapElement.querySelectorAll('.leaflet-tile-container img')];
    const loaded = images.filter((tile) => tile.complete && tile.naturalWidth > 0).length;
    const failed = images.filter((tile) => tile.dataset.failed === 'true').length;
    const ready = images.length > 0 && loaded === images.length && !tiles.isLoading();
    const status = ready ? 'ready' : failed || timedOut ? 'error' : 'loading';
    mapElement.dataset.mapState = status;
    mapElement.dataset.tilesLoaded = String(loaded);
    mapElement.dataset.tilesTotal = String(images.length);
    mapElement.dataset.tilesFailed = String(failed);
    feedback.dataset.state = status;
    feedback.textContent = ready ? 'OpenStreetMap · Live map tiles loaded' : status === 'error'
      ? `Map tiles unavailable (${loaded}/${images.length} loaded). Listing markers remain available. Check your connection or try refreshing.`
      : 'Loading map tiles…';
    if (ready) clearTimeout(readinessTimer);
  };
  tiles.on('loading', () => {
    clearTimeout(readinessTimer);
    readinessTimer = setTimeout(() => updateReadiness(true), 15000);
    updateReadiness();
  });
  tiles.on('tileerror', (event) => { event.tile.dataset.failed = 'true'; updateReadiness(); });
  tiles.on('tileload load', () => updateReadiness());
  tiles.addTo(map);

  const bounds = [];
  for (const hit of state.response.mapHits) {
    const point = [hit.lat, hit.lng];
    const style = propertyTypeStyle(hit.propertyType);
    bounds.push(point);
    L.circleMarker(point, {
      radius: 4.75,
      color: '#ffffff',
      weight: 1.5,
      fillColor: style.color,
      fillOpacity: 0.88
    })
      .on('popupopen', (event) => event.target.setStyle({radius:7,weight:3,color:'#ffffff',fillOpacity:1}))
      .on('popupclose', (event) => event.target.setStyle({radius:4.75,weight:1.5,color:'#ffffff',fillOpacity:.88}))
      .bindPopup(`
        <strong>${escapeHtml(hit.title)}</strong><br />
        ${currency(hit.price)} · ${escapeHtml(style.label)}<br />
        ${escapeHtml(hit.city)}${hit.neighborhood ? `, ${escapeHtml(hit.neighborhood)}` : ''}
      `)
      .addTo(map);
  }

  if (bounds.length === 1) map.setView(bounds[0], 13);
  else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
}

// View changes resize the existing map; they never change the search or viewport.
export function resizeVisibleMap() {
  const element = document.querySelector('#result-map');
  if (!element?.getClientRects().length) return;
  if (!state.resultMap) renderLeafletMap();
  else state.resultMap.invalidateSize({pan:false});
}
