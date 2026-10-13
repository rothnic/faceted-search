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
