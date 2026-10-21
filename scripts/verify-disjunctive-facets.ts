import assert from 'node:assert/strict';
import type pg from 'pg';
import type { Browser } from '@playwright/test';
import type { HouseSearchRequest, HouseSearchResponse } from '../packages/search-contracts/src/search-provider.interface.js';

const groups = ['city', 'neighborhood', 'schoolDistrict', 'propertyType', 'bedrooms', 'amenities', 'listingStatus'] as const;
const providers = ['postgres_native', 'pg_search', 'meilisearch', 'typesense'] as const;
const base: HouseSearchRequest = { provider: 'postgres_native', mode: 'keyword', q: '', filters: {}, sort: 'relevance', page: 1, pageSize: 3, includeFacets: true, includeMap: false };
const sorted = (values: Array<{value: string; count: number}>) => [...values].sort((a,b) => a.value.localeCompare(b.value));
async function search(origin: string, request: HouseSearchRequest): Promise<HouseSearchResponse> {
  const response = await fetch(origin+'/api/search', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(request), signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

// Only called from the existing IPC-owned disposable API/appliance lifecycle.
export async function verifyDisjunctiveFacets(origin: string, pool: pg.Pool) {
  assert.equal(process.env.TEST_DISPOSABLE_ENGINES, '1');
  const evidence = [];
  const oracle = Number((await pool.query("SELECT count(*)::int AS n FROM houses h WHERE deleted_at IS NULL AND bedrooms IN (4,5) AND EXISTS (SELECT 1 FROM house_amenities a WHERE a.house_id=h.id AND a.amenity IN ('garage','pool'))")).rows[0].n);
  const savedResponse = await fetch(origin+'/api/saved-searches', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Facet acceptance scope',criteria:{provider:'postgres_native',mode:'keyword',q:'garage',filters:{},sort:'relevance'}}) });
  assert.equal(savedResponse.status,201);
  const saved = await savedResponse.json();
  for (const provider of providers) {
    const all = await search(origin, {...base,provider});
    const four = await search(origin,{...base,provider,filters:{bedrooms:[4]}});
    const both = await search(origin,{...base,provider,filters:{bedrooms:[4,5]}});
    assert.equal(all.totalHits,126); assert.equal(four.totalHits,28); assert.equal(both.totalHits,52);
    assert.deepEqual(sorted(four.facets.bedrooms), sorted(all.facets.bedrooms), provider+' keeps native bedroom alternatives');
    assert.deepEqual(sorted(both.facets.bedrooms),sorted(all.facets.bedrooms));
    const across = await search(origin,{...base,provider,filters:{bedrooms:[4,5],amenities:['garage','pool']}});
    assert.equal(across.totalHits,oracle,provider+' OR in both groups, AND across groups');
    assert.deepEqual(sorted(across.facets.bedrooms),sorted((await search(origin,{...base,provider,filters:{amenities:['garage','pool']}})).facets.bedrooms));
    assert.deepEqual(sorted(across.facets.amenities),sorted(both.facets.amenities));
    // Compare a group's native aggregation with exactly the same selected service,
    // query, mode, range, geographic constraints and saved scope, excluding only itself.
    const contexts: Array<Partial<HouseSearchRequest>> = [
      {q:'garage',filters:{bedrooms:[4],amenities:['garage'],minPrice:100000,maxPrice:900000}},
      {geo:{lat:34.746,lng:-86.567,radiusMiles:20},filters:{bedrooms:[4],amenities:['garage']}},
      {viewport:{minLat:34,maxLat:35,minLng:-87,maxLng:-86},savedSearchIds:[saved.id],filters:{bedrooms:[4],listingStatus:['active']}},
      {mode:'semantic',q:'comfortable single level home',filters:{bedrooms:[4],propertyType:['single_family']}},
      {mode:'hybrid',q:'quiet garden',filters:{bedrooms:[4],amenities:['garage']}},
      {q:'garage',filters:{bedrooms:[4],maxPrice:0}}
    ];
    for (const context of contexts) {
      const request = {...base,provider,...context};
      const result = await search(origin,request);
      for (const key of groups) if (request.filters[key]?.length) {
        const filters = {...request.filters}; delete filters[key];
        const reference = await search(origin,{...request,filters});
        assert.deepEqual(sorted(result.facets[key]),sorted(reference.facets[key]),provider+' self-excluding '+key+' '+JSON.stringify(context));
      }
    }
    const without = await search(origin,{...base,provider,filters:{bedrooms:[4]},includeFacets:false});
    assert.deepEqual(without.facets,{});
    assert.deepEqual(without.facetDefinitions,[]);
    assert.deepEqual(all.facetDefinitions?.map(field=>field.key),groups);
    evidence.push({provider,total:all.totalHits,four:four.totalHits,fourOrFive:both.totalHits,across:across.totalHits,bedrooms:four.facets.bedrooms,contexts:contexts.length});
  }
  return evidence;
}

export async function verifyFacetComponents(origin: string, browser: Browser) {
  const evidence = [];
  for (const width of [390,1440]) for (const provider of providers) {
    const page = await browser.newPage({viewport:{width,height:900},hasTouch:width===390});
    const errors: string[] = []; page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+'/search?provider='+provider);
    await page.getByRole('button',{name:'Search service and method'}).waitFor();
    const panel = width===390 ? page.getByRole('dialog',{name:'Refine results'}) : page.locator('.desktop-filter-panel');
    if(width===390) await page.getByRole('button',{name:/^Filters \(/}).click();
    const bedrooms = panel.locator('[data-facet="bedrooms"]');
    const native = await search(origin,{...base,provider,filters:{bedrooms:[4]}});
    const started=performance.now();
    await bedrooms.getByRole('checkbox',{name:'4 beds',exact:true}).check();
    await page.getByTestId('results-count').filter({hasText:'28'}).waitFor();
    assert.deepEqual((await bedrooms.locator('[data-facet-value]').evaluateAll(nodes=>nodes.map(node=>({value:node.getAttribute('data-facet-value'),count:Number(node.getAttribute('data-facet-count'))})))).sort((a,b)=>String(a.value).localeCompare(String(b.value))),sorted(native.facets.bedrooms));
    await bedrooms.getByRole('checkbox',{name:'5 beds',exact:true}).check();
    await page.getByTestId('results-count').filter({hasText:'52'}).waitFor();
    assert(await bedrooms.getByRole('checkbox',{name:'4 beds',exact:true}).isChecked());
    assert(await bedrooms.getByRole('checkbox',{name:'5 beds',exact:true}).isChecked());
    if(width===390) await panel.getByRole('button',{name:'Close filters',exact:true}).click();
    const trigger=page.getByRole('button',{name:'Search service and method'});
    await trigger.click(); await page.getByRole('menuitemradio',{name:'Keyword',exact:true}).click();
    await page.getByRole('menu').waitFor({state:'hidden'});
    await trigger.click();
    const outside = await page.getByTestId('results-heading').boundingBox(); assert(outside);
    if(width===390) await page.touchscreen.tap(outside.x+5,outside.y+5); else await page.mouse.click(outside.x+5,outside.y+5);
    await page.getByRole('menu').waitFor({state:'hidden'});
    await trigger.click(); await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({state:'hidden'});
    await trigger.click(); await page.getByRole('menuitemradio',{name:'Hybrid',exact:true}).click();
    await page.getByRole('menu').waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).searchParams.get('mode'),'hybrid');
    const card=page.locator('.result-card').first(); const before=await card.evaluate(node=>({border:getComputedStyle(node).borderColor,shadow:getComputedStyle(node).boxShadow}));
    await card.locator('.result-select').click(); await page.getByRole('dialog',{name:'Home details'}).waitFor();
    await page.getByRole('button',{name:'Close home details'}).click();
    await page.getByRole('dialog',{name:'Home details'}).waitFor({state:'hidden'});
    assert.deepEqual(await card.evaluate(node=>({border:getComputedStyle(node).borderColor,shadow:getComputedStyle(node).boxShadow})),before,'Details must not persist map-selection highlighting');
    await page.keyboard.press('Tab');
    assert(await page.evaluate(()=>{const node=document.activeElement; if(!(node instanceof HTMLElement))return false;const style=getComputedStyle(node);return node.matches(':focus-visible')&&(style.outlineStyle!=='none'||style.boxShadow!=='none');}),'Keyboard focus stays visible');
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');
    assert.deepEqual(errors,[]);
    await page.screenshot({path:'test-results/real-screenshots/facets-'+provider+'-'+width+'.png',fullPage:true});
    evidence.push({provider,width,interactionMs:performance.now()-started,bedrooms:native.facets.bedrooms,menuDismissal:['selection','outside','Escape'],cardHighlight:'unchanged',keyboardFocus:'visible'});
    await page.close();
  }
  return evidence;
}
