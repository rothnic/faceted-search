import {
  app,
  api,
  currency,
  escapeHtml,
  label,
  propertyTypeStyle,
  selectedHit,
  state,
  titleLabel
} from '../core.js';

let detailRequestId = 0;
export async function openHitDetails(id) {
  const requestId = ++detailRequestId;
  state.selectedHitId = id;
  state.selectedHitRecord = null;
  state.detailError = null;
  state.detailLoading = !selectedHit();
  syncHitDialog();
  document.querySelector('.detail-dialog')?.focus?.();
  if (!state.detailLoading) return;
  try {
    const result = await api(`/api/houses/${encodeURIComponent(id)}`);
    if (requestId !== detailRequestId || state.selectedHitId !== id) return;
    state.selectedHitRecord = result.house;
  } catch (error) {
    if (requestId !== detailRequestId || state.selectedHitId !== id) return;
    state.detailError = error.message;
  } finally {
    if (requestId === detailRequestId && state.selectedHitId === id) {
      state.detailLoading = false;
      syncHitDialog();
      document.querySelector('.detail-dialog')?.focus?.();
    }
  }
}

export function closeHitDetails() {
  if (!state.selectedHitId) return;
  ++detailRequestId;
  state.selectedHitId = null;
  state.detailLoading = false;
  state.detailError = null;
  syncHitDialog();
}

export function syncHitDialog() {
  const existingDialog = document.querySelector('.modal-backdrop');
  if (existingDialog) existingDialog.remove();
  app.insertAdjacentHTML('beforeend', renderHitDialog());
}

function detailItem(labelText, value) {
  if (value === undefined || value === null || value === '') return '';
  return `
    <div class="detail-item">
      <dt>${escapeHtml(labelText)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderHitDialog() {
  if (state.selectedHitId && (state.detailLoading || state.detailError)) return `
    <div class="modal-backdrop" data-close-dialog="true"><section class="detail-dialog" role="dialog" aria-modal="true" aria-label="Listing details" tabindex="-1">
      <button class="btn btn-ghost" type="button" data-close-dialog="true">Close</button><h2>Listing details</h2>
      <p role="${state.detailError ? 'alert' : 'status'}">${state.detailError ? escapeHtml(state.detailError) : 'Loading listing…'}</p>
      ${state.detailError ? `<button class="btn btn-primary" data-open-hit="${escapeHtml(state.selectedHitId)}">Retry details</button>` : ''}
    </section></div>`;
  const hit = selectedHit();
  if (!hit) return '';
  const coreItems = [
    ['Price', currency(hit.price)],
    ['Property type', titleLabel(hit.propertyType)],
    ['Status', titleLabel(hit.listingStatus)],
    ['Bedrooms', hit.bedrooms],
    ['Bathrooms', hit.bathrooms],
    ['Square feet', hit.squareFeet ? hit.squareFeet.toLocaleString() : '0'],
    ['Lot acres', hit.lotSizeAcres],
    ['Year built', hit.yearBuilt]
  ];
  const locationItems = [
    ['Address', `${hit.addressLine1}, ${hit.city} ${hit.zipCode}`],
    ['Neighborhood', hit.neighborhood],
    ['School district', hit.schoolDistrict],
    ['Coordinates', `${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}`],
    ['Distance', hit.distanceMiles !== undefined ? `${hit.distanceMiles.toFixed(1)} mi away` : undefined]
  ];
  const searchItems = [
    ['Matched terms', Array.isArray(hit.matchedTerms) ? (hit.matchedTerms.length ? hit.matchedTerms.join(', ') : 'None') : 'Not provided by record lookup'],
    ['Created', new Date(hit.createdAt).toLocaleDateString()],
    ['Updated', new Date(hit.updatedAt).toLocaleDateString()]
  ];
  const style = propertyTypeStyle(hit.propertyType);
  return `
    <div class="modal-backdrop" data-close-dialog="true">
      <section class="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
        <div class="detail-hero" style="border-color:${style.color}">
          <div>
            <span class="result-type" style="--type-color:${style.color}">${escapeHtml(style.label)}</span>
            <h2 id="detail-title">${escapeHtml(hit.title)}</h2>
            <p>${escapeHtml(hit.description)}</p>
          </div>
          <button type="button" class="btn btn-sm icon-button" data-close-dialog="true" aria-label="Close details">x</button>
        </div>
        <div class="detail-body">
          <section>
            <h3>Structured details</h3>
            <dl class="detail-grid">${coreItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Location</h3>
            <dl class="detail-grid">${locationItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Search metadata</h3>
            <dl class="detail-grid">${searchItems.map(([key, value]) => detailItem(key, value)).join('')}</dl>
          </section>
          <section>
            <h3>Amenities</h3>
            <div class="amenities">${hit.amenities.map((item) => `<button type="button" class="btn btn-sm pill hit-chip" data-hit-filter="amenities" data-value="${escapeHtml(item)}">${label(item)}</button>`).join('')}</div>
          </section>
          <section>
            <h3>Tags</h3>
            <div class="amenities">${hit.tags.map((item) => `<span class="pill">${label(item)}</span>`).join('') || '<span class="stats">No tags</span>'}</div>
          </section>
          <section class="detail-json">
            <h3>Structured JSON</h3>
            <pre>${escapeHtml(JSON.stringify(hit, null, 2))}</pre>
          </section>
        </div>
      </section>
    </div>
  `;
}
