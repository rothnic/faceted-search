import L from 'leaflet';
import {
  currency,
  escapeHtml,
  propertyTypeStyle,
  state
} from '../core.js';

let readinessTimer;
let markerLayer;
let activeMarker;


export function renderLeafletMap() {
  clearTimeout(readinessTimer);
  const mapElement = document.querySelector('#result-map');
  if (!mapElement || !state.response?.mapHits?.length || !mapElement.getClientRects().length) return;
  const existingMap = state.resultMap?.getContainer() === mapElement;
  if (state.resultMap && !existingMap) {
    state.resultMap.remove();
    state.resultMap = null;
    markerLayer = null;
    activeMarker = null;
  }
  const selectedHouseId = state.selectedMapHouseId;
  const legend = mapElement.parentElement.querySelector('.map-legend');
  if (legend) {
    const types = [...new Set(state.response.mapHits.map((hit) => hit.propertyType))];
    legend.innerHTML = types.map((type) => {
      const style = propertyTypeStyle(type);
      return '<span><i style="background:' + style.color + '"></i>' + escapeHtml(style.label) + '</span>';
    }).join('');
  }
  const map = existingMap ? state.resultMap : L.map(mapElement, {
    scrollWheelZoom: false,
    fadeAnimation: false,
    zoomControl: true
  });
  const previewWidth = () => Math.max(160, Math.min(280, map.getSize().x - 34));
  if (!existingMap) {
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

  const resizePreview = (popup) => {
    const width = previewWidth();
    if (popup.options.maxWidth === width) return;
    const content = popup.getElement()?.querySelector('.map-listing-preview');
    const focused = content?.contains(document.activeElement) ? document.activeElement : null;
    L.setOptions(popup, {maxWidth:width,minWidth:Math.min(220,width)});
    // Keep the existing controls/listeners when Leaflet recalculates its content box.
    popup.setContent(content || popup.getContent());
    focused?.focus({preventScroll:true});
  };
  map.on('resize', () => { if (activeMarker?.isPopupOpen()) resizePreview(activeMarker.getPopup()); });
  map.on('popupclose', (event) => {
    const marker = activeMarker;
    if (!marker || event.popup !== marker.getPopup()) return;
    activeMarker = null;
    state.selectedMapHouseId = null;
    const sheet = mapElement.parentElement.querySelector('.mobile-map-preview');
    if (sheet) { sheet.hidden = true; sheet.replaceChildren(); }
    marker.setStyle({radius:4.75,weight:1.5,fillOpacity:.88});
    marker.getElement()?.setAttribute('aria-expanded','false');
  });
  const dismissOutside = (event) => {
    const sheet = mapElement.parentElement.querySelector('.mobile-map-preview');
    if (sheet && !sheet.hidden && sheet.contains(event.target)) return;
    if (activeMarker && !activeMarker.getPopup()?.getElement()?.contains(event.target) && event.target !== activeMarker.getElement()) {
      map.closePopup();
      if (mobile()) dismissMobilePreview(false);
    }
  };
  document.addEventListener('pointerdown', dismissOutside);
  map.on('unload', () => document.removeEventListener('pointerdown', dismissOutside));
  mapElement.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const marker = activeMarker;
      map.closePopup();
      dismissMobilePreview(false);
      marker?.getElement()?.focus();
      map.eachLayer((layer) => layer.closeTooltip?.());
      event.preventDefault(); event.stopPropagation();
    }
  });
  markerLayer = L.layerGroup().addTo(map);
  }
  activeMarker = null;
  if (markerLayer) markerLayer.clearLayers();
  else markerLayer = L.layerGroup().addTo(map);
  const bounds = [];
  let restoredMarker;
  const mobile = () => window.matchMedia('(max-width:760px)').matches;
  const ensureMobilePreview = () => {
    let sheet = mapElement.parentElement.querySelector('.mobile-map-preview');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'mobile-map-preview';
      sheet.hidden = true;
      mapElement.append(sheet);
      sheet.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        dismissMobilePreview(true);
        event.preventDefault();
        event.stopPropagation();
      });
    }
    return sheet;
  };
  const dismissMobilePreview = (restoreFocus = true) => {
    const sheet = mapElement.parentElement.querySelector('.mobile-map-preview');
    if (sheet) { sheet.hidden = true; sheet.replaceChildren(); }
    const marker = activeMarker;
    activeMarker = null;
    state.selectedMapHouseId = null;
    if (marker) {
      marker.setStyle({radius:4.75,weight:1.5,fillOpacity:.88});
      marker.getElement()?.setAttribute('aria-expanded','false');
      if (restoreFocus) marker.getElement()?.focus();
    }
  };
  const showMobilePreview = (hit, marker, focusClose = false) => {
    map.closePopup();
    if (activeMarker && activeMarker !== marker) {
      activeMarker.setStyle({radius:4.75,weight:1.5,fillOpacity:.88});
      activeMarker.getElement()?.setAttribute('aria-expanded','false');
    }
    const sheet = ensureMobilePreview();
    const style = propertyTypeStyle(hit.propertyType);
    sheet.innerHTML = '<article class="card map-listing-preview" role="dialog" aria-label="Listing preview: ' + escapeHtml(hit.title) + '">' +
      '<div class="card-body"><div class="preview-copy"><strong class="preview-price">' + currency(hit.price) + '</strong><h3>' + escapeHtml(hit.title) + '</h3><p>' + escapeHtml(hit.city) + ' · ' + escapeHtml(style.label) + '</p></div>' +
      '<button type="button" class="btn btn-ghost preview-close" aria-label="Close listing preview">×</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-open-hit="' + escapeHtml(hit.id) + '">Details</button></div></article>';
    sheet.hidden = false;
    sheet.querySelector('.preview-close').onclick = () => dismissMobilePreview(true);
    activeMarker = marker;
    state.selectedMapHouseId = hit.id;
    marker.closeTooltip();
    marker.setStyle({radius:7,weight:3,fillOpacity:1});
    marker.getElement()?.setAttribute('aria-expanded','true');
    if (focusClose) sheet.querySelector('.preview-close').focus();
  };
  for (const hit of state.response.mapHits) {
    const point = [hit.lat, hit.lng];
    const style = propertyTypeStyle(hit.propertyType);
    bounds.push(point);
    const marker = L.circleMarker(point, {
      radius: 4.75,
      color: '#ffffff',
      weight: 1.5,
      fillColor: style.color,
      fillOpacity: 0.88
    })
      .bindTooltip(`<div class="tooltip-content"><strong>${currency(hit.price)}</strong><br>${escapeHtml(hit.title)}</div>`, {
        direction:'auto', offset:[8,0], opacity:1, className:'tooltip tooltip-open tooltip-primary map-hover-tooltip'
      })
      .bindPopup(`<article class="card map-listing-preview" role="dialog" aria-label="Listing preview: ${escapeHtml(hit.title)}">
        <div class="card-body"><button type="button" class="btn btn-ghost preview-close" aria-label="Close listing preview">×</button>
        <strong class="preview-price">${currency(hit.price)}</strong><h3>${escapeHtml(hit.title)}</h3>
        <p>${escapeHtml(hit.city)} · ${escapeHtml(style.label)}</p>
        <button type="button" class="btn btn-primary btn-sm" data-open-hit="${escapeHtml(hit.id)}">Details</button></div>
      </article>`, {closeButton:false, maxWidth:previewWidth(), minWidth:Math.min(220,previewWidth()), autoPanPadding:[16,16]});
    const openDesktopPreview = (focusClose = false) => {
      marker.openPopup();
      const closeButton = marker.getPopup().getElement()?.querySelector('.preview-close');
      if (closeButton) closeButton.onclick = () => { map.closePopup(); marker.getElement()?.focus(); };
      activeMarker = marker;
      state.selectedMapHouseId = hit.id;
      marker.closeTooltip();
      marker.setStyle({radius:7,weight:3,fillOpacity:1});
      marker.getElement()?.setAttribute('aria-expanded','true');
      if (focusClose) requestAnimationFrame(() => closeButton?.focus());
    };
    marker.on('add', () => {
    const element = marker.getElement();
    element.ownerSVGElement?.setAttribute('role','group');
    element.ownerSVGElement?.setAttribute('aria-label','Matching property markers');
    element.setAttribute('tabindex','0');
    element.setAttribute('role','button');
    element.setAttribute('aria-label',`${currency(hit.price)} · ${hit.title}`);
    element.setAttribute('aria-haspopup','dialog');
    element.setAttribute('aria-expanded','false');
    element.dataset.houseId = hit.id;
    element.addEventListener('focus', () => { if (!marker.isPopupOpen()) marker.openTooltip(); });
    element.addEventListener('blur', () => marker.closeTooltip());
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); event.stopPropagation();
      if (mobile()) showMobilePreview(hit, marker, true);
      else openDesktopPreview(true);
    });
    });
    // Leaflet's built-in click handler opens an anchored popup. Route marker clicks
    // ourselves so mobile uses the bottom sheet while desktop keeps the popup.
    marker.off('click');
    marker.on('click', () => {
      if (mobile()) showMobilePreview(hit, marker);
      else openDesktopPreview(true);
    });
    markerLayer.addLayer(marker);
    if (hit.id === selectedHouseId) restoredMarker = { marker, hit, openDesktopPreview };
  }

  if (restoredMarker) {
    if (mobile()) showMobilePreview(restoredMarker.hit, restoredMarker.marker);
    else restoredMarker.openDesktopPreview();
  } else if (selectedHouseId) {
    state.selectedMapHouseId = null;
    const sheet = mapElement.parentElement.querySelector('.mobile-map-preview');
    if (sheet) { sheet.hidden = true; sheet.replaceChildren(); }
  }
  if (!existingMap) {
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }
}

// View changes resize the existing map; they never change the search or viewport.
export function resizeVisibleMap() {
  const element = document.querySelector('#result-map');
  if (!element?.getClientRects().length) return;
  if (!state.resultMap) renderLeafletMap();
  else state.resultMap.invalidateSize({pan:false});
}
