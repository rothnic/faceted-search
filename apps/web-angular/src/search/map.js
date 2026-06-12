import L from 'leaflet';
import {
  currency,
  escapeHtml,
  propertyTypeStyle,
  state
} from '../core.js';

export function renderResultMap() {
  const hitsForMap = state.response?.mapHits || [];
  if (!hitsForMap.length) return '';
  const legendTypes = [...new Set(hitsForMap.map((hit) => hit.propertyType))];
  return `
    <section class="result-map" aria-label="Map of visible results">
      <div class="map-head">
        <div>
          <strong>Map</strong>
          <span class="stats">${hitsForMap.length} matching listings</span>
        </div>
        <div class="map-legend" aria-label="Map marker legend">
          ${legendTypes.map((type) => {
            const style = propertyTypeStyle(type);
            return `<span><i style="background:${style.color}"></i>${escapeHtml(style.label)}</span>`;
          }).join('')}
        </div>
      </div>
      <div id="result-map" class="leaflet-result-map" role="img" aria-label="Interactive map of matching search results"></div>
    </section>
  `;
}

export function renderLeafletMap() {
  const mapElement = document.querySelector('#result-map');
  if (state.resultMap) {
    state.resultMap.remove();
    state.resultMap = null;
  }
  if (!mapElement || !state.response?.mapHits?.length) return;

  const map = L.map(mapElement, {
    scrollWheelZoom: false,
    zoomControl: true
  });
  state.resultMap = map;

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

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
