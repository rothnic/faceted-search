// Keep the one information disclosure accessible when its host changes at a breakpoint.
export function placeSearchInformation(document, isMobile, restoreFocusId) {
  const info = document.querySelector('#system-summary');
  const active = restoreFocusId ? document.getElementById(restoreFocusId) : document.activeElement;
  const insideInfo = Boolean(active && info?.contains(active));
  const host = document.querySelector(isMobile ? '#mobile-information' : '.toolbar-heading');
  if (info && host && info.parentElement !== host) host.append(info);
  let target;
  if (insideInfo) target = isMobile && !document.querySelector('#filter-drawer-toggle')?.checked
    ? document.querySelector('#toggle-filters') : active;
  else if (isMobile && ['search-mode','provider'].includes(active?.id)) target = document.querySelector('#toggle-filters');
  else if (!isMobile && active?.id === 'mobile-mode') target = document.querySelector('#search-mode');
  else if (!isMobile && active?.id === 'mobile-provider') target = document.querySelector('#provider');
  target?.focus({ preventScroll:true });
}
