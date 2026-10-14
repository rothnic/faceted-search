import { escapeHtml, propertyTypeStyle, state } from '../core.js';

export function renderResultMap() {
  const hitsForMap = state.response?.mapHits || [];
  const mobile = window.matchMedia('(max-width:760px)').matches;
  const mapVisible = mobile ? state.mobileResultsView === 'map' : state.desktopResultsView !== 'list';
  if (!hitsForMap.length && !mapVisible) return '';
  const legendTypes = [...new Set(hitsForMap.map((hit) => hit.propertyType))];
  const waitingForMarkers = state.response?.mapDataIncluded !== true;
  const noMappedListings = !hitsForMap.length && !waitingForMarkers;
  return `
    <section class="result-map" aria-label="Map of visible results">
      <details class="map-key"${waitingForMarkers ? ' hidden' : ''}><summary>Map key</summary><div class="map-legend" aria-label="Map marker legend">${legendTypes.map((type) => { const style = propertyTypeStyle(type); return `<span><i style="background:${style.color}"></i>${escapeHtml(style.label)}</span>`; }).join('')}</div></details>
      <div id="result-map" data-map-state="${waitingForMarkers ? 'loading' : noMappedListings ? 'empty' : 'loading'}" class="leaflet-result-map${waitingForMarkers || noMappedListings ? ' map-placeholder' : ''}" role="${waitingForMarkers || noMappedListings ? 'status' : 'region'}" aria-label="${waitingForMarkers ? 'Loading map data' : 'Interactive map of matching search results'}">${waitingForMarkers ? 'Loading map data\u2026' : noMappedListings ? 'No mapped listings match this search.' : ''}</div>
      <p class="map-feedback" role="status" data-state="loading">${waitingForMarkers ? 'Loading matching properties…' : 'Loading map tiles…'}</p>
    </section>
  `;
}
