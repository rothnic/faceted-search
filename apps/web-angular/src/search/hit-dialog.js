import {
  app,
  currency,
  escapeHtml,
  label,
  propertyTypeStyle,
  selectedHit,
  state,
  titleLabel
} from '../core.js';

export function openHitDetails(id) {
  state.selectedHitId = id;
  syncHitDialog();
  document.querySelector('.detail-dialog')?.focus?.();
}

export function closeHitDetails() {
  if (!state.selectedHitId) return;
  state.selectedHitId = null;
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
    ['Matched terms', hit.matchedTerms?.length ? hit.matchedTerms.join(', ') : 'None'],
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
          <button type="button" class="icon-button" data-close-dialog="true" aria-label="Close details">x</button>
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
            <div class="amenities">${hit.amenities.map((item) => `<button type="button" class="pill hit-chip" data-hit-filter="amenities" data-value="${escapeHtml(item)}">${label(item)}</button>`).join('')}</div>
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
