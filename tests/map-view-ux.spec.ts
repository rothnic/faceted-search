import {expect,test,type Page} from '@playwright/test';

async function expectPreviewInsideMap(page: Page) {
  const bounds = await page.evaluate(()=>{
    const map=document.querySelector('#result-map')!,popup=document.querySelector('.map-listing-preview')!;
    const m=map.getBoundingClientRect(),p=popup.getBoundingClientRect();
    return {map:{x:m.x,y:m.y,w:m.width,h:m.height},popup:{x:p.x,y:p.y,w:p.width,h:p.height},viewport:{w:innerWidth,h:innerHeight,documentWidth:document.documentElement.scrollWidth}};
  });
  const m=bounds.map,p=bounds.popup;
  if (bounds.viewport.w < 760) {
    expect(p.x).toBeGreaterThanOrEqual(m.x); expect(p.y).toBeGreaterThanOrEqual(m.y);
    expect(p.x+p.w).toBeLessThanOrEqual(m.x+m.w); expect(p.y+p.h).toBeLessThanOrEqual(m.y+m.h);
  } else {
    expect(bounds.viewport.documentWidth).toBeLessThanOrEqual(bounds.viewport.w);
  }
}

// Internal rendering fixture only. Acceptance captures load actual OSM tiles.
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=','base64');
for (const width of [390,320]) {
  test(`mobile map/list preserves search, map viewport and list position at ${width}px`, async ({page}) => {
    await page.route('https://tile.openstreetmap.org/**', route=>route.fulfill({contentType:'image/png',body:tile}));
    await page.setViewportSize({width,height:844});
    await page.goto('/search?provider=postgres_native&mode=keyword&q=garage&sort=price_asc&city=Huntsville');
    await expect(page.locator('.result').first()).toBeVisible();
    const url=page.url();
    const list=page.locator('#result-list-scroll');
    await list.evaluate(e=>{e.scrollTop=160;});
    const scroll=await list.evaluate(e=>e.scrollTop);
    await page.getByRole('button',{name:'Show map',exact:true}).click();
    await expect(list).toBeHidden();
    await expect(page.locator('#result-map')).toBeVisible();
    const mapBox=await page.locator('#result-map').boundingBox();
    expect(mapBox!.y+mapBox!.height).toBeLessThanOrEqual(844);
    await expect(page.locator('#result-map')).toHaveAttribute('data-map-state','ready');
    await expect(page.locator('.map-head')).toHaveCount(0);
    const keyBox=(await page.locator('.map-key > summary').boundingBox())!;
    const attributionBox=(await page.locator('.leaflet-control-attribution').boundingBox())!;
    expect(keyBox.y+keyBox.height).toBeLessThan(attributionBox.y);
    await page.locator('.map-key > summary').click();
    await expect(page.locator('.map-legend')).toBeVisible();
    await page.locator('.map-key > summary').click();
    const marker=page.locator('.leaflet-interactive').first();
    expect(await marker.evaluate(e=>getComputedStyle(e).fill)).toMatch(/^rgb\((18, 113, 92|69, 138, 121|54, 95, 112|36, 72, 59|114, 116, 70)\)$/);
    await expect(page.locator('.listing-column .result').first()).not.toBeInViewport();
    const currentTiles = () => page.locator('.leaflet-tile').evaluateAll(es=>{
      const urls=es.map(e=>(e as HTMLImageElement).src).filter(s=>s.startsWith('https://tile.openstreetmap.org/'));
      const zoom=Math.max(...urls.map(s=>Number(new URL(s).pathname.split('/')[1])));
      return urls.filter(s=>Number(new URL(s).pathname.split('/')[1])===zoom).sort();
    });
    const priorZoom=Number(new URL((await currentTiles())[0]).pathname.split('/')[1]);
    await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await expect.poll(async()=>Number(new URL((await currentTiles())[0]).pathname.split('/')[1])).toBe(priorZoom+1);
    await expect(page.locator('#result-map')).not.toHaveClass(/leaflet-zoom-anim/);
    await expect(page.locator('#result-map')).toHaveAttribute('data-map-state','ready');
    const tiles=await currentTiles();
    await page.getByRole('button',{name:'Show list',exact:true}).click();
    await expect(page.locator('#result-map')).toBeHidden();
    await expect(list).toBeVisible();
    await expect.poll(()=>list.evaluate(e=>e.scrollTop)).toBeCloseTo(scroll,0);
    await page.getByRole('button',{name:'Show map',exact:true}).click();
    await expect(page.locator('#result-map')).toHaveAttribute('data-map-state','ready');
    expect(await currentTiles()).toEqual(tiles);
    expect(page.url()).toBe(url);
    await page.locator('#search-box').fill('Huntsville');
    await expect(page).toHaveURL(/q=Huntsville/);
    await page.locator('#search-box').press('Escape');
    await expect(page.locator('#mobile-view-toggle')).toBeVisible();
    await page.getByRole('button',{name:'Show list',exact:true}).click();
    await expect.poll(()=>page.locator('#result-list-scroll').evaluate(e=>e.scrollTop)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.setViewportSize({width:1366,height:900});
    await expect(list).toBeVisible();
    await expect(page.locator('#result-map')).toBeVisible();
    await expect(page.locator('#mobile-view-toggle')).toBeHidden();
  });
}


test('map refresh updates markers while preserving Leaflet DOM, tiles, viewport and selected preview', async ({page}) => {
  let tileRequests=0;
  await page.route('https://tile.openstreetmap.org/**',route=>{tileRequests++; return route.fulfill({contentType:'image/png',body:tile});});
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('.result').first()).toBeVisible();
  await page.getByRole('button',{name:'Map',exact:true}).click();
  await expect(page.locator('#result-map')).toBeVisible();
  await expect.poll(()=>page.locator('#result-map .leaflet-tile').count()).toBeGreaterThan(0);
  const mapNode=await page.locator('#result-map').elementHandle();
  const tileNode=await page.locator('#result-map .leaflet-tile').first().elementHandle();
  const tilesBefore=await page.locator('#result-map .leaflet-tile').evaluateAll(es=>es.map(e=>(e as HTMLImageElement).src).sort());
  const requestsBefore=tileRequests;
  await page.locator('.leaflet-interactive').first().click();
  const selectedTitle=await page.locator('.map-listing-preview h3').textContent();
  await expect(page.locator('.map-listing-preview')).toBeVisible();
  await page.locator('#sort').selectOption('price_desc');
  await expect(page.locator('.results-updating')).toBeHidden();
  expect(await page.evaluate(node=>document.querySelector('#result-map')===node,mapNode)).toBe(true);
  expect(await page.evaluate(node=>document.contains(node),tileNode)).toBe(true);
  expect(await page.locator('#result-map .leaflet-tile').evaluateAll(es=>es.map(e=>(e as HTMLImageElement).src).sort())).toEqual(tilesBefore);
  expect(tileRequests).toBe(requestsBefore);
  await expect(page.locator('.map-listing-preview h3')).toHaveText(selectedTitle!);
});

test('desktop map stays visible and stationary while its listing pane scrolls', async ({page})=>{
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('.result').first()).toBeVisible();
  const map=page.locator('.map-column');
  expect(await map.evaluate(e=>getComputedStyle(e).position)).toBe('sticky');
  const before=await map.boundingBox();
  await page.locator('#result-list-scroll').evaluate(e=>{e.scrollTop=300;});
  await expect.poll(async()=> (await map.boundingBox())!.y).toBeCloseTo(before!.y,0);
  await expect(page.locator('#result-map')).toBeInViewport();
});

for (const width of [1366,390,320]) {
  test(`map preview supports keyboard, dismissal and Details at ${width}px`, async ({page})=>{
    await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:tile}));
    await page.setViewportSize({width,height:900});
    await page.goto('/search?mode=keyword&q=garage');
    await expect(page.locator('.result').first()).toBeVisible();
    if(width<760) await page.getByRole('button',{name:'Show map',exact:true}).click();
    const marker=page.locator('.leaflet-interactive[data-house-id="target-hampton-cove-garage"]');
    await expect(page.getByRole('button',{name:'$525,000 · Hampton Cove garage home with mountain views',exact:true})).toBeVisible();
    await marker.focus();
    await expect(page.locator('.map-hover-tooltip .tooltip-content')).toContainText('$525,000');
    await marker.press('Escape');
    await expect(page.locator('.map-hover-tooltip')).toBeHidden();
    await marker.press('Enter');
    const preview=page.getByRole('dialog',{name:/Listing preview: Hampton Cove/});
    await expect(preview).toBeVisible();
    await expectPreviewInsideMap(page);
    if(width<760) {
      const otherIndex=await page.locator('.leaflet-interactive').evaluateAll((els)=>els.findIndex((el)=>el.getAttribute('data-house-id')!=='target-hampton-cove-garage'));
      const otherMarker=page.locator('.leaflet-interactive').nth(otherIndex);
      await otherMarker.focus();
      await otherMarker.press('Enter');
      await expect(marker).toHaveAttribute('aria-expanded','false');
      await expect(otherMarker).toHaveAttribute('aria-expanded','true');
      await page.keyboard.press('Escape');
      await expect(otherMarker).toHaveAttribute('aria-expanded','false');
      await expect(marker).toHaveAttribute('aria-expanded','false');
      await marker.focus();
      await marker.press('Enter');
      await expect(preview).toBeVisible();
    }
    if(width===390) {
      await page.setViewportSize({width:320,height:900});
      await expectPreviewInsideMap(page);
      await expect(preview).toBeVisible();
    }
    if (width<760) await expect(page.getByRole('button',{name:'Close listing preview'})).toBeFocused();
    if (width<760) await expect(marker).toHaveAttribute('aria-expanded','true');
    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(marker).toBeFocused();
    await marker.press('Space');
    await expect(preview).toBeVisible();
    await page.locator('#search-box').click();
    await expect(preview).toBeHidden();
    await marker.focus(); await marker.press('Enter');
    await page.getByRole('button',{name:'Close listing preview'}).click();
    await expect(preview).toBeHidden();
    await marker.focus(); await marker.press('Enter');
    await preview.getByRole('button',{name:'Details',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'Hampton Cove garage home with mountain views',exact:true})).toBeVisible();
  });
}

for (const width of [390,320]) test.describe(`touch marker preview at ${width}px`,()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width,height:844}});
  test('tap opens persistent card without hover tooltip',async({page})=>{
    await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:tile}));
    await page.goto('/search?mode=keyword&q=garage');
    await expect(page.locator('.result').first()).toBeVisible();
    await page.getByRole('button',{name:'Show map',exact:true}).tap();
    const marker=page.locator('.leaflet-interactive').last();
    const title=(await marker.getAttribute('aria-label'))!.split(' · ').slice(1).join(' · ');
    await marker.tap();
    const preview=page.getByRole('dialog',{name:/Listing preview:/});
    await expect(preview).toBeVisible();
    await expect(page.locator('.map-hover-tooltip')).toBeHidden();
    await expectPreviewInsideMap(page);
    const box=(await preview.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y+box.height).toBeLessThanOrEqual(844);
    await preview.getByRole('button',{name:'Details',exact:true}).tap();
    await expect(page.getByRole('dialog',{name:title,exact:true})).toBeVisible();
  });
});

test('map-only detail failure is explicit and closing ignores a late response',async({page})=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/houses/*',async route=>{
    await gate;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Listing lookup unavailable'})});
  });
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('.result').first()).toBeVisible();
  const marker=page.locator('.leaflet-interactive').last();
  await marker.focus(); await marker.press('Enter');
  await page.getByRole('dialog',{name:/Listing preview:/}).getByRole('button',{name:'Details',exact:true}).click();
  const loading=page.getByRole('dialog',{name:'Listing details',exact:true});
  await expect(loading).toContainText('Loading listing');
  await loading.getByRole('button',{name:'Close',exact:true}).click();
  const response=page.waitForResponse(r=>r.url().includes('/api/houses/'));
  release(); await response;
  await expect(loading).toBeHidden();
  await marker.focus(); await marker.press('Enter');
  await page.getByRole('dialog',{name:/Listing preview:/}).getByRole('button',{name:'Details',exact:true}).click();
  await expect(loading.getByRole('alert')).toHaveText('Listing lookup unavailable');
  await expect(loading.getByRole('button',{name:'Retry details',exact:true})).toBeVisible();
});

test('desktop Split, Map and List switch presentations without repeating search criteria', async ({page}) => {
  let searches=0;
  await page.route('**/api/search',(route)=>{searches++; return route.continue();});
  await page.route('https://tile.openstreetmap.org/**',(route)=>route.abort());
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.locator('.leaflet-result-map')).toBeVisible();
  const originalSearches=searches;
  const controls=page.getByRole('group',{name:'Result view'});
  await controls.getByRole('button',{name:'List',exact:true}).click();
  await expect(page.locator('#results-workspace')).toHaveAttribute('data-desktop-view','list');
  await expect(page.locator('.leaflet-result-map')).toBeHidden();
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await controls.getByRole('button',{name:'Map',exact:true}).click();
  await expect(page.locator('#results-workspace')).toHaveAttribute('data-desktop-view','map');
  await expect(page.locator('#result-list-scroll')).toBeHidden();
  await expect(page.locator('.leaflet-result-map')).toBeVisible();
  await controls.getByRole('button',{name:'Split',exact:true}).click();
  await expect(page.locator('#results-workspace')).toHaveAttribute('data-desktop-view','split');
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.locator('.leaflet-result-map')).toBeVisible();
  expect(searches).toBe(originalSearches);
  await expect(page.getByRole('textbox',{name:'Search',exact:true})).toHaveValue('garage');
});

test('mobile List does not load Leaflet until Map is selected', async ({page}) => {
  const mapModuleRequests:string[]=[];
  await page.route('https://tile.openstreetmap.org/**',(route)=>route.abort());
  page.on('request',request=>{if(/map\.js|leaflet/i.test(request.url())) mapModuleRequests.push(request.url());});
  await page.setViewportSize({width:390,height:844});
  const listResponsePromise=page.waitForResponse(response=>response.url().endsWith('/api/search') && response.request().method()==='POST');
  await page.goto('/search?mode=keyword&q=garage');
  const listResponse=await listResponsePromise;
  expect(listResponse.request().postDataJSON().includeMap).toBe(false);
  expect((await listResponse.json()).mapHits).toEqual([]);
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  await expect(page.locator('.leaflet-result-map')).toBeHidden();
  expect(mapModuleRequests).toEqual([]);
  let releaseMapResponse!:()=>void;
  let mapRequests=0;
  const mapGate=new Promise<void>(resolve=>{releaseMapResponse=resolve;});
  await page.route('**/api/search',async route=>{
    if(route.request().postDataJSON()?.mapOnly){mapRequests++;await mapGate;}
    await route.continue();
  });
  const mapResponsePromise=page.waitForResponse(response=>response.url().endsWith('/api/search') && response.request().postDataJSON().includeMap===true && response.request().postDataJSON().mapOnly===true);
  await page.locator('#mobile-view-toggle').click();
  await expect.poll(()=>mapRequests).toBe(1);
  await page.locator('#mobile-view-toggle').click();
  await page.locator('#mobile-view-toggle').click();
  await page.waitForTimeout(100);
  expect(mapRequests).toBe(1);
  releaseMapResponse();
  const mapResponse=await mapResponsePromise;
  expect((await mapResponse.json()).hits).toEqual([]);
  expect((await mapResponse.json()).mapHits.length).toBeGreaterThan(0);
  await expect(page.locator('.leaflet-result-map')).toBeVisible();
  await expect.poll(()=>mapModuleRequests.length).toBeGreaterThan(0);
  await page.locator('#mobile-view-toggle').click();
  await expect(page.locator('.leaflet-result-map')).toBeHidden();
});

test('map legend refreshes when property type filters change', async ({page})=>{
  await page.route('**/api/search',async route=>{
    const response=await route.fetch();
    const request=route.request().postDataJSON();
    if(!request.filters?.propertyType?.includes('condo')) return route.fulfill({response});
    const payload=await response.json();
    payload.mapHits=payload.mapHits.filter((hit:any)=>hit.propertyType==='condo').slice(0,1);
    return route.fulfill({status:response.status(),headers:response.headers(),contentType:'application/json',body:JSON.stringify(payload)});
  });
  await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:tile}));
  await page.setViewportSize({width:1366,height:900});
  await page.goto('/search?mode=keyword&q=home');
  await expect(page.locator('.result').first()).toBeVisible();
  await page.getByRole('button',{name:'Map',exact:true}).click();
  await expect(page.locator('#result-map')).toBeVisible();
  await expect(page.locator('.map-legend')).toContainText('Single family');
  const mapNode=await page.locator('#result-map').elementHandle();
  const filteredResponse=page.waitForResponse(response=>response.url().endsWith('/api/search') && response.request().postDataJSON().filters?.propertyType?.includes('condo'));
  await page.locator('.facet-group[data-facet="propertyType"]').getByLabel(/condo/i).check();
  await filteredResponse;
  await expect(page.locator('.leaflet-interactive')).toHaveCount(1);
  await expect(page.locator('.results-updating')).toBeHidden();
  await expect(page.locator('.map-legend')).toContainText('Condo');
  await expect(page.locator('.map-legend span')).toHaveCount(1);
  expect(await page.evaluate(node=>document.querySelector('#result-map')===node,mapNode)).toBe(true);
});

test('map-only response updates the current map region after a breakpoint rerender', async ({page}) => {
  await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await page.setViewportSize({width:390,height:844});
  await page.goto('/search?mode=keyword&q=garage');
  await expect(page.locator('#result-list-scroll')).toBeVisible();
  let releaseMapResponse!:()=>void;
  const mapGate=new Promise<void>(resolve=>{releaseMapResponse=resolve;});
  await page.route('**/api/search',async route=>{
    if(route.request().postDataJSON()?.mapOnly) await mapGate;
    await route.continue();
  });
  const mapResponsePromise=page.waitForResponse(response=>response.url().endsWith('/api/search') && response.request().postDataJSON().mapOnly===true);
  await page.locator('#mobile-view-toggle').click();
  await page.setViewportSize({width:1366,height:844});
  await expect(page.getByRole('group',{name:'Result view'})).toBeVisible();
  releaseMapResponse();
  await mapResponsePromise;
  await expect(page.locator('#results-workspace')).toHaveAttribute('data-desktop-view','split');
  await expect.poll(()=>page.locator('.leaflet-interactive').count()).toBeGreaterThan(0);
});
