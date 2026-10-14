import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { renderSearchBar, renderSearchSettings, renderResultsToolbar } from '../../apps/web-angular/src/search/controls.js';
const assetDir = new URL('../../apps/web-angular/dist/assets/', import.meta.url);
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const request = { q:'garage', mode:'keyword', provider:'postgres_native', sort:'relevance' };
const providers = [{id:'postgres_native',label:'PostgreSQL'},{id:'pg_search',label:'pg_search'},{id:'meilisearch',label:'Meilisearch'},{id:'typesense',label:'Typesense'}];
for (const width of [320,390,761,768,1180,1366]) {
  test(`isolated shared controls fit ${width}px with and without facet chips`, async ({page}) => {
    const css = readFileSync(new URL(readdirSync(assetDir).find(name => /^index-.*\.css$/.test(name)), assetDir), 'utf8');
    let requests=0;
    await page.route('**/*', route => { requests++; return route.abort(); });
    await page.setViewportSize({width,height:900});
    const chips = '<div class="refinements"><button class="btn btn-ghost refinement-pill"><span class="badge badge-soft badge-primary">City: Huntsville ×</span></button></div>';
    for (const active of [false,true]) {
      await page.setContent(`<html data-theme="search"><head><style>${css}</style></head><body><main id="app"><section class="toolbar card"><div class="toolbar-heading"><details class="system-info"><summary>More settings</summary></details></div>${renderSearchBar(request,escape)}<div class="search-options">${renderSearchSettings(request,providers,escape)}</div></section><section class="results-panel">${renderResultsToolbar({request,response:{totalHits:35,mapHits:[{id:'one'}]},view:'list',facetCount:active?1:0,chips:active?chips:''})}</section></main></body></html>`);
      await expect(page.locator('#sort')).toHaveValue('relevance');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      const rect = async selector => page.locator(selector).evaluate(e => ({...e.getBoundingClientRect().toJSON(),font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color}));
      const search=await rect('#search-box'), sort=await rect('#sort'), save=await rect('#save-search'), homes=await rect('.results-head h2');
      expect(Math.abs(homes.y+homes.height/2-save.y-save.height/2)).toBeLessThanOrEqual(1);
      expect(sort.height).toBeGreaterThanOrEqual(40); expect(save.height).toBeGreaterThanOrEqual(40);
      expect(parseFloat(sort.font)).toBeGreaterThanOrEqual(12); expect(sort.color).not.toBe('rgba(0, 0, 0, 0)');
      if(width<=760) {
        const filters=await rect('#toggle-filters'), view=await rect('#mobile-view-toggle');
        expect(search.width).toBeGreaterThanOrEqual(width-32);
        expect(Math.abs(filters.y-sort.y)).toBeLessThanOrEqual(1); expect(Math.abs(view.y-sort.y)).toBeLessThanOrEqual(1);
        expect(filters.right).toBeLessThanOrEqual(sort.x); expect(sort.right).toBeLessThanOrEqual(view.x);
        expect(filters.y-search.bottom).toBeLessThanOrEqual(10);
        expect(homes.y).toBeGreaterThan(filters.bottom);
        await expect(page.locator('#search-mode')).toBeHidden();
      } else {
        const mode=await rect('#search-mode'), provider=await rect('#provider');
        expect(Math.abs(search.bottom-mode.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(search.bottom-provider.bottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(sort.y-save.y)).toBeLessThanOrEqual(1);
        await expect(page.locator('#toggle-filters')).toBeHidden();
      }
      if(active) { const chip=await rect('.refinement-pill .badge'); expect(chip.height).toBeGreaterThanOrEqual(26); expect(chip.height).toBeLessThanOrEqual(30); }
      else await expect(page.locator('.refinements')).toHaveCount(0);
    }
    expect(requests).toBe(0);
  });
}
