import {expect,test} from '@playwright/test';

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

for (const width of [1366,390]) {
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
    await expect(page.getByRole('button',{name:'Close listing preview'})).toBeFocused();
    await expect(marker).toHaveAttribute('aria-expanded','true');
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

test.describe('touch marker preview',()=>{
  test.use({hasTouch:true,isMobile:true,viewport:{width:390,height:844}});
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
    await expect(page.locator('#result-map')).not.toHaveClass(/leaflet-pan-anim/);
    const box=(await preview.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(390);
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
