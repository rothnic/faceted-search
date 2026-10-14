const mobile = () => window.matchMedia('(max-width:760px)').matches;

export function syncFilterDrawer() {
  const root = document.querySelector('#filter-drawer');
  const toggle = document.querySelector('#filter-drawer-toggle');
  const panel = document.querySelector('#filter-panel-content');
  if (!root || !toggle || !panel) return;
  const isMobile = mobile();
  const open = isMobile && toggle.checked;
  root.classList.toggle('drawer-open', !isMobile);
  document.querySelector('#toggle-filters')?.setAttribute('aria-expanded', String(open));
  panel.setAttribute('role', open ? 'dialog' : 'region');
  panel.setAttribute('aria-labelledby', 'filter-panel-title');
  if (open) panel.setAttribute('aria-modal', 'true');
  else panel.removeAttribute('aria-modal');
  for (const element of document.querySelectorAll('.topbar,.toolbar,#search-results,#search-debug')) element.inert = open;
}

export function setFilterDrawer(open, restoreFocus = true) {
  const toggle = document.querySelector('#filter-drawer-toggle');
  if (!toggle) return;
  toggle.checked = mobile() && open;
  syncFilterDrawer();
  if (toggle.checked) document.querySelector('#close-filter-panel')?.focus();
  else if (!mobile() && document.activeElement?.id === 'close-filter-panel') document.querySelector('#clear-filters')?.focus();
  else if (restoreFocus && mobile()) document.querySelector('#toggle-filters')?.focus();
}

export function handleFilterDrawerKey(event) {
  if (!mobile() || !document.querySelector('#filter-drawer-toggle')?.checked) return false;
  if (event.key === 'Escape') {
    event.preventDefault();
    setFilterDrawer(false);
    return true;
  }
  if (event.key !== 'Tab') return false;
  const controls = [...document.querySelectorAll('#filter-panel-content button,#filter-panel-content input,#filter-panel-content select,#filter-panel-content a[href],#filter-panel-content summary')]
    .filter(element => !element.disabled && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  return false;
}
